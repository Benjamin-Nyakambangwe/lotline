import type { Phase } from "./closing";
import type { Cents } from "./money";

/**
 * My status on a lot. One function, used by the worker (to detect transitions and notify)
 * and by the web app (to render), so they can never disagree.
 *
 * Exact status needs the user's ABC bidder ID: ABC publishes the current leader's bidder ID
 * on every lot. Without it we fall back to the user's own "my bid" figure (an estimate).
 */
export type MyStatus =
  | "watching"
  | "winning"
  | "outbid"
  | "closing"
  | "won"
  | "lost"
  | "passed"
  | "ended";
export type Confidence = "exact" | "estimate";

export interface StatusInput {
  phase: Phase;
  /** true when ABC says it closed with no bids (Status 3), or it closed with no current bid */
  passed?: boolean;
  currentBid: Cents | null;
  /** ABC's CurrentBidderId: the current (or final) leader */
  leaderId: number | null;
  /** the user's linked ABC bidder ID, if any */
  myBidderId: number | null;
  /** the highest amount the user says they bid (or set as a proxy max) on ABC */
  myBid: Cents | null;
  /** we have seen this user lead this lot before */
  everLed: boolean;
  stc?: boolean;
}

export interface StatusResult {
  status: MyStatus;
  confidence: Confidence;
  /** while closing: what the status will most likely become */
  provisional: "winning" | "outbid" | null;
  /** an estimated win that the user should confirm */
  needsConfirmation: boolean;
  /** subject to confirmation by ABC */
  stc: boolean;
  /** this reading shows the user leading (the caller records ever_led) */
  leadingNow: boolean;
}

export function computeStatus(i: StatusInput): StatusResult {
  const linked = i.myBidderId !== null;
  const leadingNow =
    linked && i.leaderId !== null && i.leaderId === i.myBidderId;
  const involved = leadingNow || i.everLed || i.myBid !== null;
  const base = {
    provisional: null,
    needsConfirmation: false,
    stc: !!i.stc,
    leadingNow,
  } as const;

  if (i.phase === "upcoming")
    return { ...base, status: "watching", confidence: "exact" };

  // Live or closing: who is ahead right now?
  const ahead = (): { s: "winning" | "outbid" | null; c: Confidence } => {
    if (linked) {
      if (leadingNow) return { s: "winning", c: "exact" };
      // No leader yet means nobody has bid (or ABC hasn't caught up): not "outbid".
      if (i.leaderId === null) return { s: null, c: "exact" };
      if (i.everLed || i.myBid !== null) return { s: "outbid", c: "exact" };
      return { s: null, c: "exact" };
    }
    if (i.myBid === null) return { s: null, c: "estimate" };
    return i.currentBid === null || i.currentBid <= i.myBid
      ? { s: "winning", c: "estimate" }
      : { s: "outbid", c: "estimate" };
  };

  if (i.phase === "open") {
    const a = ahead();
    return { ...base, status: a.s ?? "watching", confidence: a.c };
  }

  if (i.phase === "closing") {
    const a = ahead();
    if (!involved) return { ...base, status: "closing", confidence: "exact" };
    return { ...base, status: "closing", confidence: a.c, provisional: a.s };
  }

  // Final: never declared before the close is confirmed.
  if (i.passed || i.currentBid === null)
    return {
      ...base,
      status: involved ? "lost" : "passed",
      confidence: "exact",
    };
  if (linked) {
    if (leadingNow) return { ...base, status: "won", confidence: "exact" };
    return {
      ...base,
      status: involved ? "lost" : "ended",
      confidence: "exact",
    };
  }
  if (i.myBid === null)
    return { ...base, status: "ended", confidence: "estimate" };
  return i.myBid >= i.currentBid
    ? {
        ...base,
        status: "won",
        confidence: "estimate",
        needsConfirmation: true,
      }
    : { ...base, status: "lost", confidence: "estimate" };
}

/** Label for UI and notifications. Always paired with an icon in the UI. */
export const STATUS_LABEL: Record<MyStatus, string> = {
  watching: "Watching",
  winning: "Winning",
  outbid: "Outbid",
  closing: "Closing…",
  won: "Won",
  lost: "Lost",
  passed: "No bids",
  ended: "Ended",
};
