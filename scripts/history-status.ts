/**
 * Progress of the historical backfill: `npm run history`.
 * Reads the database only (never ABC). Uses DATABASE_URL, or .env.local.
 */
import { existsSync } from "node:fs";
import { Client } from "pg";

const fmt = (n: number) => n.toLocaleString("en-US");
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "-");

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = new Client({ connectionString: process.env.DATABASE_URL });
  await pg.connect();
  try {
    const crawls = (
      await pg.query(
        `select * from history_crawls order by case key when 'goods' then 0 else 1 end`,
      )
    ).rows;
    if (!crawls.length)
      console.log(
        "The backfill hasn't started yet: it begins a minute after the worker starts (outside 16:00–22:00).",
      );
    for (const c of crawls) {
      const done = c.done_at ? `done (${c.done_reason})` : "running";
      console.log(`\n${c.key} (ABC type ${c.type}): ${done}`);
      console.log(
        `  IDs ${fmt(c.start_id)} → ${fmt(c.next_id + 1)}  (${fmt(c.start_id - c.next_id)} walked, ${fmt(c.skipped)} already held)`,
      );
      console.log(
        `  reached lots from ${day(c.reached_at)}  · target ${day(c.cutoff)}  · recent share ${Number(c.recent_ema).toFixed(2)}`,
      );
      console.log(
        `  fetched ${fmt(c.fetched)}: ${fmt(c.sold)} sold, ${fmt(c.passed)} passed, ${fmt(c.other)} other, ${fmt(c.missing)} missing, ${fmt(c.errors)} errors`,
      );
      if (!c.done_at && c.reached_at) {
        // Extrapolate: IDs per day of history so far, applied to the days still to go.
        const walked = c.start_id - c.next_id;
        const spanDays =
          (new Date(c.started_at).getTime() -
            new Date(c.reached_at).getTime()) /
          86_400_000;
        const leftDays =
          (new Date(c.reached_at).getTime() - new Date(c.cutoff).getTime()) /
          86_400_000;
        if (spanDays > 3 && leftDays > 0) {
          const fetchShare = c.fetched / Math.max(1, walked);
          const leftReq = Math.round(
            (walked / spanDays) * leftDays * fetchShare,
          );
          const perDay = Number(process.env.HISTORY_DAILY_MAX ?? 22_000);
          console.log(
            `  about ${fmt(leftReq)} requests to go (~${Math.max(1, Math.ceil(leftReq / perDay))} more day(s))`,
          );
        }
      }
    }
    const used = Number(
      (
        await pg.query(
          `select coalesce(sum(day_count), 0)::int as n from history_crawls
           where day = (now() at time zone 'utc')::date`,
        )
      ).rows[0].n,
    );
    console.log(`\nBackfill requests today (UTC): ${fmt(used)}`);

    const m = (
      await pg.query(`select count(*)::int as n,
          count(*) filter (where final_hammer is not null)::int as sold,
          count(*) filter (where category is not null)::int as categorised,
          min(closed_at) as first, max(closed_at) as last
        from closed_prices`)
    ).rows[0];
    const l = (
      await pg.query(`select count(*)::int as n,
          count(*) filter (where final_state = 'final')::int as final
        from lots`)
    ).rows[0];
    console.log(
      `Market rows: ${fmt(m.n)} (${fmt(m.sold)} with a price, ${fmt(m.categorised)} categorised), ${day(m.first)} → ${day(m.last)}`,
    );
    console.log(`Lots stored: ${fmt(l.n)} (${fmt(l.final)} closed)`);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error("history status failed:", (e as Error).message);
  process.exit(1);
});
