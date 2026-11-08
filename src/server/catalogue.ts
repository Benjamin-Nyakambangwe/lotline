import "server-only";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import { auctionKey, parseAuctionName } from "@/lib/domain/auctions";
import { parseCents } from "@/lib/domain/money";
import type { AuctionInfo, LotView } from "@/lib/lot-view";
import type { CatalogueDoc } from "@/lib/search/engine";
import { getDb } from "./db";

const { lots } = schema;
const num = (v: string | null) => (v === null ? null : Number(v));
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Auctions by id, as the app shows them. */
async function auctionsById(ids: number[]): Promise<Map<number, AuctionInfo>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      code: schema.campaigns.code,
      location: schema.campaigns.location,
    })
    .from(schema.campaigns)
    .where(inArray(schema.campaigns.id, ids));
  return new Map(
    rows.map((r) => [
      r.id,
      {
        key: auctionKey(r),
        title: parseAuctionName(r.name).title,
        code: r.code,
        location: r.location,
      },
    ]),
  );
}

/** Open lots (plus any that closed in the last 30 minutes) for the in-browser search index. */
export async function catalogueSnapshot() {
  const db = getDb();
  const rows = await db
    .select({
      id: lots.id,
      type: lots.type,
      lotNumber: lots.lotNumber,
      title: lots.title,
      location: lots.location,
      campaignId: lots.campaignId,
      category: lots.category,
      subCategory: lots.subCategory,
      finalCategory: lots.finalCategory,
      condition: lots.condition,
      currentBid: lots.currentBid,
      startingBid: lots.startingBid,
      endAt: lots.endAt,
      originalEndAt: lots.originalEndAt,
      stc: lots.stc,
      quantityN: lots.quantityN,
      thumbUrl: lots.thumbUrl,
      photos: sql<number>`coalesce(jsonb_array_length(${lots.gallery}), 0)::int`,
      cpu: sql<string | null>`${lots.attrs}->>'cpu'`,
      levy: lots.levyRate,
      vat: lots.vatRate,
      lotVat: lots.lotVatRate,
    })
    .from(lots)
    .where(
      and(
        eq(lots.status, 1),
        gt(lots.endAt, sql`now() - interval '30 minutes'`),
      ),
    );

  const auctions = await auctionsById([
    ...new Set(rows.flatMap((r) => (r.campaignId ? [r.campaignId] : []))),
  ]);
  const docs: CatalogueDoc[] = rows.map((r) => ({
    id: r.id,
    type: r.type,
    lotNumber: r.lotNumber,
    title: r.title,
    location: r.location,
    auction: r.campaignId ? (auctions.get(r.campaignId)?.key ?? null) : null,
    category: r.category,
    subCategory: r.subCategory,
    finalCategory: r.finalCategory,
    condition: r.condition,
    currentBid: parseCents(r.currentBid),
    startingBid: parseCents(r.startingBid),
    endAt: iso(r.endAt),
    extended: !!(r.endAt && r.originalEndAt && r.endAt > r.originalEndAt),
    stc: r.stc,
    quantity: r.quantityN,
    thumbUrl: r.thumbUrl,
    photos: Number(r.photos),
    cpu: r.cpu || null,
    rates:
      r.levy !== null && r.vat !== null
        ? [Number(r.levy), Number(r.vat), Number(r.lotVat ?? 0)]
        : null,
  }));

  const [sync] = await db
    .select({ at: schema.syncRuns.finishedAt })
    .from(schema.syncRuns)
    .where(
      and(
        eq(schema.syncRuns.kind, "catalogue"),
        sql`${schema.syncRuns.finishedAt} is not null`,
      ),
    )
    .orderBy(desc(schema.syncRuns.id))
    .limit(1);

  return {
    now: new Date().toISOString(),
    syncedAt: iso(sync?.at ?? null),
    count: docs.length,
    auctions: [...auctions.values()],
    lots: docs,
  };
}

