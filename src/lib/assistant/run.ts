import Anthropic from "@anthropic-ai/sdk";
import type { StoredMessage } from "../db/queries/assistant";
import { ASSISTANT_MODEL, costMicros } from "./pricing";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOL_DEFINITIONS, type ToolDeps, toolLabel } from "./tools";
import type { ActionView } from "./transcript";

type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

/** One streamed model call: its events, then the complete message. */
export interface ModelStream
  extends AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent> {
  finalMessage(): Promise<Anthropic.Beta.BetaMessage>;
}
export type StreamFn = (
  params: Omit<StreamParams, "stream">,
  signal: AbortSignal,
) => ModelStream;

/** What the browser sees while the assistant works. */
export type AssistantEvent =
  | { type: "conversation"; id: string; title: string }
  | { type: "text"; delta: string }
  | {
      type: "tool";
      id: string;
      label: string;
      state: "running" | "done" | "error";
    }
  | { type: "action"; action: ActionView }
  | {
      type: "allowance";
      spentCents: number;
      capCents: number;
      leftCents: number;
    }
  | { type: "done" }
  | { type: "error"; message: string };

export interface TurnStore {
  appendMessages(messages: StoredMessage[]): Promise<void>;
  recordUsage(u: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costMicros: number;
  }): Promise<void>;
  allowance(): Promise<{
    capCents: number;
    spentCents: number;
    leftCents: number;
  }>;
}

/** Tool rounds per question: enough to search, compare and propose, not to wander. */
export const MAX_ROUNDS = 8;
const MAX_TOKENS = 32_000;

export function buildParams(
  messages: Anthropic.Beta.BetaMessageParam[],
): Omit<StreamParams, "stream"> {
  return {
    model: ASSISTANT_MODEL,
    max_tokens: MAX_TOKENS,
    // Frozen prefix: tools then system, cached together by this breakpoint...
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: TOOL_DEFINITIONS,
    // ...and the growing conversation by automatic caching.
    cache_control: { type: "ephemeral" },
    // Opus 5.5 always thinks adaptively; effort is the dial, and its default is medium.
    output_config: { effort: "medium" },
    // If a safety classifier declines, re-run on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages,
  };
}

/**
 * Answer one question: stream Claude's reply, run the tools it asks for, and loop until it's
 * done. History is append-only (thinking blocks are only valid in the history that made them):
 * every message is stored exactly as sent or received. Each model call is priced and recorded,
 * and the loop stops before a call once the person's monthly allowance is used up.
 */
export async function runTurn(opts: {
  history: StoredMessage[];
  question: string;
  context: string;
  stream: StreamFn;
  deps: ToolDeps;
  store: TurnStore;
  emit: (e: AssistantEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { stream, deps, store, emit, signal } = opts;
  const turn: StoredMessage[] = [
    { role: "user", content: opts.question },
    // Per-turn context goes after the question, never in the cached system prompt.
    { role: "system", content: opts.context },
  ];
  await store.appendMessages(turn);
  const messages = [
    ...opts.history,
    ...turn,
  ] as Anthropic.Beta.BetaMessageParam[];

  let parseRetries = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const left = await store.allowance();
    emit({ type: "allowance", ...left });
    if (left.leftCents <= 0) {
      emit({
        type: "error",
        message: `You've used this month's $${(left.capCents / 100).toFixed(0)} assistant allowance. It resets on the 1st.`,
      });
      return;
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      const s = stream(buildParams(messages), signal);
      for await (const ev of s) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta")
          emit({ type: "text", delta: ev.delta.text });
        else if (
          ev.type === "content_block_start" &&
          ev.content_block.type === "text" &&
          round > 0
        )
          emit({ type: "text", delta: "\n\n" });
      }
      message = await s.finalMessage();
      parseRetries = 0;
    } catch (err) {
      if (signal.aborted || err instanceof Anthropic.APIUserAbortError) return;
      // A tool input that couldn't be parsed at all: re-issue the turn (capped). API errors
      // (auth, rate limits, overload) are the caller's to report.
      if (err instanceof Anthropic.APIError || parseRetries++ >= 2) throw err;
      continue;
    }

    const u = message.usage;
    await store.recordUsage({
      model: message.model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      costMicros: costMicros({ ...u, model: message.model }),
    });

    const assistant: StoredMessage = {
      role: "assistant",
      content: message.content,
    };
    await store.appendMessages([assistant]);
    messages.push(assistant as Anthropic.Beta.BetaMessageParam);

    if (message.stop_reason === "refusal") {
      emit({
        type: "text",
        delta: "\n\nSorry, I can't help with that one. Try asking another way.",
      });
      break;
    }
    const uses = message.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (!uses.length) break;
    if (message.stop_reason === "max_tokens") {
      emit({
        type: "error",
        message: "That answer ran too long. Try a narrower question.",
      });
      break;
    }

    for (const b of uses)
      emit({
        type: "tool",
        id: b.id,
        label: toolLabel(b.name, b.input),
        state: "running",
      });
    const results = await Promise.all(
      uses.map(async (b) => {
        const r = await runTool(b, deps);
        emit({
          type: "tool",
          id: b.id,
          label: toolLabel(b.name, b.input),
          state: r.is_error ? "error" : "done",
        });
        return r;
      }),
    );
    // All results in one user message, so Claude keeps making parallel calls.
    const toolTurn: StoredMessage = { role: "user", content: results };
    await store.appendMessages([toolTurn]);
    messages.push(toolTurn as Anthropic.Beta.BetaMessageParam);
  }
  emit({ type: "allowance", ...(await store.allowance()) });
  emit({ type: "done" });
}
