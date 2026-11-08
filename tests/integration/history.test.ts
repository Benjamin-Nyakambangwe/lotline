import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type AbcClient, AbcError } from "@/lib/abc/client";
import {
  type LotDetailRow,
  type LotListRow,
  normalizeDetail,
} from "@/lib/abc/normalize";
import { detailSchema } from "@/lib/abc/schemas";
import type { Db } from "@/lib/db/client";
import {
  completeIds,
  lotsAwaitingFinal,
  storeHistoricLot,
} from "@/lib/db/queries/history";
import { upsertDetail, upsertListRows } from "@/lib/db/queries/lots";
import * as schema from "@/lib/db/schema";
import { sanitize } from "@/worker/jobs/enrich";
import {
  type HistoryConfig,
  historyStep,
  initialHistoryState,
} from "@/worker/jobs/history";
import type { Logger } from "@/worker/log";

const pg = new PGlite({ extensions: { pg_trgm } });
const pdb = drizzle(pg, { schema });
const db = pdb as unknown as Db;

const sold = normalizeDetail(
  detailSchema.parse(
    JSON.parse(
      readFileSync(
        join(
          import.meta.dirname,
          "..",
          "fixtures",
          "abc",
          "detail-closed-795373.json",
        ),
        "utf8",
      ),
    ),
  ),
);
const at = (iso: string) => new Date(iso);
const lotOf = (id: number, over: Partial<LotDetailRow> = {}): LotDetailRow => ({
  ...sold,
  id,
  lotNumber: 260000000 + id,
  ...over,
});
const recentSale = (id: number) =>
  lotOf(id, {
    startAt: at("2026-09-27T10:30:00Z"),
    endAt: at("2026-10-01T17:00:00Z"),
    offerWindowEndAt: at("2026-10-02T13:00:00Z"),
  });

const listRow = (id: number, over: Partial<LotListRow> = {}): LotListRow => ({
  id,
  type: 1,
  title: "Dell OptiPlex 7060 Micro Desktop",
  photoUrl: null,
  thumbUrl: null,
  lotNumber: 261000000 + id,
  location: "Harare",
  currency: "USD",
  startingBid: 3500,
  openingBid: 1000,
  currentBid: 3000,
  currentBidderId: null,
  startAt: null,
  endAt: new Date(Date.now() + 3600_000),
  status: 1,
  saleStatus: 1,
  stc: false,
  auctionLotId: null,
  ...over,
});

const quiet = {
  info() {},
  warn() {},
  debug() {},
  error() {},
} as unknown as Logger;

const cfg: HistoryConfig = {
  HISTORY_MONTHS: 12,
  HISTORY_NIGHT_MS: 1000,
  HISTORY_DAY_MS: 3000,
  HISTORY_PAUSE_FROM_HOUR: 16,
  HISTORY_PAUSE_TO_HOUR: 22,
  HISTORY_DAILY_MAX: 22_000,
  HISTORY_RESERVE: 15_000,
  ABC_DAILY_CAP: 40_000,
  DISPLAY_TZ: "Africa/Harare",
};
/** 10:00 in Harare: outside the pause, daytime pace. */
const MORNING = at("2026-11-08T08:00:00Z");

function fakeAbc(reply: (id: number, type: number) => LotDetailRow | Error) {
  const calls: number[] = [];
  const priorities = new Set<string>();
  const abc = {
    requestsToday: 0,
    breaker: { state: "closed" },
    async detail(id: number, type: number, priority: string) {
      calls.push(id);
      priorities.add(priority);
      const r = reply(id, type);
      if (r instanceof Error) throw r;
      return r;
    },
  };
  return { abc: abc as unknown as AbcClient, raw: abc, calls, priorities };
}

const crawlRow = async (key: "goods" | "vehicles") =>
  (
    await pdb
      .select()
      .from(schema.historyCrawls)
      .where(eq(schema.historyCrawls.key, key))
  )[0];
const market = async (id: number) =>
  (
    await pdb
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, id))
  )[0];
