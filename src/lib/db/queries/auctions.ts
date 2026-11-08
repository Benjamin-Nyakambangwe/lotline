import { and, inArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { AuctionMeta, LotListRow } from "../../abc/normalize";
import { parseAuctionName } from "../../domain/auctions";
import { isPlaceholderEnd } from "../../domain/closing";
import { campaigns, lots } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

/** The location(s) an auction's lots are at: "Harare", or "Harare & Bulawayo". */
export function auctionLocation(items: LotListRow[]): string | null {
  const counts = new Map<string, number>();
  for (const i of items)
    if (i.location) counts.set(i.location, (counts.get(i.location) ?? 0) + 1);
  if (!counts.size) return null;
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l)
    .join(" & ");
}

/**
 * Record an auction (ABC "campaign") and tag its lots. Returns the auction's id and how many
 * lots changed auction. The close window only ever widens, since closed lots leave the listing.
 */
export async function upsertAuction(
  db: AnyDb,
  name: string,
  items: LotListRow[],
  now = new Date(),
) {
  const { code } = parseAuctionName(name);
  const ends = items
    .map((i) => i.endAt)
    .filter((e): e is Date => !!e && !isPlaceholderEnd(e, now))
    .map((e) => e.getTime());
  const earliest = ends.length ? new Date(Math.min(...ends)) : null;
  const latest = ends.length ? new Date(Math.max(...ends)) : null;
  const [row] = await db
    .insert(campaigns)
    .values({
      name,
      code,
      location: auctionLocation(items),
      firstSeen: now,
      lastSeen: now,
      earliestEnd: earliest,
      latestEnd: latest,
    })
    .onConflictDoUpdate({
      target: campaigns.name,
      set: {
        code: sql`excluded.code`,
        location: sql`coalesce(excluded.location, ${campaigns.location})`,
        lastSeen: sql`excluded.last_seen`,
        earliestEnd: sql`least(${campaigns.earliestEnd}, excluded.earliest_end)`,
        latestEnd: sql`greatest(${campaigns.latestEnd}, excluded.latest_end)`,
      },
    })
    .returning({ id: campaigns.id });
  const ids = [...new Set(items.map((i) => i.id))];
  let tagged = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const res = await db
      .update(lots)
      .set({ campaignId: row.id })
      .where(
        and(
          inArray(lots.id, ids.slice(i, i + 500)),
          sql`${lots.campaignId} is distinct from ${row.id}`,
        ),
      )
      .returning({ id: lots.id });
    tagged += res.length;
  }
  return { id: row.id, tagged };
}

/** Auctions we know that are on sale or closed in the last day (ABC lists ended lots for a while). */
export async function runningAuctionNames(db: AnyDb): Promise<string[]> {
  const rows = await db
    .select({ name: campaigns.name })
    .from(campaigns)
    .where(sql`${campaigns.latestEnd} > now() - interval '1 day'`);
  return rows.map((r) => r.name);
}

/** Which of ABC's sites an address is at. */
const siteOf = (address: string | null) =>
  address && /bulawayo/i.test(address)
    ? "Bulawayo"
    : address && /harare/i.test(address)
      ? "Harare"
      : null;

/** Save the details from ABC's auction list (photo, type, address, dates, lot count). */
export async function saveAuctionMeta(
  db: AnyDb,
  metas: AuctionMeta[],
  now = new Date(),
) {
  for (const m of metas) {
    const { code } = parseAuctionName(m.name);
    await db
      .insert(campaigns)
      .values({
        name: m.name,
        code,
        location: siteOf(m.address),
        abcId: m.abcId,
        photoUrl: m.photoUrl,
        kind: m.kind,
        address: m.address,
        startAt: m.startAt,
        closesFrom: m.closesFrom,
        lotCount: m.lotCount,
        firstSeen: now,
        lastSeen: now,
        earliestEnd: m.closesFrom,
      })
      .onConflictDoUpdate({
        target: campaigns.name,
        set: {
          abcId: sql`excluded.abc_id`,
          photoUrl: sql`coalesce(excluded.photo_url, ${campaigns.photoUrl})`,
          kind: sql`coalesce(excluded.kind, ${campaigns.kind})`,
          address: sql`coalesce(excluded.address, ${campaigns.address})`,
          startAt: sql`coalesce(excluded.start_at, ${campaigns.startAt})`,
          closesFrom: sql`coalesce(excluded.closes_from, ${campaigns.closesFrom})`,
          lotCount: sql`coalesce(excluded.lot_count, ${campaigns.lotCount})`,
          location: sql`coalesce(${campaigns.location}, excluded.location)`,
          lastSeen: sql`excluded.last_seen`,
        },
      });
  }
}
