import { and, between, eq, isNotNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { LotDetailRow } from "../../abc/normalize";
import { historyCrawls, lots } from "../schema";
import { applyClosedDetail, upsertClosedFromList } from "./closed";
import { upsertDetail } from "./lots";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export type HistoryCrawl = typeof historyCrawls.$inferSelect;
export type CrawlKey = HistoryCrawl["key"];

/** Crawl order: goods first (what most people buy), then vehicles. */
export const CRAWLS: { key: CrawlKey; type: number }[] = [
  { key: "goods", type: 1 },
  { key: "vehicles", type: 2 },
];

export async function listCrawls(db: AnyDb): Promise<HistoryCrawl[]> {
  return db.select().from(historyCrawls);
}

/**
 * The crawl to work on now: the first unfinished one, created on first use. It starts at the
 * highest lot ID we know for that type (the catalogue covers everything newer). Returns null
 * when every crawl is done or there's nothing to start from.
 */
export async function currentCrawl(
  db: AnyDb,
  cutoff: Date,
): Promise<HistoryCrawl | null> {
  const existing = new Map((await listCrawls(db)).map((c) => [c.key, c]));
  for (const { key, type } of CRAWLS) {
    const c = existing.get(key);
    if (c && !c.doneAt) return c;
    if (c) continue;
    const [top] = await db
      .select({ max: sql<number | null>`max(${lots.id})` })
      .from(lots)
      .where(eq(lots.type, type));
    const startId =
      top?.max === null || top?.max === undefined ? null : Number(top.max);
    const now = new Date();
    const [row] = await db
      .insert(historyCrawls)
      .values({
        key,
        type,
        startId: startId ?? 0,
        nextId: startId ?? 0,
        cutoff,
        ...(startId === null
          ? { doneAt: now, doneReason: "no lots of this type known yet" }
          : {}),
      })
      .onConflictDoNothing()
      .returning();
    const created =
      row ??
      (
        await db.select().from(historyCrawls).where(eq(historyCrawls.key, key))
      )[0];
    if (created && !created.doneAt) return created;
  }
  return null;
}

export type CrawlPatch = Partial<
  Omit<HistoryCrawl, "key" | "type" | "startedAt">
>;

export async function saveCrawl(db: AnyDb, key: CrawlKey, patch: CrawlPatch) {
  await db
    .update(historyCrawls)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(historyCrawls.key, key));
}

/** Requests the backfill has made on a UTC day, across all crawls (survives restarts). */
export async function historyRequestsOn(db: AnyDb, day: string) {
  const [r] = await db
    .select({ n: sql<number>`coalesce(sum(${historyCrawls.dayCount}), 0)` })
    .from(historyCrawls)
    .where(eq(historyCrawls.day, day));
  return Number(r?.n ?? 0);
}

/**
 * IDs in [low, high] we already hold in full and needn't fetch again: final lots with their
 * detail, and open lots with their detail (the catalogue keeps those fresh).
 */
export async function completeIds(
  db: AnyDb,
  type: number,
  low: number,
  high: number,
): Promise<Set<number>> {
  const rows = await db
    .select({ id: lots.id })
    .from(lots)
    .where(
      and(
        between(lots.id, low, high),
        eq(lots.type, type),
        isNotNull(lots.detailFetchedAt),
        sql`(${lots.finalState} = 'final' or (${lots.status} = 1 and ${lots.endAt} > now()))`,
      ),
    );
  return new Set(rows.map((r) => r.id));
}

export type HistoricKind = "sold" | "passed" | "other";

/**
 * Store a lot read from ABC's detail endpoint during the backfill: a full lot record (for deep
 * analysis) and, when it sold with a price or passed unsold, a market row with its categories,
 * real fees and close time. Sold lots whose price ABC no longer shows are kept as lots only.
 */
export async function storeHistoricLot(
  db: AnyDb,
  d: LotDetailRow,
  opts: {
    tracked: boolean;
    sanitize: (html: string | null) => string | null;
    now?: Date;
  },
): Promise<HistoricKind> {
  const now = opts.now ?? new Date();
  await upsertDetail(db, d, { ...opts, now });
  const kind: HistoricKind =
    d.status === 2 && d.currentBid !== null
      ? "sold"
      : d.status === 3
        ? "passed"
        : "other";
  if (kind !== "other") {
    await upsertClosedFromList(db, [d], "backfill", now);
    await applyClosedDetail(db, d, now);
  }
  return kind;
}

/** Lots whose close we haven't read yet: ended a while ago, not final, not re-read since. */
export async function lotsAwaitingFinal(db: AnyDb, limit: number) {
  return db
    .select({ id: lots.id, type: lots.type })
    .from(lots)
    .where(
      and(
        sql`${lots.finalState} <> 'final'`,
        sql`${lots.status} in (0, 1)`,
        sql`${lots.endAt} < now() - interval '20 minutes'`,
        sql`${lots.endAt} > now() - interval '14 days'`,
        sql`(${lots.detailFetchedAt} is null
             or ${lots.detailFetchedAt} < ${lots.endAt} + interval '15 minutes'
             or ${lots.detailFetchedAt} < now() - interval '6 hours')`,
      ),
    )
    .orderBy(sql`${lots.endAt} desc`)
    .limit(limit);
}
