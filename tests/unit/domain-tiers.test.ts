import { describe, expect, it } from "vitest";
import { nextDue, tierFor } from "@/lib/domain/tiers";

const now = new Date("2026-11-10T16:00:00Z");
const in_ = (min: number) => new Date(now.getTime() + min * 60_000);

describe("polling tiers", () => {
  it("reads more often as the close nears, and keeps reading until final", () => {
    expect(tierFor({ endAt: in_(90), final: false }, now)).toBe("cold");
    expect(tierFor({ endAt: in_(45), final: false }, now)).toBe("warm");
    expect(tierFor({ endAt: in_(10), final: false }, now)).toBe("near");
    expect(tierFor({ endAt: in_(3), final: false }, now)).toBe("hot");
    expect(tierFor({ endAt: in_(-2), final: false }, now)).toBe("hot");
    expect(tierFor({ endAt: in_(-2), final: true }, now)).toBe("done");
  });

  it("schedules each tier, waking cold lots an hour before the end", () => {
    expect(nextDue("cold", { endAt: in_(90) }, now)).toEqual(in_(30));
    expect(nextDue("warm", { endAt: in_(45) }, now)).toEqual(
      new Date(+now + 120_000),
    );
    expect(nextDue("near", { endAt: in_(10) }, now)).toEqual(
      new Date(+now + 30_000),
    );
    expect(nextDue("hot", { endAt: in_(3) }, now)).toEqual(
      new Date(+now + 8_000),
    );
    expect(nextDue("hot", { endAt: in_(3) }, now, 60)).toEqual(
      new Date(+now + 24_000),
    );
    expect(nextDue("done", { endAt: in_(3) }, now)).toBeNull();
  });
});
