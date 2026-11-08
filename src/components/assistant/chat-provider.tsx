"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AssistantEvent } from "@/lib/assistant/run";
import type { ChatItem, ChatPart } from "@/lib/assistant/transcript";
import { readLocationPref } from "../location/location-switch";

export type Item = ChatItem | { role: "error"; text: string };

export interface AssistantMeta {
  ready: boolean;
  allowance: { capCents: number; spentCents: number; leftCents: number };
  conversations: { id: string; title: string; updatedAt: string }[];
}

interface ChatContext {
  conversationId: string | null;
  items: Item[];
  busy: boolean;
  meta: AssistantMeta | undefined;
  draft: string;
  setDraft: (s: string) => void;
  send: (text: string) => Promise<void>;
  stop: () => void;
  newChat: () => void;
  /** show a past conversation */
  open: (id: string) => void;
  /** the floating panel */
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** open the panel with a question ready to send */
  ask: (question?: string) => void;
}

const Ctx = createContext<ChatContext | null>(null);

export function useAssistantChat() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAssistantChat outside AssistantChatProvider");
  return c;
}

/**
 * One conversation for the whole app, shared by the Ask Lotline page and the floating panel,
 * so it survives closing the panel and moving between pages.
 */
export function AssistantChatProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const { data: meta } = useQuery<AssistantMeta>({
    queryKey: ["assistant-meta"],
    queryFn: async () => (await fetch("/api/assistant/conversations")).json(),
    staleTime: 60_000,
  });

  /** Apply one streamed event to the conversation. */
  const apply = useCallback(
    (e: AssistantEvent | { type: "conversation"; id: string }) => {
      if (e.type === "conversation") {
        setConversationId(e.id);
        return;
      }
      if (e.type === "allowance") {
        queryClient.setQueryData<AssistantMeta>(["assistant-meta"], (m) =>
          m
            ? {
                ...m,
                allowance: {
                  capCents: e.capCents,
                  spentCents: e.spentCents,
                  leftCents: e.leftCents,
                },
              }
            : m,
        );
        return;
      }
      if (e.type === "done") return;
      setItems((prev) => {
        if (e.type === "error")
          return [...prev, { role: "error", text: e.message }];
        const next = [...prev];
        const last = next.at(-1);
        const a: { role: "assistant"; parts: ChatPart[] } =
          last?.role === "assistant"
            ? { role: "assistant", parts: [...last.parts] }
            : { role: "assistant", parts: [] };
        if (last?.role === "assistant") next[next.length - 1] = a;
        else next.push(a);
        if (e.type === "text") {
          const t = a.parts.at(-1);
          if (t?.type === "text")
            a.parts[a.parts.length - 1] = {
              type: "text",
              text: t.text + e.delta,
            };
          else if (e.delta.trim())
            a.parts.push({ type: "text", text: e.delta.trimStart() });
        } else if (e.type === "tool") {
          const i = a.parts.findIndex(
            (p) => p.type === "tool" && p.id === e.id,
          );
          const part: ChatPart = {
            type: "tool",
            id: e.id,
            label: e.label,
            state: e.state,
          };
          if (i >= 0) a.parts[i] = part;
          else a.parts.push(part);
        } else if (e.type === "action") {
          a.parts.push({ type: "action", action: e.action });
        }
        return next;
      });
    },
    [queryClient],
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setDraft("");
      setBusy(true);
      setItems((prev) => [...prev, { role: "user", text: message }]);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId,
            message,
            location: readLocationPref(),
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          apply({
            type: "error",
            message: err.error ?? "Something went wrong. Try again.",
          });
          return;
        }
        const reader = res.body
          .pipeThrough(new TextDecoderStream())
          .getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl = buf.indexOf("\n");
          while (nl >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) apply(JSON.parse(line));
            nl = buf.indexOf("\n");
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          apply({ type: "error", message: "Lost the connection. Try again." });
      } finally {
        setBusy(false);
        abort.current = null;
        void queryClient.invalidateQueries({ queryKey: ["assistant-meta"] });
      }
    },
    [apply, busy, conversationId, queryClient],
  );

  const open = useCallback((id: string) => {
    abort.current?.abort();
    setConversationId(id);
    setItems([]);
    void fetch(`/api/assistant/conversations/${id}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: ChatItem[] }) => setItems(d.items));
  }, []);

  const value = useMemo<ChatContext>(
    () => ({
      conversationId,
      items,
      busy,
      meta,
      draft,
      setDraft,
      send,
      stop: () => abort.current?.abort(),
      newChat: () => {
        abort.current?.abort();
        setConversationId(null);
        setItems([]);
      },
      open,
      panelOpen,
      setPanelOpen,
      ask: (question) => {
        if (question) setDraft(question);
        setPanelOpen(true);
      },
    }),
    [conversationId, items, busy, meta, draft, send, open, panelOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