/** A cheap version stamp for ETags: changes whenever any open lot changes. */
export async function catalogueVersion(): Promise<string> {
  const [r] = (
    await getDb().execute<{ v: string }>(
      sql`select coalesce(extract(epoch from max(updated_at))::bigint, 0)::text || '-' || count(*)::text as v
          from lots where status = 1 and end_at > now() - interval '30 minutes'`,
    )
  ).rows;
  return r?.v ?? "0-0";
}

/** One lot for the detail view. Explicit columns: bidder IDs never leave the server. */
export async function getLotView(id: number): Promise<LotView | null> {
  const [r] = await getDb()
    .select({
      id: lots.id,
      type: lots.type,
      lotNumber: lots.lotNumber,
      title: lots.title,
      photoUrl: lots.photoUrl,
      location: lots.location,
      sublocation: lots.sublocation,
      campaignId: lots.campaignId,
      categoryPath: lots.categoryPath,
      category: lots.category,
      condition: lots.condition,
      state: lots.state,
      size: lots.size,
      quantityText: lots.quantityText,
      quantityN: lots.quantityN,
      currency: lots.currency,
      currentBid: lots.currentBid,
      startingBid: lots.startingBid,
      status: lots.status,
      stc: lots.stc,
      startAt: lots.startAt,
      endAt: lots.endAt,
      originalEndAt: lots.originalEndAt,
      extensionsCount: lots.extensionsCount,
      offerWindowEndAt: lots.offerWindowEndAt,
      levy: lots.levyRate,
      vat: lots.vatRate,
      lotVat: lots.lotVatRate,
      descriptionHtml: lots.descriptionHtml,
      gallery: lots.gallery,
      viewing: lots.viewing,
      destinations: lots.destinations,
      cpu: sql<string | null>`${lots.attrs}->>'cpu'`,
      detailFetchedAt: lots.detailFetchedAt,
      priceObservedAt: lots.priceObservedAt,
      finalState: lots.finalState,
      finalPrice: lots.finalPrice,
      closedAt: lots.closedAt,
    })
    .from(lots)
    .where(eq(lots.id, id))
    .limit(1);
  if (!r) return null;
  const known = r.levy !== null && r.vat !== null;
  const { campaignId, ...rest } = r;
  const auction = campaignId
    ? ((await auctionsById([campaignId])).get(campaignId) ?? null)
    : null;
  return {
    ...rest,
    auction,
    currentBid: parseCents(r.currentBid),
    startingBid: parseCents(r.startingBid),
    finalPrice: parseCents(r.finalPrice),
    startAt: iso(r.startAt),
    endAt: iso(r.endAt),
    originalEndAt: iso(r.originalEndAt),
    offerWindowEndAt: iso(r.offerWindowEndAt),
    detailFetchedAt: iso(r.detailFetchedAt),
    priceObservedAt: iso(r.priceObservedAt),
    closedAt: iso(r.closedAt),
    rates: {
      levy: num(r.levy) ?? 0.175,
      vat: num(r.vat) ?? 0.155,
      lotVat: num(r.lotVat) ?? 0,
      estimated: !known,
    },
    gallery: r.gallery ?? [],
    destinations: r.destinations ?? [],
    cpu: r.cpu || null,
  };
}

/**
 * Ask the worker for fresh data on a lot (debounced: one pending request per lot) and wake it
 * with NOTIFY. The web app never calls ABC itself.
 */
export async function requestLotFetch(
  lotId: number,
  userId: string,
  reason: "view" | "capture" | "add",
) {
  const db = getDb();
  const [pending] = await db
    .select({ id: schema.fetchRequests.id })
    .from(schema.fetchRequests)
    .where(
      and(
        eq(schema.fetchRequests.lotId, lotId),
        isNull(schema.fetchRequests.doneAt),
      ),
    )
    .limit(1);
  if (pending) return;
  await db
    .insert(schema.fetchRequests)
    .values({ lotId, requestedBy: userId, reason });
  await db.execute(sql`select pg_notify('lotline_fetch', ${String(lotId)})`);
}
