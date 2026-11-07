import type { Cents } from "./money";

/**
 * ABC's observed bid ladder: $1 steps below $10, $2 from $10 to $20, $5 from $20 to $50,
 * $10 from $50. This is a hint for steppers and "max hammer" suggestions only: the real
 * next bid is always the API's StartingBid.
 */
export function incrementFor(amount: Cents): Cents {
  if (amount < 1000) return 100;
  if (amount < 2000) return 200;
  if (amount < 5000) return 500;
  return 1000;
}

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
  if (amount < 1000) return Math.floor(amount / 100) * 100;
  if (amount < 2000) return 1000 + Math.floor((amount - 1000) / 200) * 200;
  if (amount < 5000) return 2000 + Math.floor((amount - 2000) / 500) * 500;
  return 5000 + Math.floor((amount - 5000) / 1000) * 1000;
}
