import { phaseOf } from "./closing";
import { allIn, DEFAULT_RATES, type FeeRates } from "./fees";
import type { Cents } from "./money";
import { computeStatus, type StatusResult } from "./status";

/** One watched lot with what we need to judge it (money in cents). */
export interface WatchRow {
  lotId: number;
  title: string;
  status: number | null;
  finalState: string;
  finalReason: string | null;
  currentBid: Cents | null;
  /** next minimum bid */
  startingBid: Cents | null;
  /** the lot's current leader (kept only while someone tracks it; never sent to browsers) */
  leaderId: number | null;
  endAt: Date | null;
  originalEndAt: Date | null;
  extensions: number;
  stc: boolean;
  rates: FeeRates | null;
  myBidderId: number | null;
  myBid: Cents | null;
  maxBid: Cents | null;
  everLed: boolean;
}

export function phaseOfRow(r: WatchRow, now: Date) {
  return r.finalState === "final" || r.finalState === "final_assumed"
    ? ("final" as const)
    : phaseOf(r.status, r.endAt, now);
}

/** This person's status on a lot: the one judgement shared by the worker and the web app. */
export function statusOfRow(r: WatchRow, now: Date): StatusResult {
  return computeStatus({
    phase: phaseOfRow(r, now),
    passed: r.finalReason === "passed",
    currentBid: r.currentBid,
    leaderId: r.leaderId,
    myBidderId: r.myBidderId,
    myBid: r.myBid,
    everLed: r.everLed,
    stc: r.stc,
  });
}

/** The next bid would take this person past their own max. */
export const overMax = (r: Pick<WatchRow, "startingBid" | "maxBid">) =>
  r.maxBid !== null && r.startingBid !== null && r.startingBid > r.maxBid;

export const allInNext = (r: Pick<WatchRow, "startingBid" | "rates">) =>
  r.startingBid === null
    ? null
    : allIn(r.startingBid, r.rates ?? DEFAULT_RATES);
