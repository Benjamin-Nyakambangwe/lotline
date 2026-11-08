import { and, eq, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import type { ClosingState, FinalReason } from "../../domain/closing";
import { allIn, DEFAULT_RATES } from "../../domain/fees";
import {
  allInNext,
  overMax,
  statusOfRow,
  type WatchRow,
} from "../../domain/live";
import { formatMoney, parseCents } from "../../domain/money";
import { defaultPayBy, formatPayBy } from "../../domain/payby";
import type { MyStatus } from "../../domain/status";
import { nextDue, type Tier, tierFor } from "../../domain/tiers";
import { formatClock } from "../../domain/time";
import { lotPoll, lots, notifications, userLots } from "../schema";

// biome-ignore lint/suspicious/noExplicitAny: shared by node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, any>;

const numeric = (v: unknown) =>
  v === null || v === undefined ? null : Number(v);
const date = (v: unknown) => (v ? new Date(v as string) : null);

/**
 * Keep lot_poll in step with what people track: add newly watched lots, retire lots nobody
 * watches any more, and move every tracked lot to the tier its closing time calls for.
 */
export async function refreshPollSet(db: AnyDb, now: Date) {
  await db.execute(sql`
    insert into lot_poll (lot_id, tier, next_due_at)
    select t.lot_id, 'cold', now() from (
      select lot_id from user_lots where watching and archived_at is null
      union select lot_id from project_candidates
    ) t join lots l on l.id = t.lot_id
    where l.final_state <> 'final'
    on conflict (lot_id) do nothing`);
  await db.execute(sql`
    update lot_poll set tier = 'done' where tier <> 'done' and lot_id not in (
      select lot_id from user_lots where watching and archived_at is null
      union select lot_id from project_candidates)`);
  const rows = (
    await db.execute(sql`
      select p.lot_id, p.tier, p.next_due_at, l.end_at, l.final_state
      from lot_poll p join lots l on l.id = p.lot_id where p.tier <> 'done'`)
  ).rows as Record<string, unknown>[];
  const hot = rows.filter(
    (r) =>
      tierFor(
        { endAt: date(r.end_at), final: r.final_state === "final" },
        now,
      ) === "hot",
  ).length;
  for (const r of rows) {
    const endAt = date(r.end_at);
    const tier = tierFor({ endAt, final: r.final_state === "final" }, now);
    if (tier === r.tier) continue;
    // Entering a busier tier: read it now. Calmer or cold: wait for its own schedule.
    const sooner =
      ["warm", "near", "hot"].indexOf(tier) >
      ["warm", "near", "hot"].indexOf(String(r.tier));
    await db
      .update(lotPoll)
      .set({
        tier,
        nextDueAt: sooner ? now : (nextDue(tier, { endAt }, now, hot) ?? now),
      })
      .where(eq(lotPoll.lotId, Number(r.lot_id)));
  }
  return { tracked: rows.length, hot };
}

export interface DueLot {
  lotId: number;
  type: number;
  tier: Tier;
  stableAfterEnd: number;
  consecutiveErrors: number;
}

/** Tracked lots due a reading, most overdue first. */
export async function dueLots(
  db: AnyDb,
  now: Date,
  limit: number,
): Promise<DueLot[]> {
  const rows = (
    await db.execute(sql`
      select p.lot_id, l.type, p.tier, p.stable_after_end, p.consecutive_errors
      from lot_poll p join lots l on l.id = p.lot_id
      where p.tier in ('warm', 'near', 'hot') and p.next_due_at <= ${now}
      order by p.next_due_at limit ${limit}`)
  ).rows as Record<string, unknown>[];
  return rows.map((r) => ({
    lotId: Number(r.lot_id),
    type: Number(r.type),
    tier: r.tier as Tier,
    stableAfterEnd: Number(r.stable_after_end),
    consecutiveErrors: Number(r.consecutive_errors),
  }));
}

/** The closing state we hold for a lot, to fold the next reading into. */
export async function closingStateOf(
  db: AnyDb,
  lotId: number,
  stableAfterEnd: number,
): Promise<ClosingState | null> {
  const [l] = await db
    .select({
      endAt: lots.endAt,
      originalEndAt: lots.originalEndAt,
      extensions: lots.extensionsCount,
      finalState: lots.finalState,
      finalReason: lots.finalReason,
      closedAt: lots.closedAt,
    })
    .from(lots)
    .where(eq(lots.id, lotId));
  if (!l) return null;
  const final = l.finalState === "final";
  return {
    phase: final ? "final" : "open",
    final,
    finalReason: (l.finalReason as FinalReason | null) ?? null,
    endAt: l.endAt,
    originalEndAt: l.originalEndAt,
    extensions: l.extensions,
    closedAt: l.closedAt,
    lastReadAt: null,
    stableAfterEnd,
  };
}

/**
 * Record what a reading told us about the close. ABC's own Status 2/3 is written by the detail
 * upsert; this covers finality by time (read ≥ 60 s after an unchanged end) and the 15-minute
 * safety stop, and reschedules the lot.
 */
export async function afterReading(
  db: AnyDb,
  lotId: number,
  state: ClosingState,
  now: Date,
  hotCount: number,
) {
  if (
    state.final &&
    (state.finalReason === "time" || state.finalReason === "assumed")
  ) {
    await db.execute(sql`
      update lots set
        final_state = ${state.finalReason === "time" ? "final" : "final_assumed"},
        final_reason = case when current_bid is null then 'passed' else ${state.finalReason} end,
        final_price = current_bid,
        closed_at = coalesce(closed_at, ${state.closedAt})
      where id = ${lotId} and final_state <> 'final'`);
  }
  const tier: Tier = state.final
    ? "done"
    : tierFor({ endAt: state.endAt, final: false }, now);
  await db
    .update(lotPoll)
    .set({
      tier,
      nextDueAt: nextDue(tier, { endAt: state.endAt }, now, hotCount) ?? now,
      lastFetchAt: now,
      stableAfterEnd: state.stableAfterEnd,
      consecutiveErrors: 0,
      lastError: null,
    })
    .where(eq(lotPoll.lotId, lotId));
}

export async function pollFailed(
  db: AnyDb,
  lotId: number,
  error: string,
  now: Date,
) {
  await db
    .update(lotPoll)
    .set({
      consecutiveErrors: sql`${lotPoll.consecutiveErrors} + 1`,
      lastError: error.slice(0, 200),
      nextDueAt: new Date(now.getTime() + 15_000),
    })
    .where(eq(lotPoll.lotId, lotId));
}

/** Watched lots with everything status needs, for one person or everyone. */
export async function watchRows(
  db: AnyDb,
  opts: { userId?: string; includeSettled?: boolean } = {},
): Promise<
  (WatchRow & {
    userId: string;
    lastStatus: string | null;
    outcome: string | null;
    note: string | null;
    thumbUrl: string | null;
    location: string | null;
    closedAt: Date | null;
    finalPrice: number | null;
    type: number;
  })[]
> {
  const res = await db.execute(sql`
    select ul.user_id, ul.lot_id, ul.my_bid, ul.max_bid, ul.ever_led, ul.last_status, ul.outcome, ul.note,
           us.abc_bidder_id, l.title, l.type, l.status, l.final_state, l.final_reason, l.current_bid,
           l.starting_bid, l.current_bidder_id, l.end_at, l.original_end_at, l.extensions_count,
           l.stc, l.levy_rate, l.vat_rate, l.lot_vat_rate, l.thumb_url, l.location, l.closed_at,
           l.final_price
    from user_lots ul
    join lots l on l.id = ul.lot_id
    left join user_settings us on us.user_id = ul.user_id
    where ul.watching and ul.archived_at is null
      ${opts.userId ? sql`and ul.user_id = ${opts.userId}` : sql``}
      ${opts.includeSettled ? sql`` : sql`and (ul.outcome is null or l.final_state <> 'final')`}`);
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    userId: String(r.user_id),
    lotId: Number(r.lot_id),
    type: Number(r.type),
    title: String(r.title),
    status: numeric(r.status),
    finalState: String(r.final_state),
    finalReason: (r.final_reason as string | null) ?? null,
    currentBid: parseCents(r.current_bid as string | null),
    startingBid: parseCents(r.starting_bid as string | null),
    leaderId: numeric(r.current_bidder_id),
    endAt: date(r.end_at),
    originalEndAt: date(r.original_end_at),
    extensions: Number(r.extensions_count ?? 0),
    stc: !!r.stc,
    rates:
      r.levy_rate !== null && r.vat_rate !== null
        ? {
            levy: Number(r.levy_rate),
            vat: Number(r.vat_rate),
            lotVat: Number(r.lot_vat_rate ?? 0),
            estimated: false,
          }
        : null,
    myBidderId: numeric(r.abc_bidder_id),
    myBid: parseCents(r.my_bid as string | null),
    maxBid: parseCents(r.max_bid as string | null),
    everLed: !!r.ever_led,
    lastStatus: (r.last_status as string | null) ?? null,
    outcome: (r.outcome as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    thumbUrl: (r.thumb_url as string | null) ?? null,
    location: (r.location as string | null) ?? null,
    closedAt: date(r.closed_at),
    finalPrice: parseCents(r.final_price as string | null),
  }));
}

