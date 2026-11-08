import { describe, expect, it } from "vitest";
import { dealRating, summarize } from "@/lib/domain/deal";
import { defaultPayBy } from "@/lib/domain/payby";
import {
  formatClock,
  formatCountdown,
  formatWhen,
  localDate,
} from "@/lib/domain/time";
import {
  cpuOf,
  extractAttrs,
  normalizeTitle,
  quantityOf,
} from "@/lib/domain/titles";

describe("pay-by", () => {
  it("is four days after the close date in Harare: Friday → Tuesday", () => {
    expect(defaultPayBy(new Date("2026-11-06T17:36:40Z"))).toBe("2026-11-10");
  });
  it("uses the Harare date, so a 01:30 Saturday close is due Wednesday", () => {
    expect(defaultPayBy(new Date("2026-11-06T23:30:00Z"))).toBe("2026-11-11");
  });
});

describe("time", () => {
  it("formats countdowns", () => {
    expect(formatCountdown(3_912_000)).toBe("1:05:12");
    expect(formatCountdown(545_000)).toBe("9:05");
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown((4 * 86_400 + 3600 + 300 + 5) * 1000)).toBe(
      "4d 1h 05m",
    );
    expect(
      formatCountdown((4 * 86_400 + 3600 + 300 + 5) * 1000, { seconds: true }),
    ).toBe("4d 01:05:05");
    expect(formatCountdown(3_912_000, { seconds: true })).toBe("1:05:12");
  });
  it("says when, relative to today in Harare", () => {
    const now = new Date("2026-11-07T18:00:00Z"); // Sat 20:00 CAT
    expect(formatWhen(new Date("2026-11-07T19:30:00Z"), now)).toBe(
      "today 21:30",
    );
    expect(formatWhen(new Date("2026-11-07T22:30:00Z"), now)).toBe(
      "tomorrow 00:30",
    );
    expect(formatWhen(new Date("2026-11-10T17:00:00Z"), now)).toBe(
      "Tue 10 Nov 19:00",
    );
  });
  it("shows clock times in Harare", () => {
    expect(formatClock(new Date("2026-11-06T17:36:40Z"))).toBe("Fri 19:36");
    expect(localDate(new Date("2026-11-06T22:30:00Z"))).toBe("2026-11-07");
  });
});

describe("deal rating", () => {
  it("needs at least 5 comparables", () => {
    expect(dealRating(10000, 5000, 4)).toBeNull();
  });
  it("uses the planner thresholds", () => {
    expect(dealRating(10000, 5000, 9)?.tier).toBe("good"); // 2×
    expect(dealRating(30000, 5000, 9)?.tier).toBe("steal"); // 6×
    expect(dealRating(5000, 5000, 9)?.tier).toBe("fair");
    expect(dealRating(4000, 5000, 9)?.tier).toBe("over");
  });
  it("summarises prices with percentiles", () => {
    expect(summarize([30, 45, 55, 55, 70, 95])).toMatchObject({
      n: 6,
      median: 55,
      min: 30,
      max: 95,
    });
  });
});

describe("titles", () => {
  it("extracts CPUs like the homelab poller did", () => {
    expect(
      cpuOf("Dell OptiPlex 7070 Micro with Intel Core i5 9th Gen sticker"),
    ).toBe("i5 · 9th gen");
    expect(
      cpuOf("Compact Dell OptiPlex 7060 Micro, featuring Intel Core i5"),
    ).toBe("i5");
    expect(cpuOf("Compact micro desktop with multiple ports")).toBe("");
  });
  it("normalises titles but keeps part numbers", () => {
    expect(normalizeTitle("  Cisco 899G-LTE  Router <b>(3 units)</b> ")).toBe(
      "cisco 899g-lte router 3 units",
    );
  });
  it("picks out model tokens and specs", () => {
    expect(extractAttrs("Dell OptiPlex 7070 Micro Desktop").models).toContain(
      "7070",
    );
    expect(extractAttrs("Cisco 899G-LTE router").models).toContain("899g");
    expect(extractAttrs("HP laptop 8GB RAM 256GB SSD")).toMatchObject({
      ramGb: 8,
      storage: "256 GB SSD",
    });
  });
  it("parses quantities", () => {
    expect(quantityOf("3 units")).toBe(3);
    expect(quantityOf("Set of 8 (1 table, 1 console, 6 chairs)")).toBe(8);
    expect(quantityOf(null)).toBe(1);
  });
});
