// Run a command against the throwaway lotline_test database with a test owner account,
// so smoke and e2e tests never touch your real data. The database URL is derived from
// .env.local (same credentials, database "lotline_test") and is never printed.
//
// usage: node scripts/with-test-db.mjs <command...>
//   node scripts/with-test-db.mjs npx tsx scripts/migrate.ts
//   node scripts/with-test-db.mjs npx next dev -p 3001 > /tmp/lotline-e2e.log 2>&1
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const url = new URL(env.DATABASE_URL);
url.pathname = "/lotline_test";

const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: url.toString(),
    OWNER_EMAIL: "owner@lotline.test",
    AUTH_EMAIL_MODE: "console",
    APP_URL: "http://localhost:3001",
    BETTER_AUTH_URL: "http://localhost:3001",
    // The assistant answers from a script: tests never call Anthropic or spend money.
    ASSISTANT_MODE: "fake",
    ANTHROPIC_API_KEY: "",
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
