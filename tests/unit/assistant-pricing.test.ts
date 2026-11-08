import { describe, expect, it } from "vitest";
import { costMicros } from "@/lib/assistant/pricing";

describe("assistant pricing", () => {
  it("prices Opus 5.5 at $4 in, $20 out, $5 cache write, $0.20 cache read per million", () => {
    expect(
      costMicros({
        model: "claude-opus-5-5",
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_input_tokens: 4000,
        cache_read_input_tokens: 10_000,
      }),
    ).toBe(1000 * 4 + 500 * 20 + 4000 * 5 + 10_000 * 0.2); // 36,000 micros = 3.6¢
  });

  it("prices each iteration at its own model's rates (a fallback can run elsewhere)", () => {
    expect(
      costMicros({
        model: "claude-opus-5-5",
        input_tokens: 2000,
        output_tokens: 200,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        iterations: [
          {
            type: "message",
            model: "claude-opus-5-5",
            input_tokens: 1000,
            output_tokens: 0,
          },
          {
            type: "fallback_message",
            model: "claude-opus-5",
            input_tokens: 1000,
            output_tokens: 200,
          },
        ],
      }),
    ).toBe(1000 * 4 + 1000 * 5 + 200 * 25);
  });

  it("errs high for an unknown model", () => {
    expect(
      costMicros({
        model: "some-future-model",
        input_tokens: 1000,
        output_tokens: 0,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      }),
    ).toBe(5000);
  });
});
