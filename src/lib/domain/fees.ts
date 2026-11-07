import { ladderUp, snapDown } from "./increments";
import type { Cents } from "./money";

/**
 * Per-lot fee rates from the ABC detail endpoint.
 * all-in = hammer × (1 + lotVat) + hammer × levy × (1 + vat)
 * With lotVat = 0 that is hammer × 1.202125.
 */
export interface FeeRates {
  levy: number;
  vat: number;
  lotVat: number;
  /** true until the lot's detail has been fetched and real rates are known */
  estimated: boolean;
}

export const DEFAULT_RATES: FeeRates = {
  levy: 0.175,
  vat: 0.155,
  lotVat: 0,
  estimated: true,
};

export function ratesFrom(detail: {
  levy?: number | null;
  vat?: number | null;
  lotVat?: number | null;
}): FeeRates {
  const known = detail.levy != null && detail.vat != null;
  return {
    levy: detail.levy ?? DEFAULT_RATES.levy,
    vat: detail.vat ?? DEFAULT_RATES.vat,
    lotVat: detail.lotVat ?? 0,
    estimated: !known,
  };
}

export interface FeeBreakdown {
  hammer: Cents;
  lotVat: Cents;
  levy: Cents;
  levyVat: Cents;
  allIn: Cents;
}

export function feeBreakdown(
  hammer: Cents,
  r: FeeRates = DEFAULT_RATES,
): FeeBreakdown {
  const lotVat = hammer * r.lotVat;
  const levy = hammer * r.levy;
  const levyVat = levy * r.vat;
  return {
    hammer,
    lotVat: Math.round(lotVat),
    levy: Math.round(levy),
    levyVat: Math.round(levyVat),
    allIn: Math.round(hammer + lotVat + levy + levyVat),
  };
}

export const allIn = (hammer: Cents, r: FeeRates = DEFAULT_RATES): Cents =>
  feeBreakdown(hammer, r).allIn;

export const allInOrNull = (
  hammer: Cents | null | undefined,
  r: FeeRates = DEFAULT_RATES,
): Cents | null =>
  hammer === null || hammer === undefined ? null : allIn(hammer, r);

/** Effective multiplier, e.g. 1.202125. */
export const feeMultiplier = (r: FeeRates = DEFAULT_RATES): number =>
  1 + r.lotVat + r.levy * (1 + r.vat);

/**
 * The largest hammer price whose all-in cost stays within `target`.
 * `snap` rounds down to ABC's bid ladder. Also returns the next step up, so the UI can say
 * "$45 keeps you under $60 all-in; $50 would be $60.11".
 */
export function maxHammerFor(
  target: Cents,
  r: FeeRates = DEFAULT_RATES,
  { snap = true }: { snap?: boolean } = {},
): { hammer: Cents; allIn: Cents; next: { hammer: Cents; allIn: Cents } } {
  let hammer = Math.floor(target / feeMultiplier(r));
  while (hammer > 0 && allIn(hammer, r) > target) hammer--;
  if (snap) hammer = snapDown(hammer);
  while (snap && hammer > 100 && allIn(hammer, r) > target)
    hammer = snapDown(hammer - 1);
  const nextHammer = snap ? ladderUp(hammer) : hammer + 1;
  return {
    hammer,
    allIn: allIn(hammer, r),
    next: { hammer: nextHammer, allIn: allIn(nextHammer, r) },
  };
}
