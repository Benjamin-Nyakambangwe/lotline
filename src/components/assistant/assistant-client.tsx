"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowUp,
  Check,
  History,
  Loader2,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AssistantEvent } from "@/lib/assistant/run";
import type { ChatItem, ChatPart } from "@/lib/assistant/transcript";
import { cn } from "@/lib/utils";
import { readLocationPref } from "../location/location-switch";
import { ActionCard } from "./action-card";
import { AssistantMarkdown } from "./markdown";

type Item = ChatItem | { role: "error"; text: string };

interface Meta {
  ready: boolean;
  allowance: { capCents: number; spentCents: number; leftCents: number };
  conversations: { id: string; title: string; updatedAt: string }[];
}

const SUGGESTIONS = [
  "Which auctions close tonight?",
  "What do Dell OptiPlex 7060s usually sell for?",
  "Find a fridge I can get for under $100 all-in",
  "Plan a $300 homelab from this week's lots",
];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function AssistantClient() {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useQueryState("c", parseAsString);
  const [prefill, setPrefill] = useQueryState("q", parseAsString);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  /** the conversation being streamed into: don't reload it from the server mid-answer */
  const streamingId = useRef<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const meta = useQuery<Meta>({
    queryKey: ["assistant-meta"],
    queryFn: async () => (await fetch("/api/assistant/conversations")).json(),
  });

  // Open a past conversation.
  useEffect(() => {
    if (!conversationId) {
      if (!streamingId.current) setItems([]);
      return;
    }
    if (streamingId.current === conversationId) return;
    let live = true;
    void fetch(`/api/assistant/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: ChatItem[] }) => live && setItems(d.items));
    return () => {
      live = false;
    };
  }, [conversationId]);

  // "Ask about this lot" and similar links prefill the question.
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      void setPrefill(null);
      box.current?.focus();
    }
  }, [prefill, setPrefill]);

  const scrollDown = useCallback(() => {
    const el = bottom.current;
    if (!el) return;
    const near =
      window.innerHeight + window.scrollY > document.body.scrollHeight - 320;
    if (near) el.scrollIntoView({ block: "end" });
  }, []);

  /** Apply one streamed event to the last assistant item. */
  const apply = useCallback(
    (e: AssistantEvent | { type: "conversation"; id: string }) => {
      if (e.type === "conversation") {
        streamingId.current = e.id;
        void setConversationId(e.id, { history: "replace" });
        return;
      }
      if (e.type === "allowance") {
        queryClient.setQueryData<Meta>(["assistant-meta"], (m) =>
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
    [queryClient, setConversationId],
  );

  // Follow the answer as it streams in (only if the reader is already near the bottom).
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs whenever the chat grows
  useEffect(() => scrollDown(), [items, scrollDown]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setItems((prev) => [...prev, { role: "user", text: message }]);
    requestAnimationFrame(() =>
      bottom.current?.scrollIntoView({ block: "end" }),
    );
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
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        apply({
          type: "error",
          message: err.error ?? "Something went wrong. Try again.",
        });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
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
      streamingId.current = null;
      void queryClient.invalidateQueries({ queryKey: ["assistant-meta"] });
    }
  }

  const newChat = () => {
    abort.current?.abort();
    setItems([]);
    void setConversationId(null);
    box.current?.focus();
  };

  const m = meta.data;
  const last = items.at(-1);
  const thinking =
    busy && (last?.role !== "assistant" || last.parts.length === 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Sparkles className="size-6 text-primary" aria-hidden="true" />
            Ask Lotline
          </h1>
          {m?.ready && (
            <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {money(m.allowance.leftCents)} of {money(m.allowance.capCents)}{" "}
              left this month
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Past conversations"
              >
                <History />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Recent
              </DropdownMenuLabel>
              {m?.conversations.length ? (
                m.conversations.map((c) => (
                  <DropdownMenuItem
                    key={c.id}
                    onSelect={() => void setConversationId(c.id)}
                  >
                    <span className="truncate">{c.title}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  No conversations yet
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={newChat}>
            <Plus /> New
          </Button>
        </div>
      </header>

      {m && !m.ready && (
        <div className="mb-4 rounded-xl border border-closing/40 bg-closing-bg p-4 text-sm text-closing">
          The assistant isn't switched on yet: the server needs an Anthropic API
          key (<code className="font-mono">ANTHROPIC_API_KEY</code>). Ask the
          owner.
        </div>
      )}

      {items.length === 0 ? (
        <div className="py-6">
          <p className="text-muted-foreground">
            Ask about lots, prices and auctions. It searches Lotline's live
            catalogue and a year of past sales, and can add lots to your
            watchlist when you confirm. It never bids.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={!m?.ready || busy}
                onClick={() => void send(s)}
                className="rounded-xl border bg-card p-3 text-left text-sm transition-colors hover:border-primary/40 hover:bg-surface-2 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <ol
          className="flex flex-col gap-5"
          aria-label="Conversation"
          aria-live="polite"
        >
          {items.map((it, i) => (
            // Items only ever append, so the index is a stable key.
            // biome-ignore lint/suspicious/noArrayIndexKey: append-only list
            <li key={i}>
              <ChatRow item={it} />
            </li>
          ))}
        </ol>
      )}
      {thinking && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />{" "}
          Thinking…
        </p>
      )}
      <div ref={bottom} className="h-4" />

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="sticky bottom-[calc(var(--sheet-h,0px)+env(safe-area-inset-bottom)+4.25rem)] z-20 mt-4 lg:bottom-[calc(var(--sheet-h,0px)+1rem)]"
      >
        <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-lg focus-within:border-primary/60 focus-within:ring-4 focus-within:ring-primary/15">
          <textarea
            ref={box}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            maxLength={4000}
            placeholder={
              m?.ready === false
                ? "The assistant isn't switched on yet"
                : "Ask about lots, prices, auctions…"
            }
            aria-label="Ask Lotline"
            disabled={m?.ready === false}
            className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-base outline-none [field-sizing:content] placeholder:text-muted-foreground"
          />
          {busy ? (
            <Button
              type="button"
              size="icon"
              variant="secondary"
              onClick={() => abort.current?.abort()}
              aria-label="Stop"
            >
              <Square className="size-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              disabled={!input.trim() || m?.ready === false}
              aria-label="Send"
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

function ChatRow({ item }: { item: Item }) {
  if (item.role === "user")
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 whitespace-pre-wrap text-primary-foreground">
          {item.text}
        </p>
      </div>
    );
  if (item.role === "error")
    return (
      <p
        className="flex items-start gap-2 rounded-xl border border-outbid/40 bg-outbid-bg p-3 text-sm text-outbid"
        role="alert"
      >
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {item.text}
      </p>
    );
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Sparkles className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        {item.parts.map((p, i) =>
          p.type === "text" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: parts only append
            <AssistantMarkdown key={i} text={p.text} />
          ) : p.type === "tool" ? (
            <ToolChip key={p.id} label={p.label} state={p.state} />
          ) : (
            <ActionCard key={p.action.id} action={p.action} />
          ),
        )}
      </div>
    </div>
  );
}

function ToolChip({
  label,
  state,
}: {
  label: string;
  state: "running" | "done" | "error";
}) {
  return (
    <p
      className={cn(
        "my-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        state === "error" ? "text-outbid" : "text-muted-foreground",
      )}
    >
      {state === "running" ? (
        <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />
      ) : state === "done" ? (
        <Check className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <X className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span className="truncate">{label}</span>
    </p>
  );
}
