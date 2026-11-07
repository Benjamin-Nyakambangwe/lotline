import type { Cents } from "./money";

export type DealTier = "absurd" | "steal" | "great" | "good" | "fair" | "over";

/** Minimum comparable sales before we show a rating at all. */
export const MIN_COMPARABLES = 5;

/**
 * Rate a price against what similar lots typically sell for (both all-in).
 * Thresholds carried over from the homelab planner.
 */
export function dealRating(
  typicalMedian: Cents | null,
  price: Cents | null,
  comparables: number,
): { tier: DealTier; ratio: number; label: string } | null {
  if (!typicalMedian || !price || price <= 0 || comparables < MIN_COMPARABLES)
    return null;
  const ratio = typicalMedian / price;
  const tier: DealTier =
    ratio >= 20
      ? "absurd"
      : ratio >= 6
        ? "steal"
        : ratio >= 3
          ? "great"
          : ratio >= 1.5
            ? "good"
            : ratio >= 1
              ? "fair"
              : "over";
  return { tier, ratio, label: DEAL_LABEL[tier] };
}

export const DEAL_LABEL: Record<DealTier, string> = {
  absurd: "Absurd deal",
  steal: "Steal",
  great: "Great deal",
  good: "Good deal",
  fair: "Fair",
  over: "Over typical",
};

/** Percentile of a sorted numeric array (linear interpolation). */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export interface PriceSummary {
  n: number;
  median: number | null;
  p25: number | null;
  p75: number | null;
  p10: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
}

export function summarize(values: number[]): PriceSummary {
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    median: percentile(s, 0.5),
    p25: percentile(s, 0.25),
    p75: percentile(s, 0.75),
    p10: percentile(s, 0.1),
    p90: percentile(s, 0.9),
    min: s[0] ?? null,
    max: s[s.length - 1] ?? null,
  };
}