type Note = {
  userId: string;
  lotId: number;
  kind: "outbid" | "winning" | "ending_soon" | "extended" | "won" | "lost";
  title: string;
  body: string;
  dedupeKey: string;
};

/**
 * Re-judge every watched lot and record what changed: status, whether the person ever led,
 * the final outcome, and a notification for each moment worth an alert. A lot someone starts
 * watching gets its first status silently. Dedupe keys make every alert fire once.
 */
export async function evaluateStatuses(db: AnyDb, now: Date): Promise<Note[]> {
  const rows = await watchRows(db);
  const notes: Note[] = [];
  for (const r of rows) {
    const s = statusOfRow(r, now);
    const status: MyStatus =
      s.status === "closing" && s.provisional ? s.provisional : s.status;
    const changed = r.lastStatus !== status;
    const outcome =
      s.status === "won"
        ? s.confidence === "exact"
          ? "won"
          : "won_est"
        : s.status === "lost"
          ? "lost"
          : null;
    if (changed || s.leadingNow || (outcome && !r.outcome)) {
      await db
        .update(userLots)
        .set({
          lastStatus: status,
          lastConfidence: s.confidence,
          ...(changed ? { statusChangedAt: now } : {}),
          ...(s.leadingNow
            ? {
                everLed: true,
                lastLedAt: now,
                firstLedAt: sql`coalesce(${userLots.firstLedAt}, ${now})`,
              }
            : {}),
          ...(outcome && !r.outcome ? { outcome } : {}),
          updatedAt: now,
        })
        .where(and(eq(userLots.userId, r.userId), eq(userLots.lotId, r.lotId)));
    }
    const left = r.endAt ? r.endAt.getTime() - now.getTime() : null;
    const closes = r.endAt ? formatClock(r.endAt) : "";
    const next = r.startingBid;
    const nextAllIn = allInNext(r);

    if (r.lastStatus !== null && changed) {
      if (status === "outbid")
        notes.push({
          userId: r.userId,
          lotId: r.lotId,
          kind: "outbid",
          title: `Outbid: ${r.title}`,
          body: `Now ${formatMoney(r.currentBid)}, next ${formatMoney(next)} (${formatMoney(nextAllIn)} all-in).${r.maxBid !== null ? ` Your max ${formatMoney(r.maxBid)}${overMax(r) ? ", already passed" : ""}.` : ""} Closes ${closes}.`,
          dedupeKey: `outbid:${r.lotId}:${r.currentBid ?? 0}`,
        });
      else if (status === "winning" && r.lastStatus === "outbid")
        notes.push({
          userId: r.userId,
          lotId: r.lotId,
          kind: "winning",
          title: `Winning again: ${r.title}`,
          body: `You lead at ${formatMoney(r.currentBid)}. Closes ${closes}.`,
          dedupeKey: `winning:${r.lotId}:${r.currentBid ?? 0}`,
        });
    }
    if (outcome && !r.outcome) {
      const price = r.currentBid;
      notes.push(
        outcome === "lost"
          ? {
              userId: r.userId,
              lotId: r.lotId,
              kind: "lost",
              title: `Lost: ${r.title}`,
              body:
                price !== null
                  ? `It went for ${formatMoney(price)}.`
                  : "It closed.",
              dedupeKey: `lost:${r.lotId}`,
            }
          : {
              userId: r.userId,
              lotId: r.lotId,
              kind: "won",
              title: `Won: ${r.title}`,
              body: `${formatMoney(price)} hammer, ${formatMoney(price === null ? null : allIn(price, r.rates ?? DEFAULT_RATES))} all-in. Pay by ${formatPayBy(defaultPayBy(r.endAt ?? now))}.${outcome === "won_est" ? " (Estimated from your bid: please confirm.)" : ""}${r.stc ? " Subject to confirmation." : ""}`,
              dedupeKey: `won:${r.lotId}`,
            },
      );
    }
    const open =
      statusOfRow(r, now).status !== "closing" &&
      left !== null &&
      left > 0 &&
      r.finalState !== "final";
    if (open && left <= 10 * 60_000)
      notes.push({
        userId: r.userId,
        lotId: r.lotId,
        kind: "ending_soon",
        title: `Closing soon: ${r.title}`,
        body: `Closes ${closes}. Now ${formatMoney(r.currentBid ?? null)}, next ${formatMoney(next)} (${formatMoney(nextAllIn)} all-in).`,
        dedupeKey: `ending:${r.lotId}`,
      });
    // A bid in the last 10 minutes pushes the end back: tell the people in the fight.
    if (
      open &&
      r.extensions > 0 &&
      left > 5 * 60_000 &&
      left <= 10 * 60_000 &&
      (s.status === "winning" || s.status === "outbid" || r.myBid !== null)
    )
      notes.push({
        userId: r.userId,
        lotId: r.lotId,
        kind: "extended",
        title: `Extended: ${r.title}`,
        body: `Someone bid late, so it now closes ${closes}.`,
        dedupeKey: `extended:${r.lotId}:${r.endAt?.getTime()}`,
      });
  }
  const fresh: Note[] = [];
  for (const n of notes) {
    const inserted = await db
      .insert(notifications)
      .values(n)
      .onConflictDoNothing({
        target: [notifications.userId, notifications.dedupeKey],
      })
      .returning({ id: notifications.id });
    if (inserted.length) fresh.push(n);
  }
  return fresh;
}

/** Final lots we watched closely become "observed" market rows. */
export async function observedClose(db: AnyDb, lotIds: number[]) {
  if (!lotIds.length) return;
  await db.execute(sql`
    update closed_prices set confidence = 'observed', updated_at = now()
    where lot_id in (${sql.join(
      lotIds.map((id) => sql`${id}`),
      sql`, `,
    )})`);
}
