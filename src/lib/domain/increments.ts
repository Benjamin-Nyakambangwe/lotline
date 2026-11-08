import type { Cents } from "./money";

/**
 * ABC's bid ladder, read from live lots (Nov 2026): the step depends on the current bid.
 *   under $10: $1 · $10–20: $2 · $20–50: $5 · $50–200: $10 · $200–500: $25 ·
 *   $500–1,000: $50 · $1,000 and up: $100
 * Each band starts on a multiple of its step, so ladder values are band start + k × step.
 */
const LADDER: readonly (readonly [from: Cents, step: Cents])[] = [
  [0, 100],
  [1000, 200],
  [2000, 500],
  [5000, 1000],
  [20000, 2500],
  [50000, 5000],
  [100000, 10000],
];

const bandOf = (amount: Cents) => {
  let band = LADDER[0];
  for (const b of LADDER) if (amount >= b[0]) band = b;
  return band;
};

export function incrementFor(amount: Cents): Cents {
  return bandOf(amount)[1];
}

/**
 * The next minimum bid after `current`: what ABC's lot detail calls StartingBid once a lot has
 * bids. (ABC's search listing reports the opening price under the same name instead.)
 */
export const nextBidAfter = (current: Cents): Cents =>
  current + incrementFor(current);

/** The ladder step above `amount`. */
export const ladderUp = (amount: Cents): Cents =>
  snapDown(amount) + incrementFor(snapDown(amount));

/** The ladder step below `amount` (never below $1). */
export function ladderDown(amount: Cents): Cents {
  const s = snapDown(amount);
  if (s < amount) return s;
  if (s <= 100) return 100;
  const prev = s - incrementFor(s - 1);
  return Math.max(100, snapDown(prev));
}

/** Largest ladder value ≤ amount (minimum $1). */
export function snapDown(amount: Cents): Cents {
  if (amount < 100) return 100;
  const [from, step] = bandOf(amount);
  return from + Math.floor((amount - from) / step) * step;
}
