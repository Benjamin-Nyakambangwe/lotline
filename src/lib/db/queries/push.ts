import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSubscriptions } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export interface PendingAlert {
  id: number;
  userId: string;
  kind: string;
  lotId: number | null;
  title: string;
  body: string | null;
  createdAt: Date;
}

/** Alerts older than this aren't worth a buzz any more (the worker was down, say). */
export const PUSH_MAX_AGE_MIN = 10;

/**
 * Take the alerts waiting to be pushed and mark them taken in the same statement, so each is
 * pushed once even if two workers overlap during a deploy. Stale ones are retired unsent.
 */
export async function claimPendingAlerts(
  db: AnyDb,
  limit = 50,
): Promise<PendingAlert[]> {
  await db.execute(sql`
    update notifications set pushed_at = now()
    where pushed_at is null and created_at <= now() - make_interval(mins => ${PUSH_MAX_AGE_MIN})`);
  const res = await db.execute(sql`
    update notifications set pushed_at = now()
    where id in (
      select id from notifications
      where pushed_at is null
      order by id
      limit ${limit}
      for update skip locked)
    returning id, user_id, kind, lot_id, title, body, created_at`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    id: Number(r.id),
    userId: String(r.user_id),
    kind: String(r.kind),
    lotId: r.lot_id === null ? null : Number(r.lot_id),
    title: String(r.title),
    body: (r.body as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
  }));
}

export async function activeSubscriptions(db: AnyDb, userIds: string[]) {
  if (!userIds.length) return [];
  return db
    .select()
    .from(pushSubscriptions)
    .where(
      and(
        inArray(pushSubscriptions.userId, userIds),
        isNull(pushSubscriptions.disabledAt),
      ),
    );
}

export async function subscriptionWorked(db: AnyDb, id: string) {
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date(), failureCount: 0 })
    .where(eq(pushSubscriptions.id, id));
}

/** The push service says the subscription is gone (404/410), or it keeps failing: stop using it. */
export async function subscriptionFailed(db: AnyDb, id: string, gone: boolean) {
  await db
    .update(pushSubscriptions)
    .set({
      failureCount: sql`${pushSubscriptions.failureCount} + 1`,
      disabledAt: gone
        ? new Date()
        : sql`case when ${pushSubscriptions.failureCount} + 1 >= 5 then now() else null end`,
    })
    .where(eq(pushSubscriptions.id, id));
}

/** Save this device's subscription for this person (a device re-subscribing takes it over). */
export async function saveSubscription(
  db: AnyDb,
  userId: string,
  s: { endpoint: string; p256dh: string; auth: string; label: string | null },
) {
  await db
    .insert(pushSubscriptions)
    .values({ userId, ...s })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId,
        p256dh: s.p256dh,
        auth: s.auth,
        label: s.label,
        disabledAt: null,
        failureCount: 0,
      },
    });
}

export async function removeSubscription(
  db: AnyDb,
  userId: string,
  endpoint: string,
) {
  await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    );
}

export async function subscriptionCount(db: AnyDb, userId: string) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        isNull(pushSubscriptions.disabledAt),
      ),
    );
  return r?.n ?? 0;
}
