import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "./db";

/** Lots this person won this calendar month (Harare): how many, and the all-in total (cents). */
export async function wonThisMonth(userId: string) {
  const [r] = (
    await getDb().execute(sql`
      select count(*)::int as n,
        coalesce(sum(round(l.final_price * (1 + coalesce(l.lot_vat_rate, 0))
          + l.final_price * coalesce(l.levy_rate, 0.175) * (1 + coalesce(l.vat_rate, 0.155)), 2)), 0)::text as all_in
      from user_lots ul join lots l on l.id = ul.lot_id
      where ul.user_id = ${userId} and ul.outcome in ('won', 'won_est')
        and l.final_price is not null
        and coalesce(l.closed_at, l.end_at) >=
          (date_trunc('month', now() at time zone 'Africa/Harare') at time zone 'Africa/Harare')`)
  ).rows as { n: number; all_in: string }[];
  return {
    count: Number(r?.n ?? 0),
    allInCents: Math.round(Number(r?.all_in ?? 0) * 100),
  };
}
