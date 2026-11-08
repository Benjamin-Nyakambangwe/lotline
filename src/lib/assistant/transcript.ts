import type { StoredMessage } from "../db/queries/assistant";
import { toolLabel } from "./tools";

/** A proposed change as the chat shows it. Money in cents. */
export interface ActionView {
  id: string;
  kind: "watch" | "unwatch";
  lotId: number;
  title: string | null;
  maxBidCents: number | null;
  allInCents: number | null;
  note: string | null;
  status: "pending" | "confirmed" | "declined";
}

export type ChatPart =
  | { type: "text"; text: string }
  | {
      type: "tool";
      id: string;
      label: string;
      state: "running" | "done" | "error";
    }
  | { type: "action"; action: ActionView };

export type ChatItem =
  | { role: "user"; text: string }
  | { role: "assistant"; parts: ChatPart[] };

type Block = { type: string; [k: string]: unknown };
const blocks = (c: unknown): Block[] =>
  Array.isArray(c) ? (c as Block[]) : [];

/**
 * Rebuild the chat from stored API messages: questions, the assistant's text, a chip per tool
 * call, and a card per proposed change. Context messages, thinking and raw tool results stay
 * hidden.
 */
export function transcript(
  messages: StoredMessage[],
  actions: Map<string, ActionView>,
): ChatItem[] {
  const items: ChatItem[] = [];
  const toolState = new Map<string, "done" | "error">();
  for (const m of messages)
    if (m.role === "user")
      for (const b of blocks(m.content))
        if (b.type === "tool_result")
          toolState.set(String(b.tool_use_id), b.is_error ? "error" : "done");

  let current: { role: "assistant"; parts: ChatPart[] } | null = null;
  const assistant = () => {
    if (!current) {
      current = { role: "assistant", parts: [] };
      items.push(current);
    }
    return current;
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user" && typeof m.content === "string") {
      items.push({ role: "user", text: m.content });
      current = null;
      continue;
    }
    if (m.role === "assistant") {
      const a = assistant();
      for (const b of blocks(m.content)) {
        if (b.type === "text" && String(b.text).trim()) {
          const last = a.parts.at(-1);
          if (last?.type === "text") last.text += `\n\n${String(b.text)}`;
          else a.parts.push({ type: "text", text: String(b.text) });
        } else if (b.type === "tool_use") {
          const id = String(b.id);
          a.parts.push({
            type: "tool",
            id,
            label: toolLabel(String(b.name), b.input),
            state: toolState.get(id) ?? "error",
          });
        }
      }
      continue;
    }
    // Tool results: surface the proposals they created.
    for (const b of blocks(m.content)) {
      if (b.type !== "tool_result" || b.is_error) continue;
      try {
        const id = (JSON.parse(String(b.content)) as { action_id?: string })
          .action_id;
        const action = id ? actions.get(id) : undefined;
        if (action) assistant().parts.push({ type: "action", action });
      } catch {
        // not JSON: not a proposal
      }
    }
  }
  return items;
}
