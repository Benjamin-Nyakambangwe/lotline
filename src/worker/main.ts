/**
 * Lotline worker: the only process that talks to ABC Auctions.
 *
 * Leadership: one worker polls at a time (Postgres advisory lock); a second instance stands by
 * and takes over within seconds if the leader dies. Every ABC request goes through one limiter
 * (≤ 6 concurrent, ≤ 3/s) and one circuit breaker, with a daily cap and a kill switch.
 *
 * Loops (leader only):
 *  - catalogue   full "Available" sync every 10 min by day, 30 min at night
 *  - categories  tag every open lot with its category (~12 requests) every hour
 *  - auctions    find every auction on sale and tag its lots (~20 requests) every 30 min
 *  - sold        sweep sold lots into market insights every 3 h
 *  - enrich      one lot detail every few seconds until every lot has one, then lots that
 *                ended without us seeing the result, then sold lots for market insights
 *  - history     the 12-month backfill of past lots, one gentle request at a time (resumes)
 *  - requests    the web app's on-demand fetches (LISTEN lotline_fetch + 2 s poll)
 *  - track       watched lots, read more often near the close (8 s when hot); status + alerts
 *  - push        new alerts to people's phones (Web Push), within a couple of seconds
 *  - heartbeat   worker_heartbeat row + /healthz freshness
 */
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { Client } from "pg";
import { AbcClient, type RequestInfo } from "@/lib/abc/client";
import { Limiter, type Priority } from "@/lib/abc/limiter";
import { createDb } from "@/lib/db/client";
import { workerHeartbeat } from "@/lib/db/schema";
import { loadConfig } from "./config";
import { type HealthState, startHealthServer } from "./health";
import { syncAuctions } from "./jobs/auctions";
import { sweepSold, syncCatalogue, tagCategories } from "./jobs/catalogue";
import {
  drainFetchRequests,
  enrichOne,
  refreshClosedFromLots,
} from "./jobs/enrich";
import {
  type HistoryState,
  historyStep,
  initialHistoryState,
} from "./jobs/history";
import { pushStep, webPushSender } from "./jobs/push";
import { trackStep } from "./jobs/track";
import { Leader } from "./leader";
import { createLogger } from "./log";
import { Loops } from "./loops";

const MIN = 60_000;
const STANDBY_RETRY_MS = 5_000;

/** Rolling request stats for health and the heartbeat row. */
class Metrics {
  private reqs: { at: number; ms: number; ok: boolean }[] = [];
  lastError: string | null = null;
  record(i: RequestInfo) {
    // 400/404 is ABC saying "no such lot" (the backfill meets these): a healthy answer.
    const ok =
      typeof i.status === "number" &&
      (i.status < 400 || i.status === 400 || i.status === 404);
    if (!ok) this.lastError = `${i.status} ${i.path.split("?")[0]}`;
    this.reqs.push({ at: Date.now(), ms: i.ms, ok });
    const cutoff = Date.now() - 10 * MIN;
    while (this.reqs.length && this.reqs[0].at < cutoff) this.reqs.shift();
  }
  summary() {
    const lastMin = this.reqs.filter((r) => r.at > Date.now() - MIN);
    const ms = this.reqs.map((r) => r.ms).sort((a, b) => a - b);
    const pick = (p: number) =>
      ms.length
        ? Math.round(ms[Math.min(ms.length - 1, Math.floor(p * ms.length))])
        : null;
    const okRate = this.reqs.length
      ? this.reqs.filter((r) => r.ok).length / this.reqs.length
      : null;
    return {
      perMin: lastMin.length,
      p50: pick(0.5),
      p95: pick(0.95),
      okRate,
      lastError: this.lastError,
    };
  }
}

