import type { PgDatabase } from "drizzle-orm/pg-core";
import {
  activeSubscriptions,
  claimPendingAlerts,
  type PendingAlert,
  subscriptionFailed,
  subscriptionWorked,
} from "../db/queries/push";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
export interface PushOptions {
  /** seconds the push service may hold it for a phone that's offline */
  TTL: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** a newer push with the same topic replaces one not yet delivered */
  topic?: string;
}
/** Sends one push; throws with a `statusCode` when the push service refuses it. */
export type SendPush = (
  target: PushTarget,
  payload: string,
  options: PushOptions,
) => Promise<unknown>;

/**
 * What the phone shows, and how urgently to deliver it. Outbid is urgent and short-lived (a
 * minute late is too late); results can wait for a phone to come back online.
 */
export function pushMessage(a: PendingAlert): {
  payload: string;
  options: PushOptions;
} {
  const urgent =
    a.kind === "outbid" || a.kind === "ending_soon" || a.kind === "extended";
  const ttl =
    a.kind === "outbid"
      ? 60
      : urgent
        ? 300
        : a.kind === "won" || a.kind === "lost"
          ? 24 * 3600
          : 3600;
  return {
    payload: JSON.stringify({
      title: a.title,
      body: a.body ?? "",
      kind: a.kind,
      tag: a.lotId ? `lot-${a.lotId}` : `alert-${a.id}`,
      url: a.lotId ? `/watchlist?lot=${a.lotId}` : "/watchlist",
      at: a.createdAt.toISOString(),
    }),
    options: {
      TTL: ttl,
      urgency: urgent ? "high" : "normal",
      ...(a.lotId ? { topic: `lot${a.lotId}` } : {}),
    },
  };
}

/** Push every waiting alert to each of its person's devices. */
export async function deliverPending(db: AnyDb, send: SendPush) {
  const alerts = await claimPendingAlerts(db);
  if (!alerts.length) return { alerts: 0, sent: 0, failed: 0 };
  const subs = await activeSubscriptions(db, [
    ...new Set(alerts.map((a) => a.userId)),
  ]);
  let sent = 0;
  let failed = 0;
  await Promise.all(
    alerts.flatMap((a) => {
      const { payload, options } = pushMessage(a);
      return subs
        .filter((s) => s.userId === a.userId)
        .map(async (s) => {
          try {
            await send(
              {
                endpoint: s.endpoint,
                keys: { p256dh: s.p256dh, auth: s.auth },
              },
              payload,
              options,
            );
            await subscriptionWorked(db, s.id);
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            await subscriptionFailed(
              db,
              s.id,
              status === 404 || status === 410,
            );
            failed++;
          }
        });
    }),
  );
  return { alerts: alerts.length, sent, failed };
}
