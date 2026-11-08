"use server";

import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { fetchRequests, lots, userLots, userSettings } from "@/lib/db/schema";
import { centsToNumeric } from "@/lib/domain/money";
import { requestLotFetch } from "../catalogue";
import { requireUser } from "../dal";
import { getDb } from "../db";

const LotId = z.number().int().positive();
const Cents = z.number().int().min(100).max(100_000_000).nullable();

/** Watch or stop watching a lot. Watching asks the worker for its detail straight away. */
export async function setWatch(input: { lotId: number; watching: boolean }) {
  const user = await requireUser();
  const { lotId, watching } = z
    .object({ lotId: LotId, watching: z.boolean() })
    .parse(input);
  const db = getDb();
  const [exists] = await db
    .select({ id: lots.id })
    .from(lots)
    .where(eq(lots.id, lotId));
  if (!exists) return { ok: false as const, error: "No such lot." };
  if (watching) {
    await db
      .insert(userLots)
      .values({ userId: user.id, lotId, watching: true })
      .onConflictDoUpdate({
        target: [userLots.userId, userLots.lotId],
        set: { watching: true, archivedAt: null, updatedAt: new Date() },
      });
    await requestLotFetch(lotId, user.id, "add");
  } else {
    await db
      .update(userLots)
      .set({ watching: false, updatedAt: new Date() })
      .where(and(eq(userLots.userId, user.id), eq(userLots.lotId, lotId)));
  }
  return { ok: true as const };
}

/**
 * The person's own numbers for a lot (cents): what they bid on ABC (used for status when no
 * bidder ID is linked), their planned max, and a note. Setting any of them watches the lot.
 */
export async function setLotPlan(input: {
  lotId: number;
  myBid?: number | null;
  maxBid?: number | null;
  note?: string | null;
}) {
  const user = await requireUser();
  const p = z
    .object({
      lotId: LotId,
      myBid: Cents.optional(),
      maxBid: Cents.optional(),
      note: z.string().trim().max(300).nullable().optional(),
    })
    .parse(input);
  const set = {
    ...(p.myBid !== undefined ? { myBid: centsToNumeric(p.myBid) } : {}),
    ...(p.maxBid !== undefined ? { maxBid: centsToNumeric(p.maxBid) } : {}),
    ...(p.note !== undefined ? { note: p.note || null } : {}),
  };
  await getDb()
    .insert(userLots)
    .values({ userId: user.id, lotId: p.lotId, watching: true, ...set })
    .onConflictDoUpdate({
      target: [userLots.userId, userLots.lotId],
      set: { ...set, watching: true, archivedAt: null, updatedAt: new Date() },
    });
  return { ok: true as const };
}

const mask = (id: number) => `••${String(id).slice(-2)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "That's me", step 1: after bidding on ABC, read the lot fresh and show who leads it, masked,
 * so the person can confirm it's them. Only for lots they watch.
 */
export async function previewBidderLink(input: { lotId: number }) {
  const user = await requireUser();
  const { lotId } = z.object({ lotId: LotId }).parse(input);
  const db = getDb();
  const [watched] = await db
    .select({ w: userLots.watching })
    .from(userLots)
    .where(
      and(
        eq(userLots.userId, user.id),
        eq(userLots.lotId, lotId),
        eq(userLots.watching, true),
      ),
    );
  if (!watched) return { ok: false as const, error: "Watch the lot first." };

  const asked = new Date();
  await requestLotFetch(lotId, user.id, "capture");
  for (let i = 0; i < 20; i++) {
    const [req] = await db
      .select({ done: fetchRequests.doneAt, error: fetchRequests.error })
      .from(fetchRequests)
      .where(
        and(eq(fetchRequests.lotId, lotId), isNotNull(fetchRequests.doneAt)),
      )
      .orderBy(desc(fetchRequests.doneAt))
      .limit(1);
    if (req?.done && req.done >= asked) break;
    await sleep(500);
  }
  const [l] = await db
    .select({
      leader: lots.currentBidderId,
      bid: lots.currentBid,
      at: lots.priceObservedAt,
    })
    .from(lots)
    .where(eq(lots.id, lotId));
  if (!l?.at || l.at.getTime() < asked.getTime() - 15_000)
    return {
      ok: false as const,
      error: "Couldn't get a fresh reading from ABC. Try again in a moment.",
    };
  if (!l.leader || !l.bid)
    return { ok: false as const, error: "Nobody has bid on this lot yet." };
  return {
    ok: true as const,
    masked: mask(l.leader),
    currentBid: Number(l.bid),
    observedAt: l.at.toISOString(),
  };
}

/**
 * "That's me", step 2: link the lot's current leader as this person's ABC bidder ID. Refused if
 * the leader changed since the preview, or if that bidder is already linked to someone else.
 */
export async function linkBidder(input: { lotId: number; masked: string }) {
  const user = await requireUser();
  const { lotId, masked } = z
    .object({ lotId: LotId, masked: z.string().max(10) })
    .parse(input);
  const db = getDb();
  const [l] = await db
    .select({ leader: lots.currentBidderId })
    .from(lots)
    .where(eq(lots.id, lotId));
  if (!l?.leader || mask(l.leader) !== masked)
    return {
      ok: false as const,
      error: "Someone else leads it now. Bid again, then try.",
    };
  const [taken] = await db
    .select({ userId: userSettings.userId })
    .from(userSettings)
    .where(
      and(
        eq(userSettings.abcBidderId, l.leader),
        ne(userSettings.userId, user.id),
      ),
    );
  if (taken)
    return {
      ok: false as const,
      error: "That ABC bidder is already linked to another Lotline account.",
    };
  const now = new Date();
  await db
    .insert(userSettings)
    .values({
      userId: user.id,
      abcBidderId: l.leader,
      bidderLinkedAt: now,
      bidderLinkLotId: lotId,
    })
    .onConflictDoUpdate({
      target: userSettings.userId,
      set: {
        abcBidderId: l.leader,
        bidderLinkedAt: now,
        bidderLinkLotId: lotId,
      },
    });
  // From now on "winning" and "outbid" are exact for this person.
  await db
    .update(userLots)
    .set({
      everLed: true,
      lastLedAt: now,
      firstLedAt: sql`coalesce(${userLots.firstLedAt}, ${now})`,
    })
    .where(and(eq(userLots.userId, user.id), eq(userLots.lotId, lotId)));
  return { ok: true as const, masked };
}

export async function unlinkBidder() {
  const user = await requireUser();
  await getDb()
    .update(userSettings)
    .set({ abcBidderId: null, bidderLinkedAt: null, bidderLinkLotId: null })
    .where(eq(userSettings.userId, user.id));
  return { ok: true as const };
}
