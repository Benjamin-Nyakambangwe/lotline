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
  /** "Harare" / "Bulawayo" */
  location: string | null;
  /** ABC's cover photo for the auction */
  photoUrl: string | null;
  /** "Goods", "Yard Special", "Vehicles", ... */
  kind: string | null;
  address: string | null;
  startAt: string | null;
  /** lots tagged in Lotline, else ABC's own count */
  lots: number;
  open: number;
  withBids: number;
  /** closed lots that sold, and their hammer total (cents) */
  sold: number;
  soldTotal: number;
  /** when lots start / finish closing (ISO) */
  firstEnd: string | null;
  lastEnd: string | null;
  /** the next lot to close, if any are still open (ISO) */
  nextEnd: string | null;
  topCategories: string[];
  /** a few lot photos, for auctions without a cover photo */
  thumbs: string[];
  phase: AuctionPhase;
}

/** Auctions on sale or closed in the last 30 days, soonest first (closed ones last). */
export async function listAuctions(now = new Date()): Promise<AuctionView[]> {
  const res = await getDb().execute(sql`
    select c.id, c.name, c.code, c.location, c.photo_url, c.kind, c.address, c.start_at,
      c.closes_from, c.latest_end, c.lot_count as abc_lots,
      count(l.id)::int as lots,
      (count(*) filter (where l.status = 1 and l.end_at > now()))::int as open,
      (count(*) filter (where l.current_bid is not null))::int as with_bids,
      (count(*) filter (where l.final_state = 'final' and l.final_price is not null))::int as sold,
      coalesce(sum(l.final_price) filter (where l.final_state = 'final'), 0)::text as sold_total,
      min(l.end_at) as first_end,
      max(l.end_at) as last_end,
      min(l.end_at) filter (where l.status = 1 and l.end_at > now()) as next_end,
      (select coalesce(array_agg(t.category order by t.n desc), '{}')
         from (select l2.category, count(*) as n from lots l2
               where l2.campaign_id = c.id and l2.category is not null
               group by 1 order by 2 desc limit 3) t) as top_categories,
      (select coalesce(array_agg(t.thumb_url), '{}')
         from (select l3.thumb_url from lots l3
               where l3.campaign_id = c.id and l3.thumb_url is not null
               order by l3.current_bid desc nulls last limit 4) t) as thumbs
    from campaigns c
    left join lots l on l.campaign_id = c.id
    group by c.id
    having coalesce(max(l.end_at), c.latest_end, c.closes_from) > now() - interval '30 days'
  `);
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return (res.rows as Record<string, unknown>[])
    .map((r) => {
      const name = String(r.name);
      const code = (r.code as string | null) ?? null;
      const firstEnd = iso(r.first_end) ?? iso(r.closes_from);
      const lastEnd = iso(r.last_end) ?? iso(r.latest_end) ?? firstEnd;
      const open = Number(r.open);
      const tagged = Number(r.lots);
      return {
        key: auctionKey({ code, name }),
        name,
        title: parseAuctionName(name).title,
        code,
        location: (r.location as string | null) ?? null,
        photoUrl: (r.photo_url as string | null) ?? null,
        kind: (r.kind as string | null) ?? null,
        address: (r.address as string | null) ?? null,
        startAt: iso(r.start_at),
        lots: tagged || Number(r.abc_lots ?? 0),
        open,
        withBids: Number(r.with_bids),
        sold: Number(r.sold),
        soldTotal: Math.round(Number(r.sold_total) * 100),
        firstEnd,
        lastEnd,
        nextEnd: iso(r.next_end),
        topCategories: (r.top_categories as string[] | null) ?? [],
        thumbs: (r.thumbs as string[] | null) ?? [],
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
        (a.phase === "closed"
          ? (b.lastEnd ?? "").localeCompare(a.lastEnd ?? "")
          : (a.nextEnd ?? a.firstEnd ?? "").localeCompare(
              b.nextEnd ?? b.firstEnd ?? "",
            )),
    );
}

const PHASE_ORDER: Record<AuctionPhase, number> = {
  closing: 0,
  upcoming: 1,
  closed: 2,
};
