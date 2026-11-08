import { describe, expect, it } from "vitest";
import { marketSummary } from "@/lib/assistant/market";
import { contextMessage, SYSTEM_PROMPT } from "@/lib/assistant/prompt";
import { plainText, TOOL_DEFINITIONS } from "@/lib/assistant/tools";
import type { MarketRow } from "@/lib/db/queries/market";

const sale = (id: number, hammer: number, closedAt: string): MarketRow => ({
  lotId: id,
  title: "Dell OptiPlex 7060 Micro",
  hammer,
  allIn: Math.round(hammer * 1.2021),
  unitPrice: hammer,
  quantity: 1,
  closedAt,
  location: "Harare",
  auction: null,
  condition: null,
  category: null,
});

describe("market summary", () => {
  it("measures the run effect: late lots in a run of similar lots fetch more", () => {
    // Two evenings, six 7060s each, closing 20 s apart: early ones $50, late ones $70-80.
    const rows: MarketRow[] = [];
    let id = 1;
    for (const day of ["2026-11-05", "2026-11-06"])
      for (const [i, h] of [5000, 5000, 5500, 6500, 7000, 8000].entries())
        rows.push(sale(id++, h, `${day}T17:0${i}:00Z`));
    rows.push({
      ...sale(id++, 0, "2026-11-06T18:00:00Z"),
      hammer: null,
      allIn: null,
    });
    const s = marketSummary(rows, "Africa/Harare");
    expect(s.sold).toBe(12);
    expect(s.passedUnsold).toBe(1);
    expect(s.runPosition).toEqual({
      earlyMedian: 5000,
      earlyN: 4,
      lateMedian: 7500,
      lateN: 4,
    });
    expect(s.byMonth).toEqual([{ month: "2026-11", n: 12, median: 6000 }]);
  });
});

describe("assistant prompt and tools", () => {
  it("keeps the system prompt free of anything that changes per request", () => {
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}|\$\{/);
    expect(TOOL_DEFINITIONS.map((t) => t.name)).toEqual(
      [...TOOL_DEFINITIONS.map((t) => t.name)].sort(),
    );
    expect(TOOL_DEFINITIONS.every((t) => t.eager_input_streaming)).toBe(true);
  });

  it("puts time, name, location and allowance in the per-turn context", () => {
    const c = contextMessage({
      now: new Date("2026-11-08T13:05:00Z"),
      name: "Tendai",
      location: "Harare",
      leftCents: 840,
      capCents: 1000,
    });
    expect(c).toContain("15:05");
    expect(c).toContain("Sunday, 8 November 2026");
    expect(c).toContain("Tendai");
    expect(c).toContain("Harare");
    expect(c).toContain("$8.40 of $10");
  });

  it("turns lot descriptions into capped plain text", () => {
    expect(
      plainText(
        "<p>Intel i5 &amp; 8GB<br>256GB SSD</p><ul><li>Tested</li></ul>",
      ),
    ).toBe("Intel i5 & 8GB\n256GB SSD\n Tested");
    expect(plainText("x".repeat(2000))?.length).toBe(1501);
  });
});
