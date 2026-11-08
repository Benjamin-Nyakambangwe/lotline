import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbcClient } from "@/lib/abc/client";
import { type LotDetailRow, normalizeDetail } from "@/lib/abc/normalize";
import { detailSchema } from "@/lib/abc/schemas";
import type { Db } from "@/lib/db/client";
import { upsertDetail } from "@/lib/db/queries/lots";
import { watchRows } from "@/lib/db/queries/track";
import * as schema from "@/lib/db/schema";
import { statusOfRow } from "@/lib/domain/live";
import { sanitize } from "@/worker/jobs/enrich";
import { trackStep } from "@/worker/jobs/track";
import type { Logger } from "@/worker/log";

const pg = new PGlite({ extensions: { pg_trgm } });
const pdb = drizzle(pg, { schema });
const db = pdb as unknown as Db;
const quiet = {
  info() {},
  warn() {},
  debug() {},
  error() {},
} as unknown as Logger;

const ME = 900_000_001;
const OTHER = 900_000_002;
const LOT = 5001;
const T0 = new Date(Date.now() + 3_600_000); // a "now" in the future: lots end relative to it
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

const base = normalizeDetail(
  detailSchema.parse(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "fixtures", "abc", "detail-open.json"),
        "utf8",
      ),
    ),
  ),
);
let reading: Partial<LotDetailRow> = {};
const calls: string[] = [];
const abc = {
  requestsToday: 0,
  breaker: { state: "closed" },
  async detail(id: number, _type: number, priority: string) {
    calls.push(priority);
    return {
      ...base,
      id,
      title: "Dell OptiPlex 7060 Micro",
      status: 1,
      ...reading,
    };
  },
} as unknown as AbcClient;

const notes = async (userId: string) =>
  (
    await pdb
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId))
      .orderBy(asc(schema.notifications.id))
  ).map((n) => n.kind);
const userLot = async (userId: string) =>
  (
    await pdb
      .select()
      .from(schema.userLots)
      .where(
        and(eq(schema.userLots.userId, userId), eq(schema.userLots.lotId, LOT)),
      )
  )[0];

beforeAll(async () => {
  await migrate(pdb, { migrationsFolder: "drizzle" });
  await pdb.insert(schema.user).values([
    { id: "linked", name: "Linked", email: "a@lotline.test" },
    { id: "manual", name: "Manual", email: "b@lotline.test" },
  ]);
  await pdb
    .insert(schema.userSettings)
    .values({ userId: "linked", abcBidderId: ME });
  reading = {
    currentBid: 3000,
    startingBid: 3500,
    currentBidderId: ME,
    endAt: at(240),
  };
  await upsertDetail(
    db,
    {
      ...base,
      id: LOT,
      title: "Dell OptiPlex 7060 Micro",
      status: 1,
      ...reading,
    } as LotDetailRow,
    {
      tracked: true,
      sanitize,
      now: T0,
    },
  );
  await pdb.insert(schema.userLots).values([
    { userId: "linked", lotId: LOT },
    { userId: "manual", lotId: LOT, myBid: "40.00" },
  ]);
});
afterAll(async () => {
  await pg.close();
});

describe("live tracking through a close", () => {
  it("starts reading a lot 4 minutes from closing at the hot cadence, judging statuses silently", async () => {
    await trackStep(db, abc, quiet, at(0));
    const [poll] = await pdb
      .select()
      .from(schema.lotPoll)
      .where(eq(schema.lotPoll.lotId, LOT));
    expect(poll.tier).toBe("hot");
    expect(poll.nextDueAt).toEqual(at(8));
    expect(calls).toEqual(["hot"]);
    expect((await userLot("linked")).lastStatus).toBe("winning");
    expect((await userLot("linked")).everLed).toBe(true);
    expect((await userLot("manual")).lastStatus).toBe("winning");
    // No "winning" alert for a lot just watched; "closing soon" is real news though.
    expect(await notes("linked")).toEqual(["ending_soon"]);
  });

  it("doesn't read again before it's due", async () => {
    await trackStep(db, abc, quiet, at(5));
    expect(calls).toHaveLength(1);
  });

  it("alerts both people once when someone else takes the lead", async () => {
    reading = {
      currentBid: 4500,
      startingBid: 5000,
      currentBidderId: OTHER,
      endAt: at(240),
    };
    await trackStep(db, abc, quiet, at(10));
    await trackStep(db, abc, quiet, at(20));
    expect(await notes("linked")).toEqual(["ending_soon", "outbid"]);
    expect(await notes("manual")).toEqual(["ending_soon", "outbid"]);
    expect((await userLot("linked")).lastConfidence).toBe("exact");
    expect((await userLot("manual")).lastConfidence).toBe("estimate");
    const [n] = await pdb
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, "linked"),
          eq(schema.notifications.kind, "outbid"),
        ),
      );
    expect(n.body).toContain("next $50");
    expect(n.body).toContain("$60.11 all-in");
    expect(JSON.stringify(n)).not.toContain(String(OTHER));
  });

  it("follows a soft-close extension and tells the people in the fight", async () => {
    reading = {
      currentBid: 5000,
      startingBid: 6000,
      currentBidderId: ME,
      endAt: at(230 + 600),
    };
    await trackStep(db, abc, quiet, at(230));
    const [l] = await pdb
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.id, LOT));
    expect(l.endAt).toEqual(at(830));
    expect(l.extensionsCount).toBe(1);
    expect(l.originalEndAt).toEqual(at(240));
    expect(await notes("linked")).toEqual([
      "ending_soon",
      "outbid",
      "winning",
      "extended",
    ]);
  });

  it("declares the result only after a reading a minute past an unchanged end", async () => {
    // Just after the end: closing, not final.
    await trackStep(db, abc, quiet, at(835));
    expect((await userLot("linked")).outcome).toBeNull();
    const rows = await watchRows(db, { userId: "linked" });
    expect(statusOfRow(rows[0], at(835)).status).toBe("closing");

    await trackStep(db, abc, quiet, at(900));
    const [l] = await pdb
      .select()
      .from(schema.lots)
      .where(eq(schema.lots.id, LOT));
    expect(l.finalState).toBe("final");
    expect(l.finalPrice).toBe("50.00");
    expect((await userLot("linked")).outcome).toBe("won");
    expect((await userLot("manual")).outcome).toBe("lost");
    expect(await notes("linked")).toContain("won");
    expect(await notes("manual")).toContain("lost");
    const [poll] = await pdb
      .select()
      .from(schema.lotPoll)
      .where(eq(schema.lotPoll.lotId, LOT));
    expect(poll.tier).toBe("done");
    const [market] = await pdb
      .select()
      .from(schema.closedPrices)
      .where(eq(schema.closedPrices.lotId, LOT));
    expect(market.confidence).toBe("observed");

    // Nothing more to read or announce.
    const before = calls.length;
    await trackStep(db, abc, quiet, at(1000));
    expect(calls).toHaveLength(before);
    const [won] = await pdb
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, "linked"),
          eq(schema.notifications.kind, "won"),
        ),
      );
    expect(won.body).toMatch(
      /\$50 hammer, \$60\.11 all-in\. Pay by \w{3} \d+ \w{3}\./,
    );
  });
});
