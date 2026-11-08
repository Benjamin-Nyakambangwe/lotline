import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { centsToNumeric } from "../../domain/money";
import {
  aiActions,
  aiConversations,
  aiMessages,
  aiUsage,
  userLots,
  userSettings,
} from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

export type StoredMessage = {
  role: "user" | "assistant" | "system";
  content: unknown;
};

export const DEFAULT_CAP_CENTS = 1000;

export async function createConversation(
  db: AnyDb,
  userId: string,
  title: string,
): Promise<string> {
  const [row] = await db
    .insert(aiConversations)
    .values({ userId, title: title.slice(0, 120) || "New chat" })
    .returning({ id: aiConversations.id });
  return row.id;
}

/** The conversation if it belongs to this person (every read is scoped by user). */
export async function getConversation(db: AnyDb, id: string, userId: string) {
  const [row] = await db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, userId)));
  return row ?? null;
}

export async function listConversations(db: AnyDb, userId: string, limit = 30) {
  return db
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(eq(aiConversations.userId, userId))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
}

export async function loadMessages(
  db: AnyDb,
  conversationId: string,
): Promise<StoredMessage[]> {
  return db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.seq));
}

/** Append messages exactly as sent or received. History is never edited. */
export async function appendMessages(
  db: AnyDb,
  conversationId: string,
  messages: StoredMessage[],
) {
  if (!messages.length) return;
  const [{ next }] = (
    await db.execute<{ next: number }>(
      sql`select coalesce(max(seq), 0) + 1 as next from ai_messages where conversation_id = ${conversationId}`,
    )
  ).rows as { next: number }[];
  await db.insert(aiMessages).values(
    messages.map((m, i) => ({
      conversationId,
      seq: Number(next) + i,
      role: m.role,
      content: m.content,
    })),
  );
  await db
    .update(aiConversations)
    .set({ updatedAt: new Date() })
    .where(eq(aiConversations.id, conversationId));
}

export async function recordUsage(
  db: AnyDb,
  row: {
    userId: string;
    conversationId: string | null;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costMicros: number;
  },
) {
  await db.insert(aiUsage).values(row);
}

/** Spend this calendar month (Harare), in micros. */
export async function monthSpendMicros(db: AnyDb, userId: string) {
  const [r] = (
    await db.execute<{ total: string | null }>(sql`
      select sum(cost_micros)::text as total from ai_usage
      where user_id = ${userId}
        and at >= (date_trunc('month', now() at time zone 'Africa/Harare') at time zone 'Africa/Harare')`)
  ).rows as { total: string | null }[];
  return Number(r?.total ?? 0);
}

export async function capCents(db: AnyDb, userId: string) {
  const [r] = await db
    .select({ cap: userSettings.aiCapCents })
    .from(userSettings)
    .where(eq(userSettings.userId, userId));
  return r?.cap ?? DEFAULT_CAP_CENTS;
}

/** This month's allowance: spent and left, in cents. */
export async function allowance(db: AnyDb, userId: string) {
  const [spent, cap] = await Promise.all([
    monthSpendMicros(db, userId),
    capCents(db, userId),
  ]);
  const spentCents = spent / 10_000;
  return {
    capCents: cap,
    spentCents,
    leftCents: Math.max(0, cap - spentCents),
  };
}

export type ActionKind = "watch" | "unwatch";

export async function proposeAction(
  db: AnyDb,
  a: {
    userId: string;
    conversationId: string;
    kind: ActionKind;
    lotId: number;
    payload: Record<string, unknown>;
  },
) {
  const [row] = await db.insert(aiActions).values(a).returning();
  return row;
}

export async function listActions(db: AnyDb, conversationId: string) {
  return db
    .select()
    .from(aiActions)
    .where(eq(aiActions.conversationId, conversationId))
    .orderBy(asc(aiActions.createdAt));
}

/**
 * Confirm or decline a proposed action. Only the person it was proposed to can decide, and only
 * once. Confirming applies it: watch upserts the lot into their list (with an optional max bid
 * and note); unwatch stops watching.
 */
export async function decideAction(
  db: AnyDb,
  id: string,
  userId: string,
  decision: "confirmed" | "declined",
) {
  const [a] = await db
    .update(aiActions)
    .set({ status: decision, decidedAt: new Date() })
    .where(
      and(
        eq(aiActions.id, id),
        eq(aiActions.userId, userId),
        eq(aiActions.status, "pending"),
      ),
    )
    .returning();
  if (!a || decision === "declined") return a ?? null;
  const p = a.payload as { maxBid?: number; note?: string };
  if (a.kind === "watch") {
    const values = {
      userId,
      lotId: a.lotId,
      watching: true,
      archivedAt: null,
      ...(p.maxBid !== undefined ? { maxBid: centsToNumeric(p.maxBid) } : {}),
      ...(p.note ? { note: p.note } : {}),
      updatedAt: new Date(),
    };
    await db
      .insert(userLots)
      .values(values)
      .onConflictDoUpdate({
        target: [userLots.userId, userLots.lotId],
        set: {
          watching: true,
          archivedAt: null,
          updatedAt: new Date(),
          ...(p.maxBid !== undefined
            ? { maxBid: centsToNumeric(p.maxBid) }
            : {}),
          ...(p.note ? { note: p.note } : {}),
        },
      });
  } else {
    await db
      .update(userLots)
      .set({ watching: false, updatedAt: new Date() })
      .where(and(eq(userLots.userId, userId), eq(userLots.lotId, a.lotId)));
  }
  return a;
}

/** What this person is watching (for the assistant's context and its watchlist tool). */
export async function watchedLots(db: AnyDb, userId: string) {
  return db
    .select({
      lotId: userLots.lotId,
      maxBid: userLots.maxBid,
      note: userLots.note,
    })
    .from(userLots)
    .where(
      and(
        eq(userLots.userId, userId),
        eq(userLots.watching, true),
        sql`${userLots.archivedAt} is null`,
      ),
    );
}
