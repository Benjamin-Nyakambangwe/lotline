import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { contextMessage } from "@/lib/assistant/prompt";
import { type AssistantEvent, runTurn } from "@/lib/assistant/run";
import {
  allowance,
  appendMessages,
  createConversation,
  getConversation,
  loadMessages,
  recordUsage,
} from "@/lib/db/queries/assistant";
import { assistantStream } from "@/server/assistant/client";
import { toolDeps } from "@/server/assistant/deps";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

const Body = z.object({
  conversationId: z.uuid().nullish(),
  message: z.string().trim().min(1).max(4000),
  location: z.enum(["Harare", "Bulawayo"]).nullish(),
});

/** One question at a time per person: a second tab can't double-spend. */
const busy = new Set<string>();

function friendly(err: unknown): string {
  if (
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError
  )
    return "The assistant isn't set up correctly: its API key was rejected.";
  if (err instanceof Anthropic.RateLimitError)
    return "The assistant is busy. Try again in a minute.";
  if (err instanceof Anthropic.InternalServerError)
    return "Claude is overloaded right now. Try again shortly.";
  if (err instanceof Anthropic.APIConnectionError)
    return "Couldn't reach Claude. Try again in a moment.";
  return "Something went wrong answering that. Try again.";
}

/** Ask the assistant: streams newline-delimited JSON events while it works. */
export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const stream = assistantStream();
  if (!stream)
    return Response.json(
      {
        error:
          "The assistant isn't set up yet: the server has no Anthropic API key.",
      },
      { status: 503 },
    );
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "bad request" }, { status: 400 });
  const { message, location } = parsed.data;
  if (busy.has(userId))
    return Response.json(
      { error: "Still answering your last question." },
      { status: 429 },
    );

  const db = getDb();
  let conversationId = parsed.data.conversationId ?? null;
  if (conversationId && !(await getConversation(db, conversationId, userId)))
    return Response.json({ error: "not found" }, { status: 404 });
  const isNew = !conversationId;
  conversationId ??= await createConversation(db, userId, message.slice(0, 60));
  const id = conversationId;
  const history = isNew ? [] : await loadMessages(db, id);
  const left = await allowance(db, userId);

  const encoder = new TextEncoder();
  busy.add(userId);
  const body = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (e: AssistantEvent) => {
        if (open) controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      };
      // Safari holds the first 1 KB of a stream: pad the first event so text appears at once.
      controller.enqueue(
        encoder.encode(
          `${JSON.stringify({ type: "conversation", id, title: message.slice(0, 60), pad: " ".repeat(1024) })}\n`,
        ),
      );
      try {
        await runTurn({
          history,
          question: message,
          context: contextMessage({
            now: new Date(),
            name: session.user.name,
            location: location ?? null,
            ...left,
          }),
          stream,
          deps: toolDeps(userId, id, emit),
          store: {
            appendMessages: (m) => appendMessages(db, id, m),
            recordUsage: (u) =>
              recordUsage(db, { ...u, userId, conversationId: id }),
            allowance: () => allowance(db, userId),
          },
          emit,
          signal: request.signal,
        });
      } catch (err) {
        console.error(
          "assistant turn failed:",
          err instanceof Error ? err.message : err,
        );
        emit({ type: "error", message: friendly(err) });
      } finally {
        busy.delete(userId);
        open = false;
        try {
          controller.close();
        } catch {
          // the client already went away
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
