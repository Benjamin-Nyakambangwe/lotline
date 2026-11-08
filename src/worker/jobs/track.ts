import { eq } from "drizzle-orm";
import { type AbcClient, AbcError } from "@/lib/abc/client";
import type { Db } from "@/lib/db/client";
import {
  applyClosedDetail,
  upsertClosedFromList,
} from "@/lib/db/queries/closed";
import { recordSnapshots, upsertDetail } from "@/lib/db/queries/lots";
import {
  afterReading,
  closingStateOf,
  type DueLot,
  dueLots,
  evaluateStatuses,
  pollFailed,
  refreshPollSet,
} from "@/lib/db/queries/track";
import { lots } from "@/lib/db/schema";
import { applyReading } from "@/lib/domain/closing";
import { centsToNumeric } from "@/lib/domain/money";
import type { Logger } from "../log";
import { sanitize } from "./enrich";

/** Read one tracked lot's detail and fold it into its closing state. */
async function readLot(
  db: Db,
  abc: AbcClient,
  d: DueLot,
  now: Date,
  hot: number,
) {
  const prev = await closingStateOf(db, d.lotId, d.stableAfterEnd);
  if (!prev) return null;
  const [before] = await db
    .select({
      current: lots.currentBid,
      next: lots.startingBid,
      end: lots.endAt,
    })
    .from(lots)
    .where(eq(lots.id, d.lotId));
  // Near the close, read detail (search lags): hot and near lots jump the queue.
  const det = await abc.detail(
    d.lotId,
    d.type,
    d.tier === "warm" ? "warm" : "hot",
  );
  await upsertDetail(db, det, { tracked: true, sanitize, now });
  const changed =
    before?.current !== centsToNumeric(det.currentBid) ||
    before?.next !== centsToNumeric(det.startingBid) ||
    (det.endAt && before?.end?.getTime() !== det.endAt.getTime());
  if (changed) await recordSnapshots(db, [det], "detail", now);
  const state = applyReading(prev, {
    observedAt: now,
    status: det.status,
    endAt: det.endAt,
  });
  await afterReading(db, d.lotId, state, now, hot);
  if (state.final && !prev.final) {
    // We watched it close: the most trustworthy market row there is.
    await upsertClosedFromList(db, [det], "observed", now);
    await applyClosedDetail(db, det, now);
  }
  return state;
}

/**
 * One pass of live tracking: keep the poll set in step with what people watch, read the lots
 * that are due (more often the nearer they are to closing), then re-judge everyone's status and
 * record alerts. Returns the delay before the next pass.
 */
export async function trackStep(
  db: Db,
  abc: AbcClient,
  log: Logger,
  now = new Date(),
) {
  const { tracked, hot } = await refreshPollSet(db, now);
  const due = await dueLots(db, now, 12);
  const results = await Promise.allSettled(
    due.map((d) => readLot(db, abc, d, now, hot)),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const e = r.reason as Error;
      void pollFailed(db, due[i].lotId, String(e.message), now);
      if (!(e instanceof AbcError && e.kind === "breaker"))
        log.warn(
          { lot: due[i].lotId, err: String(e.message).slice(0, 200) },
          "tracked read failed",
        );
    }
  });
  const notes = await evaluateStatuses(db, now);
  if (notes.length)
    log.info(
      { alerts: notes.length, kinds: [...new Set(notes.map((n) => n.kind))] },
      "alerts",
    );
  if (due.length)
    log.debug({ read: due.length, tracked, hot }, "tracked lots read");
  return due.length ? 1_000 : 2_000;
}