const lot = async (id: number) =>
  (await pdb.select().from(schema.lots).where(eq(schema.lots.id, id)))[0];

beforeAll(async () => {
  await migrate(pdb, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await pg.exec(
    "truncate lots, closed_prices, history_crawls, lot_snapshots restart identity cascade",
  );
});
afterAll(async () => {
  await pg.close();
});

describe("storing historic lots", () => {
  it("keeps a sold lot in full and adds a market row with categories, real fees and close", async () => {
    const d = recentSale(700001);
    expect(await storeHistoricLot(db, d, { tracked: false, sanitize })).toBe(
      "sold",
    );
    const l = await lot(700001);
    expect(l.finalState).toBe("final");
    expect(l.finalPrice).toBe("60.00");
    expect(l.detailFetchedAt).toBeInstanceOf(Date);
    expect(l.currentBidderId).toBeNull();
    const m = await market(700001);
    expect(m.confidence).toBe("backfill");
    expect(m.category).toBe(d.category);
    expect(m.closedAt).toEqual(d.endAt);
    expect(m.closedAtApprox).toBe(false);
    expect(m.allIn).toBe("72.13");
  });

  it("records passed lots as unsold, and keeps priceless or never-auctioned lots out of market data", async () => {
    expect(
      await storeHistoricLot(
        db,
        lotOf(700002, { status: 3, currentBid: null }),
        { tracked: false, sanitize },
      ),
    ).toBe("passed");
    expect((await market(700002)).hadBids).toBe(false);

    expect(
      await storeHistoricLot(
        db,
        lotOf(700003, { status: 2, currentBid: null, endAt: null }),
        { tracked: false, sanitize },
      ),
    ).toBe("other");
    expect(
      await storeHistoricLot(
        db,
        lotOf(700004, {
          status: 0,
          currentBid: null,
          endAt: null,
          startAt: null,
        }),
        { tracked: false, sanitize },
      ),
    ).toBe("other");
    expect(await market(700003)).toBeUndefined();
    expect(await market(700004)).toBeUndefined();
    expect((await lot(700004)).status).toBe(0);
  });

  it("knows which IDs it already holds in full", async () => {
    await upsertDetail(db, recentSale(10), { tracked: false, sanitize });
    await upsertDetail(
      db,
      lotOf(11, { status: 1, endAt: new Date(Date.now() + 7 * 86_400_000) }),
      { tracked: false, sanitize },
    );
    // Sold but without detail yet (from the sold sweep): still worth a fetch.
    await upsertListRows(db, [listRow(12, { status: 2 })], new Set());
    expect([...(await completeIds(db, 1, 1, 100))].sort()).toEqual([10, 11]);
    expect((await completeIds(db, 2, 1, 100)).size).toBe(0);
  });
});

describe("lots that ended without us seeing the result", () => {
  it("queues them 20 minutes after the end, and not again once read after the close", async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000);
    await upsertListRows(
      db,
      [
        listRow(21, { endAt: ago(60) }),
        listRow(22, { endAt: ago(5) }),
        listRow(23, { endAt: ago(90), status: 2 }),
        listRow(24, { endAt: ago(120) }),
      ],
      new Set(),
    );
    await pdb
      .update(schema.lots)
      .set({ detailFetchedAt: ago(30) })
      .where(eq(schema.lots.id, 24));
    expect((await lotsAwaitingFinal(db, 10)).map((r) => r.id)).toEqual([21]);
  });
});

