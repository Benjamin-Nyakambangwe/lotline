import type Anthropic from "@anthropic-ai/sdk";
import type { ModelStream, StreamFn } from "./run";

type Msg = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;
type Params = Parameters<StreamFn>[0];

/** Turn a complete message into the stream events the real API would send, then the message. */
export function streamOf(message: Msg): ModelStream {
  const events: Anthropic.Beta.BetaRawMessageStreamEvent[] = [];
  events.push({
    type: "message_start",
    message: { ...message, content: [], stop_reason: null },
  } as unknown as Anthropic.Beta.BetaRawMessageStreamEvent);
  message.content.forEach((b, index) => {
    if (b.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { ...b, text: "" },
      } as unknown as Anthropic.Beta.BetaRawMessageStreamEvent);
      for (const chunk of b.text.match(/[\s\S]{1,24}/g) ?? [])
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "text_delta", text: chunk },
        } as Anthropic.Beta.BetaRawMessageStreamEvent);
    } else {
      events.push({
        type: "content_block_start",
        index,
        content_block: b,
      } as unknown as Anthropic.Beta.BetaRawMessageStreamEvent);
    }
    events.push({
      type: "content_block_stop",
      index,
    } as Anthropic.Beta.BetaRawMessageStreamEvent);
  });
  events.push({
    type: "message_stop",
  } as Anthropic.Beta.BetaRawMessageStreamEvent);
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) {
        await new Promise((r) => setTimeout(r, 5));
        yield e;
      }
    },
    finalMessage: async () => message,
  };
}

let seq = 0;
export function fakeMessage(
  content: Block[],
  stop: Msg["stop_reason"] = "end_turn",
): Msg {
  return {
    id: `msg_fake_${++seq}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: {
      input_tokens: 1200,
      output_tokens: 150,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 3000,
    },
  } as unknown as Msg;
}

const text = (t: string) =>
  ({ type: "text", text: t, citations: null }) as unknown as Block;
const toolUse = (name: string, input: Record<string, unknown>) =>
  ({
    type: "tool_use",
    id: `toolu_fake_${++seq}`,
    name,
    input,
  }) as unknown as Block;

/**
 * A scripted assistant for tests and the end-to-end suite (ASSISTANT_MODE=fake): it searches
 * for the lots asked about, lists the top three with links, and proposes watching the first.
 * Never calls Anthropic.
 */
export const demoStream: StreamFn = (params: Params) => {
  const msgs = params.messages;
  const last = msgs[msgs.length - 1];
  const lastUser = [...msgs]
    .reverse()
    .find((m) => m.role === "user" && typeof m.content === "string");
  const question =
    typeof lastUser?.content === "string" ? lastUser.content : "";
  const results =
    last.role === "user" && Array.isArray(last.content)
      ? (last.content as Anthropic.Beta.BetaToolResultBlockParam[])
      : null;

  if (!results) {
    const words = question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
    const stop = new Set([
      "find",
      "show",
      "the",
      "any",
      "for",
      "what",
      "are",
      "lots",
      "lot",
      "with",
      "under",
      "me",
    ]);
    const query = words
      .filter((w) => !stop.has(w))
      .slice(0, 3)
      .join(" ");
    return streamOf(
      fakeMessage(
        [text("Let me look."), toolUse("search_lots", { query, limit: 5 })],
        "tool_use",
      ),
    );
  }
  const body = JSON.parse(String(results[0]?.content ?? "{}")) as {
    lots?: {
      id: number;
      title: string;
      all_in_at_next_bid: number | null;
      next_bid: number | null;
      closes: string | null;
    }[];
    proposed?: boolean;
  };
  if (body.proposed)
    return streamOf(
      fakeMessage([text("Tap **Confirm** to add it to your watchlist.")]),
    );
  const lots = body.lots ?? [];
  if (!lots.length)
    return streamOf(
      fakeMessage([text("I couldn't find any open lots like that right now.")]),
    );
  const lines = lots
    .slice(0, 3)
    .map(
      (l) =>
        `- [${l.title}](/lots/${l.id}): next bid $${l.next_bid}, **$${l.all_in_at_next_bid} all-in**, closes ${l.closes}`,
    );
  return streamOf(
    fakeMessage(
      [
        text(`Here are the best matches:\n\n${lines.join("\n")}`),
        toolUse("propose_watch", {
          lot_id: lots[0].id,
          ...(lots[0].next_bid ? { max_bid: lots[0].next_bid } : {}),
        }),
      ],
      "tool_use",
    ),
  );
};
