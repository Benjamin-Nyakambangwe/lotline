import { allIn, type FeeRates } from "./fees";
import type { Cents } from "./money";
import type { MyStatus } from "./status";

/**
 * Project budgets, in all-in money (hammer plus levy and VAT).
 *
 * A project has needs ("2× Proxmox node"), each with ranked candidate lots: rank 1 is the
 * primary, the rest are ordered backups. Bids can't be withdrawn on ABC, so a lot you're
 * winning is already a commitment.
 *
 *   worst = won + leading + unfilled
 *   - won:      actual all-in of lots won (all of them, even beyond the quantity)
 *   - leading:  all-in of lots you're winning now, at your bid (your bid can be pushed to it)
 *   - unfilled: for each still-open slot, the next viable backup's max, in rank order
 */

export type CandidateState = "active" | "skipped" | "won" | "lost" | "ended";

export interface CandidateInput {
  lotId: number;
  rank: number;
  state: CandidateState;
  status: MyStatus;
  provisional?: "winning" | "outbid" | null;
  /** per-candidate max (hammer); falls back to the need's slot max */
  maxHammer: Cents | null;
  nextBid: Cents | null;
  currentBid: Cents | null;
  myBid: Cents | null;
  /** still biddable (open and not final) */
  open: boolean;
  rates: FeeRates;
}

export interface NeedInput {
  id: string;
  quantity: number;
  slotMaxHammer: Cents | null;
  countsTowardBudget: boolean;
  candidates: CandidateInput[];
}

export interface NeedBudget {
  id: string;
  won: Cents;
  wonCount: number;
  leading: Cents;
  leadingNow: Cents;
  leadingCount: number;
  unfilled: Cents;
  remaining: number;
  worst: Cents;
  now: Cents;
  /** next backups that would fill the remaining slots, in order */
  plannedBackups: number[];
  flags: { overfill: boolean; overcommit: boolean; shortfall: boolean };
}

const isWon = (c: CandidateInput) => c.state === "won" || c.status === "won";
const isLeading = (c: CandidateInput) =>
  !isWon(c) &&
  (c.status === "winning" ||
    (c.status === "closing" && c.provisional === "winning"));

export function needBudget(n: NeedInput): NeedBudget {
  const won = n.candidates.filter(isWon);
  const leading = n.candidates.filter(isLeading);
  const wonSum = won.reduce((a, c) => a + allIn(c.currentBid ?? 0, c.rates), 0);
  const leadSum = leading.reduce(
    (a, c) => a + allIn(c.myBid ?? c.currentBid ?? 0, c.rates),
    0,
  );
  const leadNow = leading.reduce(
    (a, c) => a + allIn(c.currentBid ?? 0, c.rates),
    0,
  );
  const remaining = Math.max(0, n.quantity - won.length - leading.length);

  const viable = n.candidates
    .filter((c) => !isWon(c) && !isLeading(c) && c.state === "active" && c.open)
    .filter((c) => {
      const max = c.maxHammer ?? n.slotMaxHammer;
      return max === null || c.nextBid === null || c.nextBid <= max;
    })
    .sort((a, b) => a.rank - b.rank);

  const planned = viable.slice(0, remaining);
  let unfilled = planned.reduce((a, c) => {
    const max = c.maxHammer ?? n.slotMaxHammer ?? c.nextBid ?? 0;
    return a + allIn(max, c.rates);
  }, 0);
  const missing = remaining - planned.length;
  if (missing > 0 && n.slotMaxHammer !== null) {
    const rates = n.candidates[0]?.rates;
    unfilled += missing * allIn(n.slotMaxHammer, rates);
  }

  return {
    id: n.id,
    won: wonSum,
    wonCount: won.length,
    leading: leadSum,
    leadingNow: leadNow,
    leadingCount: leading.length,
    unfilled,
    remaining,
    worst: wonSum + leadSum + unfilled,
    now: wonSum + leadNow,
    plannedBackups: planned.map((c) => c.lotId),
    flags: {
      overfill: won.length > n.quantity,
      overcommit: won.length + leading.length > n.quantity,
      shortfall: missing > 0,
    },
  };
}

export interface ProjectBudget {
  budget: Cents | null;
  won: Cents;
  leading: Cents;
  unfilled: Cents;
  worst: Cents;
  now: Cents;
  left: Cents | null;
  needs: NeedBudget[];
  flags: {
    overBudget: boolean;
    overcommit: boolean;
    shortfall: boolean;
    overfill: boolean;
  };
}

export function projectBudget(
  budget: Cents | null,
  needs: NeedInput[],
): ProjectBudget {
  const per = needs.map(needBudget);
  const counted = per.filter((_, i) => needs[i].countsTowardBudget);
  const sum = (k: "won" | "leading" | "unfilled" | "worst" | "now") =>
    counted.reduce((a, b) => a + b[k], 0);
  const worst = sum("worst");
  return {
    budget,
    won: sum("won"),
    leading: sum("leading"),
    unfilled: sum("unfilled"),
    worst,
    now: sum("now"),
    left: budget === null ? null : budget - worst,
    needs: per,
    flags: {
      overBudget: budget !== null && worst > budget,
      overcommit: per.some((b) => b.flags.overcommit),
      shortfall: per.some((b) => b.flags.shortfall),
      overfill: per.some((b) => b.flags.overfill),
    },
  };
}
