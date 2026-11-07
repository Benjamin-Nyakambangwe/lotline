import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type LotListRow,
  normalizeDetail,
  normalizeListItem,
} from "@/lib/abc/normalize";
import { detailSchema, listItemSchema } from "@/lib/abc/schemas";
import {
  applyClosedDetail,
  closedNeedingDetail,
  enrichClosedFromLots,
  upsertClosedFromList,
} from "@/lib/db/queries/closed";
import {
  lotsNeedingDetail,
  trackedLotIds,
  upsertDetail,
  upsertListRows,
} from "@/lib/db/queries/lots";
import * as schema from "@/lib/db/schema";
import { sanitize } from "@/worker/jobs/enrich";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });
const fx = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "abc", name),
      "utf8",
    ),
  );
const listRows = (name: string): LotListRow[] =>
  fx(name).List.map((x: unknown) => normalizeListItem(listItemSchema.parse(x)));
const lot = async (id: number) =>
  (await db.select().from(schema.lots).where(eq(schema.lots.id, id)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await pg.close();
});

describe("catalogue upserts", () => {
  const rows = listRows("search-available-page1.json");

  it("writes every lot and keeps no bidder IDs for untracked lots", async () => {
    expect(await upsertListRows(db, rows, new Set())).toBe(rows.length);
    const all = await db.select().from(schema.lots);
    expect(all).toHaveLength(rows.length);
    expect(all.every((l) => l.currentBidderId === null)).toBe(true);
    expect(all[0].titleNorm).toBe(
      all[0].title
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[^\p{L}\p{N}\s\-./+#]/gu, " ")
        .replace(/\s+/g, " "),
    );
  });

  it("keeps the leader's bidder ID only while someone tracks the lot", async () => {
    const withBids = rows.find((r) => r.currentBidderId !== null) ?? {
      ...rows[0],
      currentBidderId: 900000001,
    };
    await db
      .insert(schema.user)
      .values({ id: "u1", name: "U", email: "u@lotline.test" });
    await db
      .insert(schema.userLots)
      .values({ userId: "u1", lotId: withBids.id });
    const tracked = await trackedLotIds(db);
    expect(tracked.has(withBids.id)).toBe(true);
    await upsertListRows(db, [withBids], tracked);
    expect((await lot(withBids.id)).currentBidderId).toBe(
      withBids.currentBidderId,
    );
    await db.delete(schema.userLots);
    await upsertListRows(db, [withBids], await trackedLotIds(db));
    expect((await lot(withBids.id)).currentBidderId).toBeNull();
  });

  it("only moves end times later, counts extensions, and ignores placeholder dates", async () => {
    const r = rows[0];
    const base = (await lot(r.id)).endAt as Date;
    const later = new Date(base.getTime() + 10 * 60_000);
    await upsertListRows(db, [{ ...r, endAt: later }], new Set());
    let l = await lot(r.id);
    expect(l.endAt).toEqual(later);
    expect(l.originalEndAt).toEqual(base);
    expect(l.extensionsCount).toBe(1);

    await upsertListRows(db, [{ ...r, endAt: base }], new Set());
    expect((await lot(r.id)).endAt).toEqual(later);

    await upsertListRows(
      db,
      [{ ...r, endAt: new Date("2125-11-04T18:32:58Z") }],
      new Set(),
    );
    l = await lot(r.id);
    expect(l.endAt).toEqual(later);
    expect(l.extensionsCount).toBe(1);
  });
});

describe("market data from sold lots", () => {
  const sold = listRows("search-sold-page1.json");

  it("records final prices without bidder data, with approximate close times", async () => {
    expect(await upsertClosedFromList(db, sold, "backfill")).toBe(sold.length);
    const rows = await db.select().from(schema.closedPrices);
    expect(rows).toHaveLength(sold.length);
    expect(Object.keys(rows[0])).not.toContain("currentBidderId");
    expect(rows.every((r) => r.finalHammer !== null && r.hadBids)).toBe(true);
    expect(rows.every((r) => r.closedAt === null && r.closedAtApprox)).toBe(
      true,
    );
    expect(rows[0].confidence).toBe("backfill");
  });

  it("fills categories, quantity and the real close time from what we know about the lot", async () => {
    const s = sold[0];
    const realEnd = new Date("2026-11-06T17:36:40Z");
    await db.insert(schema.lots).values({
      id: s.id,
      title: s.title,
      titleNorm: s.title.toLowerCase(),
      endAt: realEnd,
      category: "Electronics",
      categoryPath: "Electronics > Computers",
      finalCategory: "Computers",
      quantityN: 2,
      levyRate: "0.1750",
      vatRate: "0.1550",
      lotVatRate: "0",
    });
    await enrichClosedFromLots(db);
    const [r] = await db
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, s.id));
    expect(r.closedAt).toEqual(realEnd);
    expect(r.closedAtApprox).toBe(false);
    expect(r.category).toBe("Electronics");
    expect(r.quantityN).toBe(2);
    expect(Number(r.unitPrice)).toBeCloseTo(Number(r.finalHammer) / 2, 2);
  });

  it("never downgrades an observed close to a sweep", async () => {
    const s = sold[1];
    await db
      .update(schema.closedPrices)
      .set({ confidence: "observed" })
      .where(eq(schema.closedPrices.lotId, s.id));
    await upsertClosedFromList(db, [s], "sweep");
    const [r] = await db
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, s.id));
    expect(r.confidence).toBe("observed");
  });
});

