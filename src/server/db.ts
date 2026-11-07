import "server-only";
import { createDb, type Db } from "@/lib/db/client";
import { serverEnv } from "@/lib/env";

// One pool per server process (reused across hot reloads in dev).
const g = globalThis as unknown as {
  __lotlineDb?: ReturnType<typeof createDb>;
};

export function getDb(): Db {
  if (!g.__lotlineDb) g.__lotlineDb = createDb(serverEnv().DATABASE_URL);
  return g.__lotlineDb.db;
}
