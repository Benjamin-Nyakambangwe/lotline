import { describe, expect, it } from "vitest";
import { layoutTimeline } from "@/lib/dashboard/timeline";

const T0 = Date.parse("2026-11-10T17:00:00Z"); // 19:00 in Harare
const MIN = 60_000;

describe("tonight timeline layout", () => {
  it("lays out 50 lots closing 20 s apart on a 360 px phone without overlaps", () => {
    const lots = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      end: T0 + i * 20_000,
      originalEnd: i % 7 === 0 ? T0 + i * 20_000 - 4 * MIN : null,
    }));
    const L = layoutTimeline(lots, { width: 360, now: T0 - 20 * MIN });
    expect(L.placed).toHaveLength(50);
    expect(L.lanes).toBeLessThanOrEqual(8);
    // Everything inside the plot.
    for (const p of L.placed) {
      expect(p.x).toBeGreaterThanOrEqual(14);
      expect(p.x).toBeLessThanOrEqual(346);
    }
    // Within a lane, marks (and trails) never touch, unless all 8 lanes are full.
    if (L.lanes < 8) {
      const byLane = Map.groupBy(L.placed, (p) => p.lane);
      for (const ps of byLane.values())
        for (let i = 1; i < ps.length; i++)
          expect(
            (ps[i].xOriginal ?? ps[i].x) - ps[i - 1].x,
          ).toBeGreaterThanOrEqual(12);
    }
    // Ticks on round times, readable apart.
    expect(L.ticks.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < L.ticks.length; i++)
      expect(L.ticks[i].x - L.ticks[i - 1].x).toBeGreaterThanOrEqual(60);
    for (const t of L.ticks) expect(t.t % (5 * MIN)).toBe(0);
  });

  it("includes now when the first close is coming up, and draws extension trails from the original end", () => {
    const L = layoutTimeline([{ id: 1, end: T0 + 10 * MIN, originalEnd: T0 }], {
      width: 600,
      now: T0 - 30 * MIN,
    });
    expect(L.start).toBeLessThanOrEqual(T0 - 30 * MIN);
    const [p] = L.placed;
    expect(p.xOriginal).not.toBeNull();
    expect(p.xOriginal as number).toBeLessThan(p.x);
  });
});
