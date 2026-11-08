import { sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { normalizeTitle } from "../../domain/titles";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export interface MarketRow {
  lotId: number;
  title: string;
  /** cents; null when the lot passed unsold */
  hammer: number | null;
  allIn: number | null;
  unitPrice: number | null;
  quantity: number;
  closedAt: string | null;
  location: string | null;
  auction: string | null;
  condition: string | null;
  category: string | null;
}

/** Words of a search, normalised like titles; short noise words dropped. */
export const queryWords = (q: string) =>
  [...new Set(normalizeTitle(q).split(" "))].filter((w) => w.length >= 2);

/**
 * Closed lots (sold and passed) whose titles contain every word of the query, newest first.
 * From Lotline's market data: the sold sweep, closes we saw, and the 12-month backfill.
 */
export async function findClosedLots(
  db: AnyDb,
  query: string,
  opts: { months?: number; location?: string | null; limit?: number } = {},
): Promise<MarketRow[]> {
  const words = queryWords(query);
  if (!words.length) return [];
  const like = sql.join(
    words.map(
      (w) => sql`cp.title_norm like ${`%${w.replace(/[%_\\]/g, "\\$&")}%`}`,
    ),
    sql` and `,
  );
  const res = await db.execute(sql`
    select cp.lot_id, cp.title, cp.final_hammer, cp.all_in, cp.unit_price, cp.quantity_n,
           cp.closed_at, cp.location, cp.campaign, cp.condition, cp.final_category
    from closed_prices cp
    where ${like}
      and (cp.closed_at is null or cp.closed_at > now() - make_interval(months => ${opts.months ?? 12}))
      and (${opts.location ?? null}::text is null or cp.location = ${opts.location ?? null})
    order by cp.closed_at desc nulls last
    limit ${opts.limit ?? 2000}
  `);
  const cents = (v: unknown) =>
    v === null || v === undefined ? null : Math.round(Number(v) * 100);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    lotId: Number(r.lot_id),
    title: String(r.title),
    hammer: cents(r.final_hammer),
    allIn: cents(r.all_in),
    unitPrice: cents(r.unit_price),
    quantity: Number(r.quantity_n ?? 1),
    closedAt: r.closed_at
      ? new Date(r.closed_at as string).toISOString()
      : null,
    location: (r.location as string | null) ?? null,
    auction: (r.campaign as string | null) ?? null,
    condition: (r.condition as string | null) ?? null,
    category: (r.final_category as string | null) ?? null,
  }));
}
