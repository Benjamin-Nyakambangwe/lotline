import { and, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { LotDetailRow, LotListRow } from "../../abc/normalize";
import { isPlaceholderEnd } from "../../domain/closing";
import { centsToNumeric } from "../../domain/money";
import { extractAttrs, normalizeTitle } from "../../domain/titles";
import { lots, projectCandidates, userLots } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

/** Lots that some user is tracking (watching, bidding, or a project candidate). */
export async function trackedLotIds(db: AnyDb): Promise<Set<number>> {
  const a = await db
    .selectDistinct({ id: userLots.lotId })
    .from(userLots)
    .where(isNull(userLots.archivedAt));
  const b = await db
    .selectDistinct({ id: projectCandidates.lotId })
    .from(projectCandidates);
  return new Set([...a, ...b].map((r) => r.id));
}

/** Drop EndDate placeholders (~2125 on sold lots) so they never overwrite a real end time. */
const realEnd = (end: Date | null, now: Date) =>
  end && !isPlaceholderEnd(end, now) ? end : null;

function listValues(r: LotListRow, tracked: boolean, now: Date) {
  return {
    id: r.id,
    type: r.type,
    auctionLotId: r.auctionLotId,
    lotNumber: r.lotNumber,
    title: r.title,
    titleNorm: normalizeTitle(r.title),
    photoUrl: r.photoUrl,
    thumbUrl: r.thumbUrl,
    location: r.location,
    currency: r.currency,
    startingBid: centsToNumeric(r.startingBid),
    currentBid: centsToNumeric(r.currentBid),
    // Privacy: the leader's bidder ID is personal data. Keep it only while someone tracks the lot.
    currentBidderId: tracked ? r.currentBidderId : null,
    status: r.status,
    saleStatus: r.saleStatus,
    stc: r.stc,
    startAt: r.startAt,
    endAt: realEnd(r.endAt, now),
    originalEndAt: realEnd(r.endAt, now),
    listSeenAt: now,
    priceObservedAt: now,
    updatedAt: now,
  };
}

/** Shared ON CONFLICT rules for list fields. End times only ever move later (soft close). */
const listConflictSet = {
  type: sql`excluded.type`,
  auctionLotId: sql`coalesce(excluded.auction_lot_id, ${lots.auctionLotId})`,
  lotNumber: sql`coalesce(excluded.lot_number, ${lots.lotNumber})`,
  title: sql`excluded.title`,
  titleNorm: sql`excluded.title_norm`,
  photoUrl: sql`coalesce(excluded.photo_url, ${lots.photoUrl})`,
  thumbUrl: sql`coalesce(excluded.thumb_url, ${lots.thumbUrl})`,
  location: sql`coalesce(excluded.location, ${lots.location})`,
  currency: sql`excluded.currency`,
  startingBid: sql`excluded.starting_bid`,
  currentBid: sql`excluded.current_bid`,
  currentBidderId: sql`excluded.current_bidder_id`,
  status: sql`excluded.status`,
  saleStatus: sql`excluded.sale_status`,
  stc: sql`excluded.stc`,
  startAt: sql`coalesce(excluded.start_at, ${lots.startAt})`,
  endAt: sql`case when excluded.end_at is null then ${lots.endAt} else greatest(${lots.endAt}, excluded.end_at) end`,
  originalEndAt: sql`coalesce(${lots.originalEndAt}, excluded.original_end_at)`,
  extensionsCount: sql`${lots.extensionsCount} + case when ${lots.endAt} is not null and excluded.end_at > ${lots.endAt} then 1 else 0 end`,
  listSeenAt: sql`excluded.list_seen_at`,
  priceObservedAt: sql`excluded.price_observed_at`,
  updatedAt: sql`excluded.updated_at`,
};

/** Upsert search-result rows in batches. Returns the number of rows written. */
export async function upsertListRows(
  db: AnyDb,
  rows: LotListRow[],
  tracked: Set<number>,
  now = new Date(),
) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const batch = dedupe(rows.slice(i, i + 250));
    if (!batch.length) continue;
    await db
      .insert(lots)
      .values(
        batch.map((r) => ({
          ...listValues(r, tracked.has(r.id), now),
          attrs: { ...extractAttrs(r.title) },
        })),
      )
      .onConflictDoUpdate({ target: lots.id, set: listConflictSet });
    n += batch.length;
  }
  return n;
}

