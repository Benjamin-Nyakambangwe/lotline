/**
 * Apply committed SQL migrations from ./drizzle.
 * Used locally (`npm run db:migrate`) and as Railway's pre-deploy command for the web service.
 * Reads DATABASE_URL from the environment, falling back to .env.local in development.
 */
import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

async function main() {
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
    const { rows } = await pool.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    console.log(`migrations applied: ${rows[0].n} tables in public`);
  } catch (e) {
    console.error(
      "migration failed:",
      (e as Error).message.replaceAll(url, "<DATABASE_URL>"),
    );
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
