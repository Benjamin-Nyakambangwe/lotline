import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Recorded ABC payloads must never contain real bidder IDs: scripts/discover-abc.ts
// maps every CurrentBidderId into this reserved fake range before writing a fixture.
const FAKE_MIN = 900_000_001;
const FAKE_MAX = 900_000_999;
const DIR = join(import.meta.dirname, "..", "fixtures", "abc");

function walk(value: unknown, visit: (key: string, v: unknown) => void) {
  if (Array.isArray(value)) {
    for (const v of value) walk(v, visit);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      visit(k, v);
      walk(v, visit);
    }
  }
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));

describe("ABC fixtures", () => {
  it("exist", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s contains only scrubbed bidder data", (file) => {
    const data = JSON.parse(readFileSync(join(DIR, file), "utf8"));
    walk(data, (key, v) => {
      if (key === "CurrentBidderId" && v !== null) {
        expect(typeof v).toBe("number");
        expect(v as number).toBeGreaterThanOrEqual(FAKE_MIN);
        expect(v as number).toBeLessThanOrEqual(FAKE_MAX);
      }
      if (key === "MaxBid") expect(v).toBeNull();
      if (key === "HighestBidder" || key === "Watching") expect(v).toBe(false);
    });
  });
});