/** A page can repeat a lot; Postgres refuses to update the same row twice in one statement. */
function dedupe(rows: LotListRow[]) {
  const seen = new Map<number, LotListRow>();
  for (const r of rows) seen.set(r.id, r);
  return [...seen.values()];
}

/** Upsert one lot's full detail (list fields + category, condition, fees, gallery, ...). */
export async function upsertDetail(
  db: AnyDb,
  d: LotDetailRow,
  opts: {
    tracked: boolean;
    sanitize: (html: string | null) => string | null;
    now?: Date;
  },
) {
  const now = opts.now ?? new Date();
  const detail = {
    sublocation: d.sublocation,
    categoryPath: d.categoryPath,
    category: d.category,
    subCategory: d.subCategory,
    finalCategory: d.finalCategory,
    condition: d.condition,
    state: d.state,
    size: d.size,
    quantityText: d.quantityText,
    quantityN: d.quantityN,
    offerWindowEndAt: d.offerWindowEndAt,
    levyRate: d.levy === null ? null : String(d.levy),
    vatRate: d.vat === null ? null : String(d.vat),
    lotVatRate: d.lotVat === null ? null : String(d.lotVat),
    descriptionHtml: opts.sanitize(d.descriptionHtml),
    gallery: d.gallery,
    viewing: d.viewing
      ? {
          ...d.viewing,
          descriptionHtml: opts.sanitize(d.viewing.descriptionHtml),
        }
      : null,
    destinations: d.destinations,
    attrs: { ...extractAttrs(d.title, d.descriptionHtml ?? "") },
    detailFetchedAt: now,
  };
  await db
    .insert(lots)
    .values({ ...listValues(d, opts.tracked, now), ...detail })
    .onConflictDoUpdate({
      target: lots.id,
      set: {
        ...listConflictSet,
        sublocation: sql`excluded.sublocation`,
        categoryPath: sql`excluded.category_path`,
        category: sql`excluded.category`,
        subCategory: sql`excluded.sub_category`,
        finalCategory: sql`excluded.final_category`,
        condition: sql`excluded.condition`,
        state: sql`excluded.state`,
        size: sql`excluded.size`,
        quantityText: sql`excluded.quantity_text`,
        quantityN: sql`excluded.quantity_n`,
        offerWindowEndAt: sql`excluded.offer_window_end_at`,
        levyRate: sql`excluded.levy_rate`,
        vatRate: sql`excluded.vat_rate`,
        lotVatRate: sql`excluded.lot_vat_rate`,
        descriptionHtml: sql`excluded.description_html`,
        gallery: sql`excluded.gallery`,
        viewing: sql`excluded.viewing`,
        destinations: sql`excluded.destinations`,
        attrs: sql`excluded.attrs`,
        detailFetchedAt: sql`excluded.detail_fetched_at`,
      },
    });
}

/** Lots still missing their detail, tracked first, then soonest-ending open lots. */
export async function lotsNeedingDetail(
  db: AnyDb,
  limit: number,
  tracked: Set<number>,
  now = new Date(),
) {
  const rows = await db
    .select({ id: lots.id, type: lots.type, endAt: lots.endAt })
    .from(lots)
    .where(and(isNull(lots.detailFetchedAt), inArray(lots.status, [0, 1])))
    .orderBy(
      sql`${lots.endAt} > ${now} desc nulls last`,
      sql`${lots.endAt} asc nulls last`,
    )
    .limit(limit * 4);
  return rows
    .sort((a, b) => Number(tracked.has(b.id)) - Number(tracked.has(a.id)))
    .slice(0, limit)
    .map((r) => ({ id: r.id, type: r.type }));
}