describe("lot detail", () => {
  it("stores categories, fees and a sanitised description", async () => {
    const d = normalizeDetail(detailSchema.parse(fx("detail-open.json")));
    const dirty = {
      ...d,
      descriptionHtml:
        '<p onclick="x()">Good <a href="https://evil.example">link</a><script>alert(1)</script></p>',
    };
    await upsertDetail(db, dirty, { tracked: false, sanitize });
    const l = await lot(d.id);
    expect(l.descriptionHtml).toBe("<p>Good link</p>");
    expect(l.category).toBe("Toys & Games");
    expect(Number(l.levyRate)).toBeCloseTo(0.175, 4);
    expect(l.detailFetchedAt).toBeInstanceOf(Date);
    expect(l.gallery?.length).toBeGreaterThan(0);
  });

  it("queues open lots that still lack detail, soonest first, and skips ended ones", async () => {
    const soon = new Date(Date.now() + 3600_000);
    const later = new Date(Date.now() + 86_400_000);
    await db.insert(schema.lots).values([
      {
        id: 1,
        title: "Later lot",
        titleNorm: "later lot",
        status: 1,
        endAt: later,
      },
      {
        id: 2,
        title: "Soon lot",
        titleNorm: "soon lot",
        status: 1,
        endAt: soon,
      },
      {
        id: 3,
        title: "Passed lot",
        titleNorm: "passed lot",
        status: 3,
        endAt: new Date(Date.now() - 3600_000),
      },
    ]);
    const next = await lotsNeedingDetail(db, 5, new Set());
    const ids = next.map((n) => n.id);
    expect(ids.indexOf(2)).toBeLessThan(ids.indexOf(1));
    expect(ids).not.toContain(3);
    const fetched = normalizeDetail(
      detailSchema.parse(fx("detail-open.json")),
    ).id;
    expect(ids).not.toContain(fetched);
    // Tracked lots jump the queue.
    expect((await lotsNeedingDetail(db, 1, new Set([1])))[0].id).toBe(1);
  });
});

describe("completing market rows from sold-lot detail", () => {
  it("fills categories, real fees and the real close time, then leaves the row alone", async () => {
    const d = normalizeDetail(
      detailSchema.parse(fx("detail-closed-795373.json")),
    );
    await upsertClosedFromList(
      db,
      [{ ...d, endAt: new Date("2125-11-04T18:32:58Z") }],
      "sweep",
    );
    expect(await closedNeedingDetail(db, 100)).toContain(795373);
    await applyClosedDetail(db, d);
    const [r] = await db
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, 795373));
    expect(r.category).toBe(d.category);
    expect(r.closedAt).toEqual(d.endAt);
    expect(r.closedAtApprox).toBe(false);
    expect(r.allIn).toBe("72.13");
    expect(r.detailFetchedAt).toBeInstanceOf(Date);
    expect(await closedNeedingDetail(db, 100)).not.toContain(795373);
  });

  it("falls back to the offer window when the detail's end date is a placeholder", async () => {
    const d = normalizeDetail(
      detailSchema.parse(fx("detail-closed-795373.json")),
    );
    const offer = new Date("2026-11-07T13:36:40Z");
    await upsertClosedFromList(
      db,
      [{ ...d, id: 999001, endAt: null }],
      "sweep",
    );
    await applyClosedDetail(db, {
      ...d,
      id: 999001,
      endAt: new Date("2125-01-01T00:00:00Z"),
      offerWindowEndAt: offer,
    });
    const [r] = await db
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, 999001));
    expect(r.closedAt).toEqual(new Date("2026-11-06T17:36:40Z"));
    expect(r.closedAtApprox).toBe(true);
  });
});

describe("history for every lot", () => {
  const base: LotListRow = {
    id: 777001,
    type: 1,
    title: "Dell OptiPlex 7060 Micro Desktop",
    photoUrl: null,
    thumbUrl: null,
    lotNumber: 261099001,
    location: "Harare",
    currency: "USD",
    startingBid: 3500,
    currentBid: 3000,
    currentBidderId: null,
    startAt: null,
    endAt: new Date(Date.now() + 3600_000),
    status: 1,
    saleStatus: 1,
    stc: false,
    auctionLotId: null,
  };
  const snaps = async () =>
    db
      .select()
      .from(schema.lotSnapshots)
      .where(eq(schema.lotSnapshots.lotId, base.id));

  it("records a snapshot when a lot first appears and whenever its price changes, never otherwise", async () => {
    await upsertListRows(db, [base], new Set());
    expect(await snaps()).toHaveLength(1);
    await upsertListRows(db, [base], new Set());
    expect(await snaps()).toHaveLength(1);
    await upsertListRows(
      db,
      [{ ...base, currentBid: 3500, startingBid: 4000 }],
      new Set(),
    );
    const s = await snaps();
    expect(s).toHaveLength(2);
    expect(s.map((x) => x.currentBid)).toEqual(["30.00", "35.00"]);
    expect(Object.keys(s[0])).not.toContain("currentBidderId");
  });

  it("keeps sold lots as full records with their final price and real close time", async () => {
    const end = (await lot(base.id)).endAt as Date;
    await upsertListRows(
      db,
      [
        {
          ...base,
          status: 2,
          currentBid: 5000,
          endAt: new Date("2125-11-04T18:32:58Z"),
        },
      ],
      new Set(),
    );
    const l = await lot(base.id);
    expect(l).toMatchObject({
      finalState: "final",
      finalReason: "sold",
      finalPrice: "50.00",
    });
    expect(l.closedAt).toEqual(end);
    expect(l.endAt).toEqual(end);
  });
});
