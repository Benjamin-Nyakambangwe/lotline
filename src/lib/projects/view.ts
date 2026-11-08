import { formatMoney } from "@/lib/domain/money";
import {
  type CandidateState,
  type NeedBudget,
  projectBudget,
} from "../domain/budget";
import { allIn, DEFAULT_RATES, type FeeRates } from "../domain/fees";
import {
  overMax,
  phaseOfRow,
  statusOfRow,
  type WatchRow,
} from "../domain/live";
import type { Confidence, MyStatus } from "../domain/status";

/**
 * A project as the app shows it: needs, ranked candidate lots with live status (the same
 * judgement as the Watchlist), the worst-case budget, and what to do next. Money in cents,
 * times as ISO strings. No bidder IDs (status is computed here, on the server).
 */

export interface CandidateRow extends WatchRow {
  candidateId: string;
  needId: string;
  rank: number;
  state: CandidateState;
  maxHammerOverride: number | null;
  note: string | null;
  thumbUrl: string | null;
  type: number;
  auction: string | null;
  /** cents, once it's closed and sold */
  finalPrice: number | null;
}

export interface NeedRow {
  id: string;
  title: string;
  quantity: number;
  slotMaxHammer: number | null;
  countsTowardBudget: boolean;
  sort: number;
}

export interface CandidateView {
  id: string;
  lotId: number;
  type: number;
  rank: number;
  title: string;
  thumbUrl: string | null;
  auction: string | null;
  state: CandidateState;
  status: MyStatus;
  confidence: Confidence;
  provisional: "winning" | "outbid" | null;
  open: boolean;
  currentBid: number | null;
  nextBid: number | null;
  /** the max that applies: this lot's own, else the need's */
  max: number | null;
  ownMax: boolean;
  allInAtMax: number | null;
  overMax: boolean;
  endAt: string | null;
  finalPrice: number | null;
  /** counted in the worst case as the backup for an unfilled slot */
  planned: boolean;
  note: string | null;
}

export interface NeedView extends NeedRow {
  candidates: CandidateView[];
  budget: NeedBudget;
  /** filled slots (won + leading) */
  filled: number;
  /** a plain-language next step, if there is one */
  suggestion: { text: string; candidateId: string | null } | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const clock = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Harare",
  }).format(d);
const dollars = (c: number) => formatMoney(c);

export function buildProjectView(
  budget: number | null,
  needs: NeedRow[],
  rows: CandidateRow[],
  now: Date,
) {
  const judged = rows.map((r) => {
    const s = statusOfRow(r, now);
    const phase = phaseOfRow(r, now);
    return { r, s, phase, open: phase !== "final" };
  });
  const sorted = [...needs].sort((a, b) => a.sort - b.sort);
  const inputs = sorted.map((n) => ({
    id: n.id,
    quantity: n.quantity,
    slotMaxHammer: n.slotMaxHammer,
    countsTowardBudget: n.countsTowardBudget,
    candidates: judged
      .filter((j) => j.r.needId === n.id)
      .map(({ r, s, open }) => ({
        lotId: r.lotId,
        rank: r.rank,
        state: r.state,
        status: s.status,
        provisional: s.provisional,
        maxHammer: r.maxHammerOverride,
        nextBid: r.startingBid,
        currentBid: r.currentBid,
        myBid: r.myBid,
        open,
        rates: (r.rates ?? DEFAULT_RATES) as FeeRates,
      })),
  }));
  const pb = projectBudget(budget, inputs);

  const views: NeedView[] = sorted.map((n, i) => {
    const b = pb.needs[i];
    const planned = new Set(b.plannedBackups);
    const candidates: CandidateView[] = judged
      .filter((j) => j.r.needId === n.id)
      .sort((a, b2) => a.r.rank - b2.r.rank)
      .map(({ r, s, open }) => {
        const max = r.maxHammerOverride ?? n.slotMaxHammer;
        return {
          id: r.candidateId,
          lotId: r.lotId,
          type: r.type,
          rank: r.rank,
          title: r.title,
          thumbUrl: r.thumbUrl,
          auction: r.auction,
          state: r.state,
          status: s.status,
          confidence: s.confidence,
          provisional: s.provisional,
          open,
          currentBid: r.currentBid,
          nextBid: r.startingBid,
          max,
          ownMax: r.maxHammerOverride !== null,
          allInAtMax:
            max === null ? null : allIn(max, r.rates ?? DEFAULT_RATES),
          overMax: open && overMax({ startingBid: r.startingBid, maxBid: max }),
          endAt: iso(r.endAt),
          finalPrice: r.finalPrice,
          planned: planned.has(r.lotId),
          note: r.note,
        };
      });
    const filled = b.wonCount + b.leadingCount;
    return {
      ...n,
      candidates,
      budget: b,
      filled,
      suggestion: suggest(n, b, candidates),
    };
  });

  return { budget: pb, needs: views };
}

/** What to do next for a need, in a sentence. */
function suggest(
  n: NeedRow,
  b: NeedBudget,
  cs: CandidateView[],
): NeedView["suggestion"] {
  if (b.flags.overfill)
    return {
      text: `You've won ${b.wonCount} for ${n.quantity} needed: one too many.`,
      candidateId: null,
    };
  if (b.flags.overcommit)
    return {
      text: `You're leading or have won ${b.wonCount + b.leadingCount} for ${n.quantity} needed. Bids can't be withdrawn: let one go or raise the quantity.`,
      candidateId: null,
    };
  if (b.remaining === 0) return null;
  const next = cs.find((c) => c.planned);
  if (!next) {
    return cs.length
      ? {
          text: "No backup left within your max. Add lots or raise the max.",
          candidateId: null,
        }
      : { text: "Add lots to this need.", candidateId: null };
  }
  const primary = cs.find((c) => c.state === "active" && c.open) ?? null;
  const when = next.endAt ? ` closes ${clock(new Date(next.endAt))}` : "";
  const price = next.nextBid !== null ? ` at ${dollars(next.nextBid)}` : "";
  const cap = next.max !== null ? ` (your max ${dollars(next.max)})` : "";
  // The best remaining option isn't the top-ranked open lot: offer to promote it.
  const promote = primary && primary.id !== next.id && next.rank > 1;
  return {
    text: `Next up: ${next.title}${when}${price}${cap}.`,
    candidateId: promote ? next.id : null,
  };
}

export type ProjectViewData = ReturnType<typeof buildProjectView>;