function isDaytime(tz: string) {
  const h = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: tz,
    }).format(new Date()),
  );
  return h >= 6 && h < 22;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const cfg = loadConfig();
  const log = createLogger(cfg.LOG_LEVEL);
  const instanceId = `${hostname()}-${process.pid}-${randomBytes(2).toString("hex")}`;
  const { db, pool } = createDb(cfg.DATABASE_URL, {
    max: 5,
    application_name: "lotline-worker",
  });
  const metrics = new Metrics();
  const limiter = new Limiter({
    concurrency: cfg.ABC_MAX_CONCURRENCY,
    ratePerSec: cfg.ABC_RATE_PER_SEC,
    burst: Math.max(1, Math.min(6, Math.round(cfg.ABC_RATE_PER_SEC * 2))),
  });
  const abc = new AbcClient({
    baseUrl: cfg.ABC_API_BASE,
    userAgent: cfg.ABC_USER_AGENT,
    limiter,
    dailyCap: cfg.ABC_DAILY_CAP,
    enabled: cfg.ABC_POLLING_ENABLED,
    onRequest: (i) => {
      metrics.record(i);
      log.debug(
        {
          path: i.path.split("?")[0],
          priority: i.priority,
          status: i.status,
          ms: i.ms,
          inFlight: limiter.inFlight,
        },
        "abc request",
      );
    },
  });

  const history: HistoryState = initialHistoryState();
  const push = webPushSender(cfg);
  if (!push)
    log.warn("VAPID keys not set: alerts stay in-app (no push to phones)");
  const health: HealthState = {
    role: "starting",
    instanceId,
    lastTickAt: Date.now(),
    leaderSince: null,
    details: () => ({
      breaker: abc.breaker.state,
      requestsToday: abc.requestsToday,
      abc: metrics.summary(),
      queued: limiter.queued,
      inFlight: limiter.inFlight,
      history: cfg.HISTORY_ENABLED ? history : "disabled",
    }),
  };
  const server = startHealthServer(cfg.WORKER_HEALTH_PORT, health);
  log.info(
    {
      instanceId,
      port: cfg.WORKER_HEALTH_PORT,
      polling: cfg.ABC_POLLING_ENABLED,
      rate: cfg.ABC_RATE_PER_SEC,
    },
    "worker starting",
  );

  const loops = new Loops(
    [
      {
        name: "catalogue",
        run: async () => {
          await syncCatalogue(db, abc, log);
          return (
            (isDaytime(cfg.DISPLAY_TZ)
              ? cfg.SYNC_EVERY_MIN_DAY
              : cfg.SYNC_EVERY_MIN_NIGHT) * MIN
          );
        },
        errorDelayMs: 2 * MIN,
      },
      {
        name: "categories",
        initialDelayMs: 45_000,
        run: async () => {
          await tagCategories(db, abc, log);
          return 60 * MIN;
        },
        errorDelayMs: 10 * MIN,
      },
      {
        name: "auctions",
        initialDelayMs: 15_000,
        run: async () => {
          await syncAuctions(db, abc, log);
          return 30 * MIN;
        },
        errorDelayMs: 5 * MIN,
      },
      {
        name: "sold",
        initialDelayMs: 20_000,
        run: async () => {
          await sweepSold(db, abc, log);
          return cfg.SOLD_SWEEP_EVERY_MIN * MIN;
        },
        errorDelayMs: 10 * MIN,
      },
      {
        name: "enrich",
        initialDelayMs: 30_000,
        run: async () =>
          (await enrichOne(db, abc, log)) ? cfg.ENRICH_EVERY_MS : MIN,
        errorDelayMs: 30_000,
      },
      ...(cfg.HISTORY_ENABLED
        ? [
            {
              name: "history",
              initialDelayMs: 60_000,
              run: () => historyStep(db, abc, log, cfg, history),
              errorDelayMs: MIN,
            },
          ]
        : []),
      {
        name: "closed-refresh",
        initialDelayMs: 5 * MIN,
        run: async () => {
          await refreshClosedFromLots(db);
          return 30 * MIN;
        },
      },
      {
        name: "track",
        initialDelayMs: 3_000,
        run: async () => {
          const delay = await trackStep(db, abc, log);
          loops.wake("push");
          return delay;
        },
        errorDelayMs: 5_000,
      },
      ...(push
        ? [
            {
              name: "push",
              initialDelayMs: 4_000,
              run: () => pushStep(db, push, log),
              errorDelayMs: 5_000,
            },
          ]
        : []),
      {
        name: "requests",
        run: async () => {
          await drainFetchRequests(db, abc, log);
          return 2_000;
        },
        errorDelayMs: 5_000,
      },
      {
        name: "heartbeat",
        run: async () => {
          const m = metrics.summary();
          const queueDepths = Object.fromEntries(
            (
              [
                "hot",
                "ondemand",
                "warm",
                "sync",
                "enrich",
                "history",
              ] as Priority[]
            ).map((p) => [p, limiter.queuedBy(p)]),
          );
          const row = {
            id: 1,
            instanceId,
            leaderSince: health.leaderSince
              ? new Date(health.leaderSince)
              : null,
            lastTickAt: new Date(),
            abcHealth: m,
            breaker: abc.breaker.state,
            reqToday: abc.requestsToday,
            reqPerMin: m.perMin,
            queueDepths,
          };
          await db
            .insert(workerHeartbeat)
            .values(row)
            .onConflictDoUpdate({ target: workerHeartbeat.id, set: row });
          health.lastTickAt = Date.now();
          return 5_000;
        },
        errorDelayMs: 5_000,
      },
    ],
    log,
  );

  // Wake the request loop as soon as the web app asks for something.
  let listener: Client | null = null;
  const listen = async () => {
    listener = new Client({
      connectionString: cfg.DATABASE_URL,
      application_name: "lotline-worker-listen",
    });
    listener.on("notification", () => {
      loops.wake("requests");
      loops.wake("track");
    });
    listener.on("error", () => {
      listener = null;
    });
    await listener.connect();
    await listener.query("listen lotline_fetch");
  };

  const leader = new Leader(cfg.DATABASE_URL);
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    health.role = "stopping";
    log.info({ signal }, "shutting down");
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await loops.stop();
    await leader.release();
    await (listener as Client | null)?.end().catch(() => {});
    await pool.end().catch(() => {});
    server.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  while (!stopping) {
    if (!leader.isLeader) {
      if (await leader.tryAcquire()) {
        health.role = "leader";
        health.leaderSince = Date.now();
        health.lastTickAt = Date.now();
        log.info({ instanceId }, "became leader; starting loops");
        if (!listener)
          await listen().catch((e) =>
            log.warn({ err: String(e) }, "LISTEN failed; polling only"),
          );
        loops.start();
      } else {
        if (health.role !== "standby")
          log.info("another worker is leader; standing by");
        health.role = "standby";
        health.lastTickAt = Date.now();
        await sleep(STANDBY_RETRY_MS);
      }
      continue;
    }
    if (!(await leader.check())) {
      log.error("lost the leader lock; stopping all polling");
      await loops.stop();
      health.role = "standby";
      health.leaderSince = null;
      continue;
    }
    await sleep(5_000);
  }
}

main().catch((e) => {
  console.error("worker crashed:", (e as Error).message);
  process.exit(1);
});
