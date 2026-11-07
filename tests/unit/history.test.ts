import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeDetail } from "@/lib/abc/normalize";
import { detailSchema } from "@/lib/abc/schemas";
import {
  cutoffFor,
  type HistoryConfig,
  hourIn,
  isPausedHour,
  lotDate,
  nextEma,
  paceFor,
  stopReason,
} from "@/worker/jobs/history";

const cfg: HistoryConfig = {
  HISTORY_MONTHS: 12,
  HISTORY_NIGHT_MS: 1000,
  HISTORY_DAY_MS: 3000,
  HISTORY_PAUSE_FROM_HOUR: 16,
  HISTORY_PAUSE_TO_HOUR: 22,
  HISTORY_DAILY_MAX: 22_000,
  HISTORY_RESERVE: 15_000,
  ABC_DAILY_CAP: 40_000,
  DISPLAY_TZ: "Africa/Harare",
};

const sold = normalizeDetail(
  detailSchema.parse(
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "..",
          "fixtures",
          "abc",
          "detail-closed-795373.json",
        ),
        "utf8",
      ),
    ),
  ),
);

describe("history backfill pacing", () => {
  it("reads the hour in Harare (UTC+2)", () => {
    expect(hourIn(new Date("2026-11-08T15:00:00Z"), cfg.DISPLAY_TZ)).toBe(17);
    expect(hourIn(new Date("2026-11-08T22:30:00Z"), cfg.DISPLAY_TZ)).toBe(0);
  });

  it("pauses 16:00 to 22:00, including windows that wrap midnight", () => {
    expect(isPausedHour(15, 16, 22)).toBe(false);
    expect(isPausedHour(16, 16, 22)).toBe(true);
    expect(isPausedHour(21, 16, 22)).toBe(true);
    expect(isPausedHour(22, 16, 22)).toBe(false);
    expect(isPausedHour(23, 22, 6)).toBe(true);
    expect(isPausedHour(5, 22, 6)).toBe(true);
    expect(isPausedHour(6, 22, 6)).toBe(false);
    expect(isPausedHour(10, 0, 0)).toBe(false);
  });

  it("goes 1/s overnight and one every 3 s by day", () => {
    expect(paceFor(23, cfg)).toBe(1000);
    expect(paceFor(3, cfg)).toBe(1000);
    expect(paceFor(6, cfg)).toBe(3000);
    expect(paceFor(15, cfg)).toBe(3000);
  });

  it("targets twelve months back", () => {
    expect(cutoffFor(new Date("2026-11-07T10:00:00Z"), 12)).toEqual(
      new Date("2025-11-07T10:00:00Z"),
    );
  });
});

describe("history backfill: when a lot happened, and when to stop", () => {
  const now = new Date("2026-11-08T08:00:00Z");

  it("uses the real close, else the start (ignoring the 2125 placeholder)", () => {
    expect(lotDate(sold, now)).toEqual(sold.endAt);
    expect(
      lotDate({ ...sold, endAt: new Date("2125-11-04T18:00:00Z") }, now),
    ).toEqual(sold.startAt);
    expect(
      lotDate(
        { ...sold, endAt: null, startAt: null, offerWindowEndAt: null },
        now,
      ),
    ).toBeNull();
  });

  it("stops after about 1,200 old lots in a row, but not after a few stragglers", () => {
    let ema = 1;
    for (let i = 0; i < 100; i++) ema = nextEma(ema, false);
    expect(
      stopReason({
        nextId: 5000,
        dated: 600,
        recentEma: ema,
        missingStreak: 0,
      }),
    ).toBeNull();
    for (let i = 0; i < 1100; i++) ema = nextEma(ema, false);
    expect(
      stopReason({
        nextId: 5000,
        dated: 1800,
        recentEma: ema,
        missingStreak: 0,
      }),
    ).toBe("reached the cutoff date");
  });

  it("never stops on the cutoff before enough dated lots, and stops at the bottom of the range", () => {
    expect(
      stopReason({ nextId: 5000, dated: 10, recentEma: 0, missingStreak: 0 }),
    ).toBeNull();
    expect(
      stopReason({ nextId: 0, dated: 0, recentEma: 1, missingStreak: 0 }),
    ).toBe("reached the first lot ID");
    expect(
      stopReason({ nextId: 5000, dated: 0, recentEma: 1, missingStreak: 1000 }),
    ).toBe("no more lots below this ID");
  });
});
