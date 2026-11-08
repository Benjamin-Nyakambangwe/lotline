import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { demoStream } from "@/lib/assistant/fake";
import type { StreamFn } from "@/lib/assistant/run";

let client: Anthropic | null = null;

/**
 * How the assistant reaches Claude: the Anthropic API with the server's key, or the scripted
 * fake for tests (ASSISTANT_MODE=fake, never in production). Null when no key is configured.
 */
export function assistantStream(): StreamFn | null {
  if (
    process.env.ASSISTANT_MODE === "fake" &&
    process.env.NODE_ENV !== "production"
  )
    return demoStream;
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN)
    return null;
  client ??= new Anthropic({ maxRetries: 2 });
  const c = client;
  return (params, signal) => c.beta.messages.stream(params, { signal });
}
