import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { watchRows } from "@/lib/db/queries/track";
import { notifications, userSettings } from "@/lib/db/schema";
import { allInNext, overMax, phaseOfRow, statusOfRow } from "@/lib/domain/live";
import type { LiveLot, LiveResponse } from "@/lib/live-view";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const RECENT_MS = 3 * 86_400_000;

/**
 * Everything the board needs, computed on the server: each watched lot with this person's
 * status, and alerts newer than `after`. The only thing the client polls. Bidder IDs never
 * leave the server: status is computed here.
 */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const after =
    Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  const db = getDb();
  const now = new Date();

  const [rows, [settings], alerts, [{ unread }]] = await Promise.all([
    watchRows(db, { userId, includeSettled: true }),
    db
      .select({ bidder: userSettings.abcBidderId })
      .from(userSettings)
      .where(eq(userSettings.userId, userId)),
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), gt(notifications.id, after)))
      .orderBy(desc(notifications.id))
      .limit(20),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      ),
  ]);

  const lots: LiveLot[] = rows
    .filter((r) => {
      const ended = r.closedAt ?? (r.finalState === "final" ? r.endAt : null);
      return !ended || now.getTime() - ended.getTime() < RECENT_MS;
    })
    .map((r) => {
      const s = statusOfRow(r, now);
      return {
        id: r.lotId,
        type: r.type,
        title: r.title,
        thumbUrl: r.thumbUrl,
        location: r.location,
        phase: phaseOfRow(r, now),
        status: s.status,
        confidence: s.confidence,
        provisional: s.provisional,
        needsConfirmation: s.needsConfirmation,
        stc: s.stc,
        currentBid: r.currentBid,
        nextBid: r.startingBid,
        allInNext: allInNext(r),
        myBid: r.myBid,
        maxBid: r.maxBid,
        overMax: overMax(r),
        note: r.note,
        endAt: iso(r.endAt),
        originalEndAt: iso(r.originalEndAt),
        extended: !!(r.endAt && r.originalEndAt && r.endAt > r.originalEndAt),
        closedAt: iso(r.closedAt),
        finalPrice: r.finalPrice,
      };
    })
    .sort((a, b) => (a.endAt ?? "9").localeCompare(b.endAt ?? "9"));

  const body: LiveResponse = {
    now: now.toISOString(),
    bidder: {
      linked: settings?.bidder != null,
      masked:
        settings?.bidder != null
          ? `••${String(settings.bidder).slice(-2)}`
          : null,
    },
    lots,
    alerts: alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      lotId: a.lotId,
      title: a.title,
      body: a.body,
      createdAt: a.createdAt.toISOString(),
      read: a.readAt !== null,
    })),
    unread,
  };
  return Response.json(body, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

/** Mark every alert read (opening the board). */
export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  await getDb()
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
      ),
    );
  return Response.json({ ok: true });
}
