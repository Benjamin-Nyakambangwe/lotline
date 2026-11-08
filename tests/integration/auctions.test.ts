import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbcClient, SearchPage } from "@/lib/abc/client";
import type { LotListRow } from "@/lib/abc/normalize";
import { upsertAuction } from "@/lib/db/queries/auctions";
import { upsertListRows } from "@/lib/db/queries/lots";
import * as schema from "@/lib/db/schema";
import { discoverAuctions } from "@/worker/jobs/auctions";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await pg.close();
});

/** A fake catalogue: each lot has a location, a type and an auction. */
const LOTS = [
  // 11 Harare goods auctions: even "Harare + Goods" hits the cap, so it splits by category.
  ...Array.from({ length: 11 }, (_, i) => ({
    location: "Harare",
    lot_type: "Goods",
    category: i < 6 ? "Hardware" : "Furniture",
    campaign: `Harare Goods Auction - HGA#${300 + i}`,
  })),
  ...Array.from({ length: 2 }, () => ({
    location: "Harare",
    lot_type: "Vehicle",
    category: "Vehicles & Parts",
    campaign: "Vehicles Auction - CVA#045",
  })),
  ...Array.from({ length: 3 }, () => ({
    location: "Bulawayo",
    lot_type: "Goods",
    category: "Furniture",
    campaign: "Bulawayo Goods Auction - BGA#240",
  })),
];

function fakeAbc() {
  const queries: Record<string, string[]>[] = [];
  const abc = {
    async search({ facets }: { facets: Record<string, string[]> }) {
      queries.push(facets);
      const match = LOTS.filter((l) =>
        Object.entries(facets).every(
          ([k, v]) => k === "sale_status" || v.includes(l[k as keyof typeof l]),
        ),
      );
      const facet = (name: keyof (typeof LOTS)[0]) => {
        const counts = new Map<string, number>();
        for (const l of match)
          counts.set(l[name], (counts.get(l[name]) ?? 0) + 1);
        return {
          Name: name,
          Title: name,
          // Like ABC: biggest first, at most 10 values.
          Buckets: [...counts]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([Value, Count]) => ({ Value, Count, Checked: false })),
        };
      };
      return {
        items: [],
        invalid: 0,
        count: match.length,
        cursor: null,
        facets: [
          facet("campaign"),
          facet("location"),
          facet("lot_type"),
          facet("category"),
        ],
      } as unknown as SearchPage;
    },
  };
  return { abc: abc as unknown as AbcClient, queries };
}

describe("finding every auction", () => {
  it("splits queries when ABC's 10-auction cap hides some", async () => {
    const { abc, queries } = fakeAbc();
    const found = await discoverAuctions(abc);
    expect(found.names).toHaveLength(13);
    expect(found.names).toContain("Vehicles Auction - CVA#045");
    expect(found.names).toContain("Harare Goods Auction - HGA#310");
    expect(found.complete).toBe(true);
    // all → by location → Harare by lot type → Harare goods by category
    expect(queries.length).toBeLessThanOrEqual(8);
  });

  it("works from a narrower starting point too", async () => {
    const { abc } = fakeAbc();
    const found = await discoverAuctions(abc, {
      sale_status: ["Available"],
      location: ["Harare"],
      lot_type: ["Goods"],
      category: ["Hardware"],
    });
    expect(found.complete).toBe(true);
    expect(found.names).toHaveLength(6);
  });
});

describe("tagging lots with their auction", () => {
  const row = (id: number, over: Partial<LotListRow> = {}): LotListRow => ({
    id,
    type: 1,
    title: "Office chair",
    photoUrl: null,
    thumbUrl: null,
    lotNumber: null,
    location: "Harare",
    currency: "USD",
    startingBid: 500,
    openingBid: 500,
    currentBid: null,
    currentBidderId: null,
    startAt: null,
    endAt: new Date(Date.now() + 86_400_000 + id * 20_000),
    status: 1,
    saleStatus: 1,
    stc: false,
    auctionLotId: null,
    ...over,
  });

  it("records the auction, its code, location and close window, and tags its lots", async () => {
    const items = [row(1), row(2), row(3, { location: "Bulawayo" })];
    await upsertListRows(db, items, new Set());
    const first = await upsertAuction(
      db,
      "Harare Goods Auction - HGA#288",
      items,
    );
    expect(first.tagged).toBe(3);
    const [c] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, first.id));
    expect(c.code).toBe("HGA#288");
    expect(c.location).toBe("Harare & Bulawayo");
    expect(c.earliestEnd).toEqual(items[0].endAt);
    expect(c.latestEnd).toEqual(items[2].endAt);

    // Lot 1 has closed and left the listing: the window keeps its start, nothing re-tagged.
    const again = await upsertAuction(
      db,
      "Harare Goods Auction - HGA#288",
      items.slice(1),
    );
    expect(again).toEqual({ id: first.id, tagged: 0 });
    const [c2] = await db
      .select()
      .from(schema.campaigns)
      .where(eq(schema.campaigns.id, first.id));
    expect(c2.earliestEnd).toEqual(items[0].endAt);
    const tagged = await db
      .select({ id: schema.lots.id })
      .from(schema.lots)
      .where(eq(schema.lots.campaignId, first.id));
    expect(tagged).toHaveLength(3);
  });
});
