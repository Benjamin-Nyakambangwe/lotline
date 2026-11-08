import type { MarketRow } from "../db/queries/market";
import { summarize } from "../domain/deal";
import { localDate } from "../domain/time";
import { computeRuns } from "../search/runs";

const median = (xs: number[]) => summarize(xs).median;

/**
 * What a kind of lot sells for: price spread, monthly trend, and whether lots late in a run of
 * near-identical lots go for more than early ones (they often do: people who lose an early lot
 * bid on the next). Money in cents.
 */
export function marketSummary(rows: MarketRow[], tz?: string) {
  const sold = rows.filter((r) => r.hammer !== null);
  const hammers = sold.map((r) => r.hammer as number);
  const allIns = sold.flatMap((r) => (r.allIn === null ? [] : [r.allIn]));
  const units = sold.flatMap((r) =>
    r.unitPrice === null ? [] : [r.unitPrice],
  );

  const months = new Map<string, number[]>();
  for (const r of sold)
    if (r.closedAt) {
      const m = localDate(new Date(r.closedAt), tz).slice(0, 7);
      months.set(m, [...(months.get(m) ?? []), r.hammer as number]);
    }

  // Position in a run: same kind of lot closing the same evening.
  const runs = computeRuns(
    sold.map((r) => ({ id: r.lotId, title: r.title, endAt: r.closedAt })),
    tz,
  );
  const early: number[] = [];
  const late: number[] = [];
  for (const r of sold) {
    const run = runs.get(r.lotId);
    if (!run || run.size < 3) continue;
    const at = (run.position - 1) / (run.size - 1);
    if (at <= 1 / 3) early.push(r.hammer as number);
    else if (at >= 2 / 3) late.push(r.hammer as number);
  }

  return {
    matched: rows.length,
    sold: sold.length,
    passedUnsold: rows.length - sold.length,
    hammer: summarize(hammers),
    allIn: summarize(allIns),
    unitPrice: units.length !== hammers.length ? summarize(units) : null,
    byMonth: [...months]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, xs]) => ({ month, n: xs.length, median: median(xs) })),
    runPosition:
      early.length >= 3 && late.length >= 3
        ? {
            earlyMedian: median(early),
            earlyN: early.length,
            lateMedian: median(late),
            lateN: late.length,
          }
        : null,
    recent: rows.slice(0, 12),
  };
}
