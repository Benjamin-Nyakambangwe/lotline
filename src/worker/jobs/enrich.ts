import { and, asc, eq, isNull, sql } from "drizzle-orm";
import sanitizeHtml from "sanitize-html";
import { type AbcClient, AbcError } from "@/lib/abc/client";
import type { Priority } from "@/lib/abc/limiter";
import type { Db } from "@/lib/db/client";
import {
  applyClosedDetail,
  closedNeedingDetail,
  enrichClosedFromLots,
  markClosedDetailChecked,
  upsertClosedFromList,
} from "@/lib/db/queries/closed";
import { lotsAwaitingFinal } from "@/lib/db/queries/history";
import {
  lotsNeedingDetail,
  trackedLotIds,
  upsertDetail,
} from "@/lib/db/queries/lots";
import { fetchRequests, lots } from "@/lib/db/schema";
import { STATUS } from "@/lib/domain/closing";
import type { Logger } from "../log";

/** ABC descriptions are untrusted HTML: keep simple formatting only, no attributes, no links. */
export const sanitize = (html: string | null) =>
  html === null
    ? null
    : sanitizeHtml(html, {
        allowedTags: [
          "p",
          "br",
          "b",
          "strong",
          "i",
          "em",
          "u",
          "ul",
          "ol",
          "li",
          "span",
        ],
        allowedAttributes: {},
      }).trim() || null;

/** Fetch one lot's detail and store it. */
export async function fetchAndStoreDetail(
  db: Db,
  abc: AbcClient,
  id: number,
  type: number,
  priority: Priority,
  tracked: boolean,
) {
  const d = await abc.detail(id, type, priority);
  await upsertDetail(db, d, { tracked, sanitize });
  return d;
}

/** Trickle: one detail per call for a lot we've never fetched. Returns false when there's nothing to do. */
export async function enrichOne(
  db: Db,
  abc: AbcClient,
  log: Logger,
): Promise<boolean> {
  const tracked = await trackedLotIds(db);
  const [next] = await lotsNeedingDetail(db, 1, tracked);
  if (!next)
    return (
      (await finalizeOneEnded(db, abc, log, tracked)) ||
      enrichOneClosed(db, abc, log)
    );
  try {
    await fetchAndStoreDetail(
      db,
      abc,
      next.id,
      next.type,
      "enrich",
      tracked.has(next.id),
    );
    log.debug({ lot: next.id }, "enriched");
  } catch (e) {
    // Don't retry the same broken lot forever: stamp it so the trickle moves on.
    if (e instanceof AbcError && (e.kind === "parse" || e.status === 404)) {
      await db
        .update(lots)
        .set({ detailFetchedAt: new Date() })
        .where(eq(lots.id, next.id));
    }
    throw e;
  }
  return true;
}

/**
 * Lots that ended but we never saw close: once a lot is sold it drops out of "Available", and
 * ABC's sold search doesn't list every sale, so read the result from its detail instead.
 */
async function finalizeOneEnded(
  db: Db,
  abc: AbcClient,
  log: Logger,
  tracked: Set<number>,
): Promise<boolean> {
  const [next] = await lotsAwaitingFinal(db, 1);
  if (!next) return false;
  try {
    const d = await abc.detail(next.id, next.type, "enrich");
    await upsertDetail(db, d, { tracked: tracked.has(next.id), sanitize });
    if (d.status === STATUS.sold || d.status === STATUS.passed) {
      await upsertClosedFromList(db, [d], "sweep");
      await applyClosedDetail(db, d);
    }
    log.debug({ lot: next.id, status: d.status }, "read an ended lot");
  } catch (e) {
    if (
      e instanceof AbcError &&
      (e.kind === "parse" || e.status === 404 || e.status === 400)
    )
      await db
        .update(lots)
        .set({ detailFetchedAt: new Date() })
        .where(eq(lots.id, next.id));
    throw e;
  }
  return true;
}

/**
 * When every open lot has its detail, complete sold lots for market insights (categories,
 * real fees, the real close time). One request per call, lowest priority.
 */
async function enrichOneClosed(
  db: Db,
  abc: AbcClient,
  log: Logger,
): Promise<boolean> {
  const [id] = await closedNeedingDetail(db, 1);
  if (!id) return false;
  try {
    const d = await abc.detail(id, 1, "enrich");
    await upsertDetail(db, d, { tracked: false, sanitize });
    await applyClosedDetail(db, d);
    log.debug({ lot: id }, "completed market row");
  } catch (e) {
    if (e instanceof AbcError && (e.kind === "parse" || e.status === 404))
      await markClosedDetailChecked(db, id);
    throw e;
  }
  return true;
}

/** Refresh market rows once enrichment has filled in categories and fees. */
export const refreshClosedFromLots = (db: Db) => enrichClosedFromLots(db);

/**
 * Serve the web app's fetch requests (lot views, "That's me" captures, lookups by ABC lot number).
 * Coalesced: a lot fetched in the last 10 s counts as fresh.
 */
export async function drainFetchRequests(
  db: Db,
  abc: AbcClient,
  log: Logger,
): Promise<number> {
  const pending = await db
    .select()
    .from(fetchRequests)
    .where(isNull(fetchRequests.doneAt))
    .orderBy(asc(fetchRequests.requestedAt))
    .limit(20);
  if (!pending.length) return 0;
  const tracked = await trackedLotIds(db);
  for (const req of pending) {
    let error: string | null = null;
    let lotId = req.lotId;
    try {
      if (req.reason === "lookup" && req.lotNumber) {
        const id = await abc.resolveLotNumber(req.lotNumber);
        if (!id) throw new Error("no lot with that number");
        lotId = id;
      }
      const [known] = await db
        .select({ type: lots.type, at: lots.detailFetchedAt })
        .from(lots)
        .where(eq(lots.id, lotId));
      // "That's me" needs who leads right now: always read it fresh.
      const fresh =
        req.reason !== "capture" &&
        known?.at &&
        Date.now() - known.at.getTime() < 10_000;
      if (!fresh)
        await fetchAndStoreDetail(
          db,
          abc,
          lotId,
          known?.type ?? 1,
          "ondemand",
          tracked.has(lotId),
        );
    } catch (e) {
      error = String((e as Error).message).slice(0, 200);
      log.warn(
        { lot: lotId, reason: req.reason, error },
        "on-demand fetch failed",
      );
    }
    await db
      .update(fetchRequests)
      .set({ doneAt: new Date(), error, lotId })
      .where(and(eq(fetchRequests.id, req.id), isNull(fetchRequests.doneAt)));
  }
  // Coalesce any duplicates for the same lots that arrived meanwhile.
  await db.execute(
    sql`update fetch_requests set done_at = now() where done_at is null and requested_at < now() - interval '2 minutes'`,
  );
  return pending.length;
}
