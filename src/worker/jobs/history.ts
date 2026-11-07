/**
 * Historical backfill. ABC's search lists only recent sold lots (and not all of those), but
 * lot detail still serves old lots by ID, and nearly every ID is a lot. So we walk IDs
 * downward from the newest one we know, one gentle request at a time, storing every lot in
 * full plus a market row for each sale, until lots are consistently older than the cutoff.
 *
 * Politeness: lowest limiter priority, 1 request/s overnight and one every 3 s by day, paused
 * 16:00 to 22:00 Harare (when lots close), a persisted daily budget, and a reserve of the daily
 * cap kept for live use. All progress is in history_crawls, so a restart resumes where it left off.
 */
import { type AbcClient, AbcError } from "@/lib/abc/client";
import type { LotDetailRow } from "@/lib/abc/normalize";
import type { Db } from "@/lib/db/client";
import {
  type CrawlPatch,
  completeIds,
  currentCrawl,
  type HistoryCrawl,
  historyRequestsOn,
  saveCrawl,
  storeHistoricLot,
} from "@/lib/db/queries/history";
import { trackedLotIds } from "@/lib/db/queries/lots";
import { isPlaceholderEnd } from "@/lib/domain/closing";
import type { WorkerConfig } from "../config";
import type { Logger } from "../log";
import { sanitize } from "./enrich";

export type HistoryConfig = Pick<
  WorkerConfig,
  | "HISTORY_MONTHS"
  | "HISTORY_NIGHT_MS"
  | "HISTORY_DAY_MS"
  | "HISTORY_PAUSE_FROM_HOUR"
  | "HISTORY_PAUSE_TO_HOUR"
  | "HISTORY_DAILY_MAX"
  | "HISTORY_RESERVE"
  | "ABC_DAILY_CAP"
  | "DISPLAY_TZ"
>;

const MIN = 60_000;
/** The moving share of recent lots covers roughly the last 400 dated lots. */
const EMA_ALPHA = 1 / 400;
/** Done once fewer than 5% of recent dated lots are newer than the cutoff (≈1,200 old in a row). */
const STOP_RECENT_SHARE = 0.05;
const MIN_DATED_BEFORE_STOP = 500;
/** ABC answers 400 for IDs that don't exist; a long run of those is the bottom of the range. */
const MISSING_STREAK_STOP = 1000;
/** IDs we already hold are skipped in windows of this size, without a request. */
const SKIP_WINDOW = 500;
/** A lot that keeps failing (timeouts, 5xx) is skipped after this many tries. */
const MAX_TRIES = 3;

export function hourIn(now: Date, tz: string) {
  return (
    Number(
      new Intl.DateTimeFormat("en-GB", {
        hour: "numeric",
        hour12: false,
        timeZone: tz,
      }).format(now),
    ) % 24
  );
}

