/**
 * Soft-close aware lifecycle of a lot, driven by successive readings from ABC.
 *
 * ABC facts this encodes (see docs/abc-api.md):
 * - A bid in the last 10 minutes moves EndDate to bid time + 10 minutes, so EndDate is
 *   re-read every time and may only move later.
 * - Status: 0 pending, 1 open, 2 closed with a sale, 3 ended with no bids (passed).
 * - Sold lots later get a placeholder EndDate ~100 years ahead. Never trust such dates;
 *   keep the last real EndDate as the close time.
 * - "Available" lots can already be over, so "open" means Status 1 and end in the future.
 */

export type Phase = "upcoming" | "open" | "closing" | "final";
export type FinalReason = "sold" | "passed" | "time" | "assumed";

export const STATUS = { pending: 0, open: 1, sold: 2, passed: 3 } as const;

/** A reading taken ≥ this long after the end, with the end unchanged, counts as final. */
export const FINAL_AFTER_MS = 60_000;
/** Stop waiting for a final reading this long after the end. */
export const ASSUME_FINAL_AFTER_MS = 15 * 60_000;
const PLACEHOLDER_AHEAD_MS = 365 * 24 * 3600_000;

export interface Reading {
  observedAt: Date;
  status: number | null;
  /** EndDate exactly as ABC returned it (may be a placeholder) */
  endAt: Date | null;
}

export interface ClosingState {
  phase: Phase;
  final: boolean;
  finalReason: FinalReason | null;
  /** last real end time we believe in */
  endAt: Date | null;
  /** the first real end time we saw (before any soft-close extension) */
  originalEndAt: Date | null;
  extensions: number;
  /** when the lot closed (= endAt at the moment it became final) */
  closedAt: Date | null;
  lastReadAt: Date | null;
  /** consecutive readings after the end with the end unchanged */
  stableAfterEnd: number;
}

export const isPlaceholderEnd = (end: Date | null, now: Date): boolean =>
  !!end && end.getTime() - now.getTime() > PLACEHOLDER_AHEAD_MS;

export const initialClosing = (): ClosingState => ({
  phase: "upcoming",
  final: false,
  finalReason: null,
  endAt: null,
  originalEndAt: null,
  extensions: 0,
  closedAt: null,
  lastReadAt: null,
  stableAfterEnd: 0,
});

/** Fold one reading into the state. Pure: returns a new state. */
export function applyReading(prev: ClosingState, r: Reading): ClosingState {
  if (prev.final) return { ...prev, lastReadAt: r.observedAt };
  const now = r.observedAt;
  const s: ClosingState = { ...prev, lastReadAt: now };

  // 1. End time: ignore placeholders; only ever move later (soft close).
  const raw = r.endAt && !isPlaceholderEnd(r.endAt, now) ? r.endAt : null;
  let endChanged = false;
  if (raw) {
    if (!s.endAt) {
      s.endAt = raw;
      s.originalEndAt = s.originalEndAt ?? raw;
      endChanged = true;
    } else if (raw.getTime() > s.endAt.getTime()) {
      s.endAt = raw;
      s.extensions += 1;
      endChanged = true;
    }
  }

  // 2. Explicit terminal statuses from ABC.
  if (r.status === STATUS.sold || r.status === STATUS.passed) {
    return finalize(s, r.status === STATUS.sold ? "sold" : "passed");
  }
  if (r.status === STATUS.pending)
    return { ...s, phase: "upcoming", stableAfterEnd: 0 };

  // 3. Open or closing, by time.
  if (!s.endAt || now.getTime() < s.endAt.getTime()) {
    return { ...s, phase: "open", stableAfterEnd: 0 };
  }

  const sinceEnd = now.getTime() - s.endAt.getTime();
  const stable = endChanged ? 0 : s.stableAfterEnd + 1;
  if (sinceEnd >= FINAL_AFTER_MS && stable >= 1 && !endChanged) {
    return finalize({ ...s, stableAfterEnd: stable }, "time");
  }
  if (sinceEnd >= ASSUME_FINAL_AFTER_MS)
    return finalize({ ...s, stableAfterEnd: stable }, "assumed");
  return { ...s, phase: "closing", stableAfterEnd: stable };
}

function finalize(s: ClosingState, reason: FinalReason): ClosingState {
  return {
    ...s,
    phase: "final",
    final: true,
    finalReason: reason,
    closedAt: s.endAt ?? s.lastReadAt,
  };
}

/** Phase from a single snapshot (no history), for display of rows that aren't tracked. */
export function phaseOf(
  status: number | null,
  endAt: Date | null,
  now: Date,
): Phase {
  if (status === STATUS.sold || status === STATUS.passed) return "final";
  if (status === STATUS.pending) return "upcoming";
  if (!endAt || isPlaceholderEnd(endAt, now))
    return status === STATUS.open ? "open" : "final";
  return now.getTime() < endAt.getTime() ? "open" : "closing";
}

/** How much soft close has pushed the end back, in ms. */
export const extendedBy = (
  s: Pick<ClosingState, "endAt" | "originalEndAt">,
): number =>
  s.endAt && s.originalEndAt
    ? Math.max(0, s.endAt.getTime() - s.originalEndAt.getTime())
    : 0;
