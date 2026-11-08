import { desc, eq, isNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { LotDetailRow, LotListRow } from "../../abc/normalize";
import { isPlaceholderEnd } from "../../domain/closing";
import { allIn, ratesFrom } from "../../domain/fees";
import { centsToNumeric } from "../../domain/money";
import { extractAttrs, normalizeTitle } from "../../domain/titles";
import { closedPrices } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export type ClosedConfidence = "observed" | "sweep" | "backfill";

/**
 * Record closed lots for market insights: sold lots (final price) and passed lots (no bids).
 * Shared, public market data: never stores bidder IDs. Fees are estimated with the default
 * rates here and refined from lot detail when we have it.
 */
export async function upsertClosedFromList(
  db: AnyDb,
  rows: LotListRow[],
  confidence: ClosedConfidence,
  now = new Date(),
) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 250) {
    const batch = [
      ...new Map(rows.slice(i, i + 250).map((r) => [r.id, r])).values(),
    ];
    if (!batch.length) continue;
    await db
      .insert(closedPrices)
      .values(
        batch.map((r) => {
          const end =
            r.endAt && !isPlaceholderEnd(r.endAt, now) ? r.endAt : null;
          const hammer = r.currentBid;
          return {
            lotId: r.id,
            title: r.title,
            titleNorm: normalizeTitle(r.title),
            attrs: { ...extractAttrs(r.title) },
            location: r.location,
            finalHammer: centsToNumeric(hammer),
            unitPrice: centsToNumeric(hammer),
            allIn: hammer === null ? null : centsToNumeric(allIn(hammer)),
            openingBid: centsToNumeric(r.openingBid),
            hadBids: hammer !== null,
            stc: r.stc,
            closedAt: end,
            closedAtApprox: end === null,
            confidence,
            updatedAt: now,
          };
        }),
      )
      .onConflictDoUpdate({
        target: closedPrices.lotId,
        set: {
          title: sql`excluded.title`,
          titleNorm: sql`excluded.title_norm`,
          finalHammer: sql`coalesce(excluded.final_hammer, ${closedPrices.finalHammer})`,
          allIn: sql`coalesce(excluded.all_in, ${closedPrices.allIn})`,
          unitPrice: sql`coalesce(excluded.unit_price, ${closedPrices.unitPrice})`,
          hadBids: sql`${closedPrices.hadBids} or excluded.had_bids`,
          stc: sql`excluded.stc`,
          closedAt: sql`coalesce(${closedPrices.closedAt}, excluded.closed_at)`,
          closedAtApprox: sql`case when ${closedPrices.closedAt} is not null then ${closedPrices.closedAtApprox} else excluded.closed_at_approx end`,
          confidence: sql`case when ${closedPrices.confidence} = 'observed' then ${closedPrices.confidence} else excluded.confidence end`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    n += batch.length;
  }
  return n;
}

/**
 * Fill market rows from what we know about the lot: categories, condition, quantity (for unit
 * price), real fee rates, and the last real close time when the sold listing only had a placeholder.
 */
export async function enrichClosedFromLots(db: AnyDb) {
  await db.execute(sql`
    update closed_prices cp set
      category_path  = coalesce(cp.category_path, l.category_path),
      category       = coalesce(cp.category, l.category),
      sub_category   = coalesce(cp.sub_category, l.sub_category),
      final_category = coalesce(cp.final_category, l.final_category),
      condition      = coalesce(cp.condition, l.condition),
      state          = coalesce(cp.state, l.state),
      quantity_n     = greatest(l.quantity_n, 1),
      unit_price     = round(cp.final_hammer / greatest(l.quantity_n, 1), 2),
      all_in = case when cp.final_hammer is null or l.levy_rate is null then cp.all_in
                    else round(cp.final_hammer * (1 + coalesce(l.lot_vat_rate, 0)) + cp.final_hammer * l.levy_rate * (1 + l.vat_rate), 2) end,
      closed_at        = coalesce(cp.closed_at, l.end_at),
      closed_at_approx = case when cp.closed_at is null and l.end_at is not null then false else cp.closed_at_approx end,
      extensions       = coalesce(cp.extensions, l.extensions_count),
      opening_bid      = coalesce(cp.opening_bid, l.opening_bid),
      campaign         = coalesce(cp.campaign, (select c.name from campaigns c where c.id = l.campaign_id)),
      updated_at = now()
    from lots l
    where l.id = cp.lot_id
      and (cp.category is null or cp.closed_at is null or (cp.campaign is null and l.campaign_id is not null) or cp.quantity_n <> greatest(l.quantity_n, 1)
           or (l.levy_rate is not null and cp.final_hammer is not null))
  `);
}

/** Market rows whose lot detail we haven't read yet (newest lot ids first, a proxy for recency). */
export async function closedNeedingDetail(
  db: AnyDb,
  limit: number,
): Promise<number[]> {
  const rows = await db
    .select({ id: closedPrices.lotId })
    .from(closedPrices)
    .where(isNull(closedPrices.detailFetchedAt))
    .orderBy(desc(closedPrices.lotId))
    .limit(limit);
  return rows.map((r) => r.id);
}

/** ABC's offer window ends 20 hours after the close. */
const OFFER_WINDOW_MS = 20 * 3600_000;

/**
 * Complete a market row from the lot's detail: categories, condition, quantity (unit price),
 * real fee rates, and the real close time. If the detail's EndDate is already a placeholder,
 * fall back to OfferWindowEndDate − 20 h (flagged approximate).
 */
export async function applyClosedDetail(
  db: AnyDb,
  d: LotDetailRow,
  now = new Date(),
) {
  const end = d.endAt && !isPlaceholderEnd(d.endAt, now) ? d.endAt : null;
  const offer =
    d.offerWindowEndAt && !isPlaceholderEnd(d.offerWindowEndAt, now)
      ? d.offerWindowEndAt
      : null;
  const close =
    end ?? (offer ? new Date(offer.getTime() - OFFER_WINDOW_MS) : null);
  const hammer = d.currentBid;
  const qty = Math.max(1, d.quantityN);
  const rates = ratesFrom({ levy: d.levy, vat: d.vat, lotVat: d.lotVat });
  await db
    .update(closedPrices)
    .set({
      categoryPath: d.categoryPath,
      category: d.category,
      subCategory: d.subCategory,
      finalCategory: d.finalCategory,
      condition: d.condition,
      state: d.state,
      quantityN: qty,
      attrs: { ...extractAttrs(d.title, d.descriptionHtml ?? "") },
      ...(hammer === null
        ? {}
        : {
            finalHammer: centsToNumeric(hammer),
            unitPrice: centsToNumeric(Math.round(hammer / qty)),
            allIn: centsToNumeric(allIn(hammer, rates)),
            hadBids: true,
          }),
      closedAt: sql`case when ${closedPrices.closedAt} is not null and not ${closedPrices.closedAtApprox} then ${closedPrices.closedAt} else coalesce(${close}::timestamptz, ${closedPrices.closedAt}) end`,
      closedAtApprox: sql`case when ${closedPrices.closedAt} is not null and not ${closedPrices.closedAtApprox} then false else ${close === null ? sql`${closedPrices.closedAtApprox}` : end === null} end`,
      detailFetchedAt: now,
      updatedAt: now,
    })
    .where(eq(closedPrices.lotId, d.id));
}

/** Stop retrying a market row whose detail can't be read. */
export async function markClosedDetailChecked(
  db: AnyDb,
  lotId: number,
  now = new Date(),
) {
  await db
    .update(closedPrices)
    .set({ detailFetchedAt: now })
    .where(eq(closedPrices.lotId, lotId));
}
