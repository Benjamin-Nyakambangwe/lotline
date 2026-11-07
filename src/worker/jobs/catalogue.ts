import { eq, sql } from "drizzle-orm";
import type { AbcClient } from "@/lib/abc/client";
import type { LotListRow } from "@/lib/abc/normalize";
import type { Db } from "@/lib/db/client";
import {
  enrichClosedFromLots,
  upsertClosedFromList,
} from "@/lib/db/queries/closed";
import {
  tagCategory,
  trackedLotIds,
  upsertListRows,
} from "@/lib/db/queries/lots";
import { syncRuns } from "@/lib/db/schema";
import { STATUS } from "@/lib/domain/closing";
import type { Logger } from "../log";

type Kind = "catalogue" | "sold";

async function run<T>(
  db: Db,
  kind: Kind,
  fn: (rec: {
    pages: number;
    upserts: number;
    errors: number;
    notes: string[];
  }) => Promise<T>,
) {
  const [row] = await db
    .insert(syncRuns)
    .values({ kind })
    .returning({ id: syncRuns.id });
  const rec = { pages: 0, upserts: 0, errors: 0, notes: [] as string[] };
  try {
    return await fn(rec);
  } catch (e) {
    rec.errors++;
    rec.notes.push(String((e as Error).message).slice(0, 300));
    throw e;
  } finally {
    await db
      .update(syncRuns)
      .set({
        finishedAt: new Date(),
        pages: rec.pages,
        upserts: rec.upserts,
        errors: rec.errors,
        notes: rec.notes.join("; ") || null,
      })
      .where(eq(syncRuns.id, row.id));
  }
}

/**
 * Full sync of "Available" lots (~2,000 in about 5 requests of 500). Upserts list fields,
 * and records lots that passed with no bids (Status 3) for market insights.
 */
export async function syncCatalogue(db: Db, abc: AbcClient, log: Logger) {
  return run(db, "catalogue", async (rec) => {
    const started = Date.now();
    const tracked = await trackedLotIds(db);
    const passed: LotListRow[] = [];
    let invalid = 0;
    let count = 0;
    for await (const page of abc.searchAll(
      { size: 500, facets: { sale_status: ["Available"] } },
      { maxPages: 20, priority: "sync" },
    )) {
      rec.pages++;
      invalid += page.invalid;
      count = page.count;
      rec.upserts += await upsertListRows(db, page.items, tracked);
      passed.push(...page.items.filter((x) => x.status === STATUS.passed));
    }
    if (passed.length) await upsertClosedFromList(db, passed, "sweep");
    if (invalid) rec.notes.push(`${invalid} invalid items skipped`);
    log.info(
      {
        pages: rec.pages,
        upserts: rec.upserts,
        count,
        passed: passed.length,
        invalid,
        ms: Date.now() - started,
      },
      "catalogue synced",
    );
    return rec;
  });
}

/**
 * Sweep sold lots into market insights. ABC keeps ~1,500 sold lots searchable with their
 * final price, so this backfills history in a few requests and catches anything we missed.
 */
export async function sweepSold(db: Db, abc: AbcClient, log: Logger) {
  return run(db, "sold", async (rec) => {
    const started = Date.now();
    const [{ n }] = (
      await db.execute<{ n: number }>(
        sql`select count(*)::int as n from closed_prices`,
      )
    ).rows;
    const confidence = n === 0 ? "backfill" : "sweep";
    const tracked = await trackedLotIds(db);
    for await (const page of abc.searchAll(
      { size: 500, facets: { sale_status: ["Sold"] } },
      { maxPages: 20, priority: "sync" },
    )) {
      rec.pages++;
      // Keep a full lot record for every past lot too (for deep analysis), plus the market row.
      await upsertListRows(db, page.items, tracked);
      rec.upserts += await upsertClosedFromList(db, page.items, confidence);
    }
    await enrichClosedFromLots(db);
    log.info(
      {
        pages: rec.pages,
        upserts: rec.upserts,
        confidence,
        ms: Date.now() - started,
      },
      "sold lots swept",
    );
    return rec;
  });
}

/**
 * Tag every open lot with its top-level category using category-filtered searches. ABC has
 * exactly 10 top-level categories, so this is ~12 requests and makes the Browse category
 * filter complete without waiting for per-lot detail fetches.
 */
export async function tagCategories(db: Db, abc: AbcClient, log: Logger) {
  const started = Date.now();
  const meta = await abc.search(
    { size: 1, facets: { sale_status: ["Available"] } },
    "sync",
  );
  const buckets = meta.facets.find((f) => f.Name === "category")?.Buckets ?? [];
  let tagged = 0;
  let requests = 1;
  for (const b of buckets) {
    const ids: number[] = [];
    for await (const page of abc.searchAll(
      {
        size: 500,
        facets: { sale_status: ["Available"], category: [b.Value] },
      },
      { maxPages: 10, priority: "sync" },
    )) {
      requests++;
      ids.push(...page.items.map((x) => x.id));
    }
    tagged += await tagCategory(db, ids, b.Value);
  }
  log.info(
    { categories: buckets.length, tagged, requests, ms: Date.now() - started },
    "categories tagged",
  );
}
