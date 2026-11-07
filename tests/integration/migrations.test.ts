import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await pg.close();
});

describe("migrations", () => {
  it("apply cleanly and create every table", async () => {
    const res = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
    );
    expect(res.rows[0].n).toBeGreaterThanOrEqual(22);
  });

  it("index lot titles for full-text and fuzzy search", async () => {
    await db.insert(schema.lots).values([
      {
        id: 795373,
        title: "Dell OptiPlex 7070 Micro PC",
        titleNorm: "dell optiplex 7070 micro pc",
        lotNumber: 261008590,
        categoryPath: "Electronics > Computers",
      },
      {
        id: 792185,
        title: "Cisco Network Equipment",
        titleNorm: "cisco network equipment",
        lotNumber: 261005214,
      },
    ]);
    const fts = await db.execute<{ id: number }>(
      sql`select id from lots where search_tsv @@ websearch_to_tsquery('simple', 'optiplex 7070')`,
    );
    expect(fts.rows.map((r) => r.id)).toEqual([795373]);
    const byLotNo = await db.execute<{ id: number }>(
      sql`select id from lots where search_tsv @@ websearch_to_tsquery('simple', '261005214')`,
    );
    expect(byLotNo.rows.map((r) => r.id)).toEqual([792185]);
    const fuzzy = await db.execute<{ id: number }>(
      sql`select id from lots where title_norm % 'optiplx 7070 micro' order by similarity(title_norm, 'optiplx 7070 micro') desc`,
    );
    expect(fuzzy.rows[0]?.id).toBe(795373);
  });

  it("keeps one app user per ABC bidder ID", async () => {
    await db.insert(schema.user).values([
      { id: "u1", name: "Owner", email: "owner@example.com" },
      { id: "u2", name: "Friend", email: "friend@example.com" },
    ]);
    await db
      .insert(schema.userSettings)
      .values({ userId: "u1", abcBidderId: 900000001 });
    await expect(
      db
        .insert(schema.userSettings)
        .values({ userId: "u2", abcBidderId: 900000001 }),
    ).rejects.toThrow();
    await db.insert(schema.userSettings).values({ userId: "u2" }); // no bidder linked is fine
  });

  it("tracks one row per user per lot", async () => {
    await db
      .insert(schema.userLots)
      .values({ userId: "u1", lotId: 795373, myBid: "60.00" });
    await expect(
      db.insert(schema.userLots).values({ userId: "u1", lotId: 795373 }),
    ).rejects.toThrow();
    await db.insert(schema.userLots).values({ userId: "u2", lotId: 795373 });
  });

  it("allows only one pending invite per email, case-insensitively", async () => {
    const base = {
      role: "member" as const,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await db
      .insert(schema.invites)
      .values({ ...base, email: "New@Example.com", tokenHash: "h1" });
    await expect(
      db
        .insert(schema.invites)
        .values({ ...base, email: "new@example.com", tokenHash: "h2" }),
    ).rejects.toThrow();
  });

  it("dedupes notifications per user", async () => {
    const n = {
      userId: "u1",
      kind: "outbid" as const,
      title: "Outbid",
      dedupeKey: "outbid:795373:5500",
    };
    await db.insert(schema.notifications).values(n);
    await expect(db.insert(schema.notifications).values(n)).rejects.toThrow();
  });
});