describe("the backfill loop", () => {
  it("walks IDs downward, skips what it holds, stores everything, resumes after a restart, and finishes", async () => {
    // Already held in full: 12 (open, with detail) and 9 (sold, with detail).
    await upsertDetail(
      db,
      lotOf(12, { status: 1, endAt: new Date(Date.now() + 7 * 86_400_000) }),
      { tracked: false, sanitize },
    );
    await upsertDetail(db, recentSale(9), { tracked: false, sanitize });

    const { abc, calls, priorities } = fakeAbc((id) => {
      if (id === 10) return new AbcError("HTTP 400", "http", 400);
      if (id === 8)
        return lotOf(8, {
          startAt: at("2024-01-01T10:00:00Z"),
          endAt: at("2024-01-05T17:00:00Z"),
        });
      if (id === 7) return lotOf(7, { status: 3, currentBid: null });
      if (id === 6)
        return lotOf(6, {
          status: 0,
          currentBid: null,
          endAt: null,
          startAt: null,
          offerWindowEndAt: null,
        });
      return recentSale(id);
    });

    let state = initialHistoryState();
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(3000);
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(3000);
    expect((await crawlRow("goods")).nextId).toBe(9);

    // Restart: fresh in-memory state, same database.
    state = initialHistoryState();
    for (let i = 0; i < 8; i++)
      await historyStep(db, abc, quiet, cfg, state, MORNING);

    expect(calls).toEqual([11, 10, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect([...priorities]).toEqual(["history"]);
    const c = await crawlRow("goods");
    expect(c).toMatchObject({
      startId: 12,
      nextId: 0,
      fetched: 10,
      sold: 7,
      passed: 1,
      other: 1,
      missing: 1,
      skipped: 2,
      doneReason: "reached the first lot ID",
    });
    expect(c.doneAt).toBeInstanceOf(Date);
    expect(c.dayCount).toBe(10);
    expect(c.day).toBe("2026-11-08");
    expect((await market(8)).closedAt).toEqual(at("2024-01-05T17:00:00Z"));
    expect((await market(5)).confidence).toBe("backfill");

    // With no vehicles known, there's nothing more to do.
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(
      6 * 60 * 60_000,
    );
    expect(state.status).toBe("done");
    expect((await crawlRow("vehicles")).doneReason).toBe(
      "no lots of this type known yet",
    );
    expect(calls).toHaveLength(10);
  });

  it("retries a failing lot a few times, then moves on", async () => {
    await upsertListRows(db, [listRow(3, { status: 2 })], new Set());
    const { abc, calls } = fakeAbc((id) =>
      id === 3 ? new AbcError("timeout", "timeout") : recentSale(id),
    );
    const state = initialHistoryState();
    await expect(
      historyStep(db, abc, quiet, cfg, state, MORNING),
    ).rejects.toMatchObject({ kind: "timeout" });
    await expect(
      historyStep(db, abc, quiet, cfg, state, MORNING),
    ).rejects.toMatchObject({ kind: "timeout" });
    expect((await crawlRow("goods")).nextId).toBe(3);
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(3000);
    expect(calls).toEqual([3, 3, 3]);
    expect(await crawlRow("goods")).toMatchObject({
      nextId: 2,
      errors: 1,
      dayCount: 3,
    });
  });

  it("pauses in closing hours, and respects the daily budget and the live reserve", async () => {
    await upsertListRows(db, [listRow(5, { status: 2 })], new Set());
    const { abc, raw, calls } = fakeAbc((id) => recentSale(id));
    const state = initialHistoryState();

    // 17:00 in Harare.
    expect(
      await historyStep(db, abc, quiet, cfg, state, at("2026-11-08T15:00:00Z")),
    ).toBe(5 * 60_000);
    expect(state.status).toMatch(/closing hours/);
    // 00:30 in Harare: the faster night pace.
    expect(
      await historyStep(db, abc, quiet, cfg, state, at("2026-11-08T22:30:00Z")),
    ).toBe(1000);

    raw.requestsToday = 30_000; // 30k + 15k reserve ≥ the 40k cap
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(
      15 * 60_000,
    );
    raw.requestsToday = 0;
    await pdb
      .update(schema.historyCrawls)
      .set({ day: "2026-11-08", dayCount: cfg.HISTORY_DAILY_MAX });
    expect(await historyStep(db, abc, quiet, cfg, state, MORNING)).toBe(
      15 * 60_000,
    );
    expect(state.status).toMatch(/daily budget/);
    expect(calls).toEqual([5]);
  });
});
