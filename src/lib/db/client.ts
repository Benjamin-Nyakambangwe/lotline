import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** Create a Drizzle client over a pg Pool. Web and worker each create their own. */
export function createDb(
  url: string,
  config: PoolConfig = {},
): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: url, max: 10, ...config });
  return { db: drizzle(pool, { schema, casing: "snake_case" }), pool };
}

export { schema };
