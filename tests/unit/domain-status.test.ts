import { describe, expect, it } from "vitest";
import { computeStatus, type StatusInput } from "@/lib/domain/status";

const ME = 900_000_001;
const OTHER = 900_000_002;
const base: StatusInput = {
  phase: "open",
  currentBid: 4500,
  leaderId: OTHER,
  myBidderId: ME,
  myBid: null,
  everLed: false,
};
const s = (o: Partial<StatusInput>) => computeStatus({ ...base, ...o });

describe("status with a linked bidder ID (exact)", () => {
  it.each([
    ["leader is me", { leaderId: ME }, "winning"],
    ["I led before, now someone else", { everLed: true }, "outbid"],
    ["I entered a bid, someone else leads", { myBid: 4000 }, "outbid"],
    ["someone else leads, no sign I bid", {}, "watching"],
    [
      "nobody has bid yet",
      { leaderId: null, currentBid: null, myBid: 4000 },
      "watching",
    ],
  ] as const)("open: %s → %s", (_n, o, expected) => {
    const res = s(o);
    expect(res.status).toBe(expected);
    expect(res.confidence).toBe("exact");
  });

  it("reports leadingNow so the worker can record ever_led", () => {
    expect(s({ leaderId: ME }).leadingNow).toBe(true);
    expect(s({}).leadingNow).toBe(false);
  });

  it("shows closing with a provisional result until final", () => {
    expect(s({ phase: "closing", leaderId: ME })).toMatchObject({
      status: "closing",
      provisional: "winning",
    });
    expect(s({ phase: "closing", everLed: true })).toMatchObject({
      status: "closing",
      provisional: "outbid",
    });
    expect(s({ phase: "closing" })).toMatchObject({
      status: "closing",
      provisional: null,
    });
  });

  it("decides won and lost only at final", () => {
    expect(s({ phase: "final", leaderId: ME })).toMatchObject({
      status: "won",
      confidence: "exact",
    });
    expect(s({ phase: "final", everLed: true })).toMatchObject({
      status: "lost",
      confidence: "exact",
    });
    expect(s({ phase: "final" })).toMatchObject({ status: "ended" });
    expect(
      s({ phase: "final", passed: true, currentBid: null, leaderId: null }),
    ).toMatchObject({ status: "passed" });
  });
});

describe("status from my bid figure (estimate)", () => {
  const u = (o: Partial<StatusInput>) =>
    s({ myBidderId: null, leaderId: OTHER, ...o });

  it.each([
    ["my bid above current", { myBid: 5000, currentBid: 4500 }, "winning"],
    ["my bid equals current", { myBid: 5000, currentBid: 5000 }, "winning"],
    ["current above my bid", { myBid: 5000, currentBid: 5500 }, "outbid"],
    ["no bid figure", { myBid: null }, "watching"],
  ] as const)("open: %s → %s", (_n, o, expected) => {
    const res = u(o);
    expect(res.status).toBe(expected);
    expect(res.confidence).toBe("estimate");
  });

  it("flags estimated wins for confirmation", () => {
    expect(u({ phase: "final", myBid: 5000, currentBid: 5000 })).toMatchObject({
      status: "won",
      needsConfirmation: true,
    });
    expect(u({ phase: "final", myBid: 4500, currentBid: 5000 })).toMatchObject({
      status: "lost",
    });
  });
});

describe("other cases", () => {
  it("upcoming lots are just watched", () => {
    expect(s({ phase: "upcoming" }).status).toBe("watching");
  });
  it("passes STC through", () => {
    expect(s({ stc: true, leaderId: ME }).stc).toBe(true);
  });
});
