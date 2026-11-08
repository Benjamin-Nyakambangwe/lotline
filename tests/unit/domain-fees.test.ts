import { describe, expect, it } from "vitest";
import {
  allIn,
  DEFAULT_RATES,
  feeBreakdown,
  feeMultiplier,
  maxHammerFor,
  ratesFrom,
} from "@/lib/domain/fees";
import {
  incrementFor,
  ladderDown,
  ladderUp,
  nextBidAfter,
  snapDown,
} from "@/lib/domain/increments";
import { formatMoney, parseCents, toCents } from "@/lib/domain/money";

describe("fees", () => {
  it("matches a real invoice: lot 795373 sold for $60 → $72.13 all-in", () => {
    expect(allIn(6000)).toBe(7213);
  });

  it("uses the 1.202125 multiplier when LotVAT is 0", () => {
    expect(feeMultiplier(DEFAULT_RATES)).toBeCloseTo(1.202125, 9);
    expect(allIn(5000)).toBe(6011); // $50 → $60.11
    expect(allIn(900)).toBe(1082); // $9 → $10.82, the LTE lot
  });

  it("adds LotVAT when a lot carries it", () => {
    const r = { levy: 0.175, vat: 0.155, lotVat: 0.155, estimated: false };
    expect(allIn(10000, r)).toBe(13571); // 115.50 + 20.2125 + ... = $135.71
  });

  it("breaks the fee down into parts that sum to the all-in", () => {
    const b = feeBreakdown(6000);
    expect(b).toMatchObject({
      hammer: 6000,
      lotVat: 0,
      levy: 1050,
      levyVat: 163,
    });
    expect(b.allIn).toBe(7213);
  });

  it("marks rates as estimated until the detail is known", () => {
    expect(ratesFrom({}).estimated).toBe(true);
    expect(ratesFrom({ levy: 0.175, vat: 0.155, lotVat: 0 }).estimated).toBe(
      false,
    );
  });

  it("finds the biggest ladder bid under an all-in target", () => {
    // $60 all-in → $49.91 raw → $45 on the ladder; the next step ($50) would be $60.11.
    expect(maxHammerFor(6000)).toEqual({
      hammer: 4500,
      allIn: 5410,
      next: { hammer: 5000, allIn: 6011 },
    });
    expect(maxHammerFor(6000, DEFAULT_RATES, { snap: false }).hammer).toBe(
      4991,
    );
  });
});

describe("bid ladder", () => {
  it("matches ABC's live next bids in every band (current → next, in dollars)", () => {
    // Read from 26 open lots' detail on 8 Nov 2026.
    const seen: [number, number][] = [
      [2, 3],
      [9, 10],
      [10, 12],
      [25, 30],
      [45, 50],
      [50, 60],
      [170, 180],
      [225, 250],
      [450, 475],
      [500, 550],
      [750, 800],
      [1000, 1100],
      [2200, 2300],
      [14500, 14600],
    ];
    for (const [cur, next] of seen)
      expect(nextBidAfter(cur * 100)).toBe(next * 100);
  });
  it("snaps to the ladder in the upper bands too", () => {
    expect([21000, 23000, 52000, 99000, 123456].map(snapDown)).toEqual([
      20000, 22500, 50000, 95000, 120000,
    ]);
  });
  it("knows the increments", () => {
    expect([900, 1000, 1900, 2000, 4900, 5000, 9000].map(incrementFor)).toEqual(
      [100, 200, 200, 500, 500, 1000, 1000],
    );
  });
  it("snaps down to valid ladder values", () => {
    expect([50, 950, 1100, 1300, 2400, 2600, 5500, 6900].map(snapDown)).toEqual(
      [100, 900, 1000, 1200, 2000, 2500, 5000, 6000],
    );
  });
  it("steps up and down", () => {
    expect([900, 1400, 4500, 5000].map(ladderUp)).toEqual([
      1000, 1600, 5000, 6000,
    ]);
    expect([100, 1000, 2000, 5000, 6000].map(ladderDown)).toEqual([
      100, 900, 1800, 4500, 5000,
    ]);
  });
});

describe("money", () => {
  it("formats whole dollars without cents and keeps exact cents", () => {
    expect(formatMoney(6000)).toBe("$60");
    expect(formatMoney(7213)).toBe("$72.13");
    expect(formatMoney(123456)).toBe("$1,234.56");
    expect(formatMoney(null)).toBe("–");
    expect(formatMoney(6000, { forceCents: true })).toBe("$60.00");
  });
  it("parses DB numerics and API numbers", () => {
    expect(parseCents("72.13")).toBe(7213);
    expect(parseCents(60)).toBe(6000);
    expect(parseCents(null)).toBeNull();
    expect(toCents(0.1 + 0.2)).toBe(30);
  });
});
