import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { workerHeartbeat } from "@/lib/db/schema";
import { getDb } from "@/server/db";

/** The worker writes a heartbeat every 5 s; older than this means it's down. */
const WORKER_STALE_S = 120;

/**
 * Health for Railway and uptime monitors (public, no details worth hiding).
 * - default: 200 when the web app can reach the database (Railway's deploy check, which must
 *   not fail just because the worker is restarting)
 * - ?strict: also 503 when the worker's heartbeat is stale (for an uptime monitor)
 */
export async function GET(request: Request) {
  await connection();
  const strict = new URL(request.url).searchParams.has("strict");
  const db = getDb();
  try {
    await db.execute(sql`select 1`);
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
  const [hb] = await db
    .select({
      at: workerHeartbeat.lastTickAt,
      breaker: workerHeartbeat.breaker,
    })
    .from(workerHeartbeat)
    .limit(1);
  const ageS = hb ? Math.round((Date.now() - hb.at.getTime()) / 1000) : null;
  const worker = {
    ok: ageS !== null && ageS < WORKER_STALE_S,
    lastTickSecondsAgo: ageS,
    abc: hb?.breaker === "closed" ? "ok" : (hb?.breaker ?? "unknown"),
  };
  return Response.json(
    { ok: true, db: true, worker },
    {
      status: strict && !worker.ok ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
