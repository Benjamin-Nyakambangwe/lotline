import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveSubscription } from "@/lib/db/queries/push";
import * as schema from "@/lib/db/schema";
import {
  deliverPending,
  type PushOptions,
  pushMessage,
  type SendPush,
} from "@/lib/push/deliver";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });

type Sent = {
  endpoint: string;
  payload: Record<string, unknown>;
  options: PushOptions;
};
function fakeSender(fail: Record<string, number> = {}) {
  const sent: Sent[] = [];
  const send: SendPush = async (t, payload, options) => {
    if (fail[t.endpoint])
      throw Object.assign(new Error("refused"), {
        statusCode: fail[t.endpoint],
      });
    sent.push({ endpoint: t.endpoint, payload: JSON.parse(payload), options });
  };
  return { send, sent };
}
const alert = (
  userId: string,
  over: Partial<typeof schema.notifications.$inferInsert> = {},
) =>
  db.insert(schema.notifications).values({
    userId,
    kind: "outbid",
    lotId: 42,
    title: "Outbid: Dell OptiPlex 7060",
    body: "Now $45, next $50 ($60.11 all-in).",
    dedupeKey: `k${Math.random()}`,
    ...over,
  });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.user).values([
    { id: "a", name: "A", email: "a@lotline.test" },
    { id: "b", name: "B", email: "b@lotline.test" },
  ]);
  for (const [userId, endpoint] of [
    ["a", "https://push.example/phone"],
    ["a", "https://push.example/laptop"],
    ["b", "https://push.example/b-phone"],
  ])
    await saveSubscription(db, userId, {
      endpoint,
      p256dh: "p",
      auth: "x",
      label: null,
    });
});
afterAll(async () => {
  await pg.close();
});

describe("push messages", () => {
  it("makes outbid urgent and short-lived, one notification per lot", () => {
    const m = pushMessage({
      id: 1,
      userId: "a",
      kind: "outbid",
      lotId: 42,
      title: "Outbid",
      body: "b",
      createdAt: new Date("2026-11-10T17:00:00Z"),
    });
    expect(m.options).toEqual({ TTL: 60, urgency: "high", topic: "lot42" });
    expect(JSON.parse(m.payload)).toMatchObject({
      tag: "lot-42",
      url: "/watchlist?lot=42",
      kind: "outbid",
    });
    const won = pushMessage({
      id: 2,
      userId: "a",
      kind: "won",
      lotId: 42,
      title: "Won",
      body: null,
      createdAt: new Date(),
    });
    expect(won.options.TTL).toBe(86_400);
    expect(won.options.urgency).toBe("normal");
  });
});

describe("delivering alerts", () => {
  it("pushes each new alert once to each of its person's devices, and nobody else's", async () => {
    await alert("a");
    const { send, sent } = fakeSender();
    expect(await deliverPending(db, send)).toEqual({
      alerts: 1,
      sent: 2,
      failed: 0,
    });
    expect(sent.map((s) => s.endpoint).sort()).toEqual([
      "https://push.example/laptop",
      "https://push.example/phone",
    ]);
    expect(sent[0].payload.title).toBe("Outbid: Dell OptiPlex 7060");
    // Already pushed: nothing the second time.
    expect(await deliverPending(db, send)).toEqual({
      alerts: 0,
      sent: 0,
      failed: 0,
    });
  });

  it("retires alerts too old to matter without sending them", async () => {
    await alert("b", {
      createdAt: sql`now() - interval '30 minutes'` as unknown as Date,
    });
    const { send, sent } = fakeSender();
    expect((await deliverPending(db, send)).alerts).toBe(0);
    expect(sent).toEqual([]);
  });

  it("stops using a subscription the push service says is gone, and counts other failures", async () => {
    await alert("a");
    const { send } = fakeSender({
      "https://push.example/phone": 410,
      "https://push.example/laptop": 500,
    });
    expect(await deliverPending(db, send)).toEqual({
      alerts: 1,
      sent: 0,
      failed: 2,
    });
    const subs = await db
      .select()
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, "a"));
    const phone = subs.find((s) => s.endpoint.endsWith("phone"));
    const laptop = subs.find((s) => s.endpoint.endsWith("laptop"));
    expect(phone?.disabledAt).toBeInstanceOf(Date);
    expect(laptop?.disabledAt).toBeNull();
    expect(laptop?.failureCount).toBe(1);

    // A device that subscribes again is used again.
    await saveSubscription(db, "a", {
      endpoint: "https://push.example/phone",
      p256dh: "p2",
      auth: "x2",
      label: "iPhone · app",
    });
    await alert("a");
    const ok = fakeSender();
    expect((await deliverPending(db, ok.send)).sent).toBe(2);
  });
});