/** Inside [from, to) in local hours; handles windows that wrap midnight. */
export function isPausedHour(hour: number, from: number, to: number) {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Overnight (22:00 to 06:00) we go faster; by day, slower. */
export function paceFor(hour: number, cfg: HistoryConfig) {
  return hour >= 22 || hour < 6 ? cfg.HISTORY_NIGHT_MS : cfg.HISTORY_DAY_MS;
}

export function cutoffFor(now: Date, months: number) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** When a lot happened: its real close, else its start, else its offer window. */
export function lotDate(d: LotDetailRow, now: Date): Date | null {
  const real = (x: Date | null) => (x && !isPlaceholderEnd(x, now) ? x : null);
  return real(d.endAt) ?? d.startAt ?? real(d.offerWindowEndAt);
}

export const nextEma = (ema: number, recent: boolean) =>
  ema + EMA_ALPHA * ((recent ? 1 : 0) - ema);

export function stopReason(c: {
  nextId: number;
  dated: number;
  recentEma: number;
  missingStreak: number;
}): string | null {
  if (c.nextId < 1) return "reached the first lot ID";
  if (c.missingStreak >= MISSING_STREAK_STOP)
    return "no more lots below this ID";
  if (c.dated >= MIN_DATED_BEFORE_STOP && c.recentEma < STOP_RECENT_SHARE)
    return "reached the cutoff date";
  return null;
}

/** What the loop is doing, for /healthz and logs. */
export interface HistoryState {
  status: string;
  crawl: string | null;
  nextId: number | null;
  reachedAt: string | null;
  sold: number;
  todayRequests: number;
  /** transient failures on the same ID */
  failId: number | null;
  fails: number;
}

export const initialHistoryState = (): HistoryState => ({
  status: "starting",
  crawl: null,
  nextId: null,
  reachedAt: null,
  sold: 0,
  todayRequests: 0,
  failId: null,
  fails: 0,
});

const PROGRESS_EVERY = 1000;

/**
 * One step: skip IDs we already hold, then fetch and store one lot. Returns the delay before
 * the next step. Throws on transient errors (the loop retries after its error delay).
 */
export async function historyStep(
  db: Db,
  abc: AbcClient,
  log: Logger,
  cfg: HistoryConfig,
  state: HistoryState,
  now = new Date(),
): Promise<number> {
  const hour = hourIn(now, cfg.DISPLAY_TZ);
  if (
    isPausedHour(hour, cfg.HISTORY_PAUSE_FROM_HOUR, cfg.HISTORY_PAUSE_TO_HOUR)
  ) {
    state.status = "paused during closing hours";
    return 5 * MIN;
  }
  const crawl = await currentCrawl(db, cutoffFor(now, cfg.HISTORY_MONTHS));
  if (!crawl) {
    state.status = "done";
    state.crawl = null;
    return 6 * 60 * MIN;
  }
  state.crawl = crawl.key;
  state.nextId = crawl.nextId;

  const day = now.toISOString().slice(0, 10);
  state.todayRequests = await historyRequestsOn(db, day);
  if (
    state.todayRequests >= cfg.HISTORY_DAILY_MAX ||
    abc.requestsToday + cfg.HISTORY_RESERVE >= cfg.ABC_DAILY_CAP
  ) {
    state.status = "daily budget used; resumes tomorrow (UTC)";
    return 15 * MIN;
  }
  if (abc.breaker.state !== "closed") {
    state.status = "waiting for ABC to recover";
    return 5 * MIN;
  }

  // Skip what we already hold in full: no request needed.
  const low = Math.max(1, crawl.nextId - SKIP_WINDOW);
  const known = await completeIds(db, crawl.type, low, crawl.nextId);
  let id = crawl.nextId;
  while (id >= low && known.has(id)) id--;
  const skipped = crawl.skipped + (crawl.nextId - id);
  if (id < low) {
    await finishOrSave(db, log, crawl, { nextId: id, skipped }, state);
    return 0;
  }

  state.status = "running";
  const patch: CrawlPatch = {
    skipped,
    day,
    dayCount: (crawl.day === day ? crawl.dayCount : 0) + 1,
    fetched: crawl.fetched + 1,
  };
  try {
    const d = await abc.detail(id, crawl.type, "history");
    const tracked = (await trackedLotIds(db)).has(id);
    const kind = await storeHistoricLot(db, d, { tracked, sanitize, now });
    patch[kind] = crawl[kind] + 1;
    patch.missingStreak = 0;
    const when = lotDate(d, now);
    if (when) {
      patch.dated = crawl.dated + 1;
      patch.recentEma = nextEma(crawl.recentEma, when >= crawl.cutoff);
      patch.reachedAt = when;
    }
  } catch (e) {
    if (
      e instanceof AbcError &&
      e.kind === "http" &&
      (e.status === 400 || e.status === 404)
    ) {
      patch.missing = crawl.missing + 1;
      patch.missingStreak = crawl.missingStreak + 1;
    } else if (e instanceof AbcError && e.kind === "parse") {
      patch.errors = crawl.errors + 1;
    } else {
      // Transient (timeout, 5xx, breaker, cap): retry this ID later, give up after a few tries.
      state.fails = state.failId === id ? state.fails + 1 : 1;
      state.failId = id;
      if (state.fails < MAX_TRIES) {
        await saveCrawl(db, crawl.key, {
          nextId: id,
          skipped,
          day,
          dayCount: patch.dayCount,
        });
        throw e;
      }
      log.warn(
        { crawl: crawl.key, lot: id },
        "history: giving up on a lot after repeated failures",
      );
      patch.errors = crawl.errors + 1;
    }
  }
  state.fails = 0;
  state.failId = null;
  patch.nextId = id - 1;
  await finishOrSave(db, log, crawl, patch, state);

  const fetched = patch.fetched ?? crawl.fetched;
  if (fetched % PROGRESS_EVERY === 0)
    log.info(
      {
        crawl: crawl.key,
        nextId: patch.nextId,
        reached: (patch.reachedAt ?? crawl.reachedAt)
          ?.toISOString()
          .slice(0, 10),
        fetched,
        sold: patch.sold ?? crawl.sold,
        passed: patch.passed ?? crawl.passed,
        recentShare: Number((patch.recentEma ?? crawl.recentEma).toFixed(3)),
      },
      "history backfill progress",
    );
  return paceFor(hour, cfg);
}

async function finishOrSave(
  db: Db,
  log: Logger,
  crawl: HistoryCrawl,
  patch: CrawlPatch,
  state: HistoryState,
) {
  const merged = { ...crawl, ...patch };
  const reason = stopReason(merged);
  if (reason) {
    patch.doneAt = new Date();
    patch.doneReason = reason;
    log.info(
      {
        crawl: crawl.key,
        reason,
        lowestId: merged.nextId + 1,
        fetched: merged.fetched,
        sold: merged.sold,
        passed: merged.passed,
      },
      "history backfill finished",
    );
  }
  await saveCrawl(db, crawl.key, patch);
  state.nextId = merged.nextId;
  state.sold = merged.sold;
  state.reachedAt = merged.reachedAt?.toISOString() ?? null;
}
