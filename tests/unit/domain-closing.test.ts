import { describe, expect, it } from "vitest";
import {
  applyReading,
  extendedBy,
  initialClosing,
  phaseOf,
  type Reading,
} from "@/lib/domain/closing";

const T0 = Date.parse("2026-11-06T17:00:00Z");
const at = (sec: number) => new Date(T0 + sec * 1000);
const r = (
  obsSec: number,
  status: number | null,
  endSec: number | null,
): Reading => ({
  observedAt: at(obsSec),
  status,
  endAt: endSec === null ? null : at(endSec),
});
const fold = (...readings: Reading[]) =>
  readings.reduce(applyReading, initialClosing());

describe("closing lifecycle", () => {
  it("is open before the end and remembers the original end", () => {
    const s = fold(r(0, 1, 600));
    expect(s).toMatchObject({ phase: "open", final: false, extensions: 0 });
    expect(s.originalEndAt).toEqual(at(600));
  });

  it("follows soft-close extensions and never moves the end earlier", () => {
    const s = fold(r(0, 1, 600), r(590, 1, 1190), r(600, 1, 900));
    expect(s.endAt).toEqual(at(1190));
    expect(s.extensions).toBe(1);
    expect(s.phase).toBe("open");
    expect(extendedBy(s)).toBe(590_000);
  });

  it("goes closing at the end, then final after 60 s with the end unchanged", () => {
    const s1 = fold(r(0, 1, 600), r(630, 1, 600));
    expect(s1.phase).toBe("closing");
    const s2 = applyReading(s1, r(670, 1, 600));
    expect(s2).toMatchObject({ phase: "final", finalReason: "time" });
    expect(s2.closedAt).toEqual(at(600));
  });

  it("re-opens if a late bid extends the end while closing", () => {
    const s = fold(r(0, 1, 600), r(605, 1, 600), r(615, 1, 1200));
    expect(s.phase).toBe("open");
    expect(s.extensions).toBe(1);
  });

  it("finalises on ABC's sold and passed statuses", () => {
    expect(fold(r(0, 1, 600), r(700, 2, 600))).toMatchObject({
      final: true,
      finalReason: "sold",
    });
    expect(fold(r(0, 1, 600), r(700, 3, 600))).toMatchObject({
      final: true,
      finalReason: "passed",
    });
  });

  it("ignores the ~2125 placeholder EndDate on sold lots and keeps the real close time", () => {
    const placeholder = Date.parse("2125-11-04T18:32:58Z");
    const s = fold(r(0, 1, 600), {
      observedAt: at(900),
      status: 2,
      endAt: new Date(placeholder),
    });
    expect(s.closedAt).toEqual(at(600));
    expect(s.endAt).toEqual(at(600));
  });

  it("assumes final 15 minutes after the end if no settled reading came", () => {
    const s = fold(r(1600, 1, 600)); // first reading 1,000 s after the end
    expect(s).toMatchObject({ phase: "final", finalReason: "assumed" });
  });

  it("treats Status 0 as upcoming", () => {
    expect(fold(r(0, 0, 6000)).phase).toBe("upcoming");
  });
});

describe("phaseOf (single snapshot)", () => {
  const now = at(0);
  it("classifies list rows", () => {
    expect(phaseOf(1, at(60), now)).toBe("open");
    expect(phaseOf(1, at(-60), now)).toBe("closing");
    expect(phaseOf(2, new Date("2125-01-01T00:00:00Z"), now)).toBe("final");
    expect(phaseOf(3, at(-60), now)).toBe("final");
    expect(phaseOf(0, null, now)).toBe("upcoming");
  });
});
