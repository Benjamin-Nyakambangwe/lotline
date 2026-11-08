import "server-only";
import { sql } from "drizzle-orm";
import {
  type AuctionPhase,
  auctionKey,
  auctionPhase,
  parseAuctionName,
} from "@/lib/domain/auctions";
import { getDb } from "./db";

export interface AuctionView {
  key: string;
  name: string;
  title: string;
  code: string | null;
  location: string | null;
  lots: number;
  open: number;
  withBids: number;
  /** first and last scheduled close among its lots (ISO) */
  firstEnd: string | null;
  lastEnd: string | null;
  /** the next lot to close, if any are still open (ISO) */
  nextEnd: string | null;
  topCategories: string[];
  phase: AuctionPhase;
}

/** Auctions with lots on sale, or that closed in the last day, soonest first. */
export async function listAuctions(now = new Date()): Promise<AuctionView[]> {
  const res = await getDb().execute(sql`
    select c.id, c.name, c.code, c.location,
      count(l.id)::int as lots,
      (count(*) filter (where l.status = 1 and l.end_at > now()))::int as open,
      (count(*) filter (where l.current_bid is not null))::int as with_bids,
      min(l.end_at) as first_end,
      max(l.end_at) as last_end,
      min(l.end_at) filter (where l.status = 1 and l.end_at > now()) as next_end,
      (select coalesce(array_agg(t.category order by t.n desc), '{}')
         from (select l2.category, count(*) as n from lots l2
               where l2.campaign_id = c.id and l2.category is not null
               group by 1 order by 2 desc limit 3) t) as top_categories
    from campaigns c
    join lots l on l.campaign_id = c.id
    group by c.id
    having max(l.end_at) > now() - interval '24 hours'
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return (res.rows as Record<string, unknown>[])
    .map((r) => {
      const name = String(r.name);
      const code = (r.code as string | null) ?? null;
      const firstEnd = iso(r.first_end);
      const lastEnd = iso(r.last_end);
      const open = Number(r.open);
      return {
        key: auctionKey({ code, name }),
        name,
        title: parseAuctionName(name).title,
        code,
        location: (r.location as string | null) ?? null,
        lots: Number(r.lots),
        open,
        withBids: Number(r.with_bids),
        firstEnd,
        lastEnd,
        nextEnd: iso(r.next_end),
        topCategories: (r.top_categories as string[] | null) ?? [],
        phase: auctionPhase(
          firstEnd ? new Date(firstEnd) : null,
          lastEnd ? new Date(lastEnd) : null,
          open,
          now,
        ),
      };
    })
    .sort(
      (a, b) =>
        PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] ||
        (a.nextEnd ?? a.lastEnd ?? "").localeCompare(
          b.nextEnd ?? b.lastEnd ?? "",
        ),
    );
}

const PHASE_ORDER: Record<AuctionPhase, number> = {
  closing: 0,
  upcoming: 1,
  closed: 2,
};
