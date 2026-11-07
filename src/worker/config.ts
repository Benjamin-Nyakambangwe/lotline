import { existsSync } from "node:fs";
import { z } from "zod";

const bool = z.preprocess(
  (v) =>
    typeof v === "string"
      ? !["false", "0", "no", "off", ""].includes(v.toLowerCase())
      : v,
  z.boolean(),
);

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  ABC_API_BASE: z.url().default("https://app-api.abcauctions.co.zw/lots"),
  ABC_USER_AGENT: z.string().default("Mozilla/5.0"),
  ABC_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(6).default(6),
  ABC_RATE_PER_SEC: z.coerce.number().positive().max(3).default(3),
  ABC_DAILY_CAP: z.coerce.number().int().positive().default(40_000),
  ABC_POLLING_ENABLED: bool.default(true),
  WORKER_HEALTH_PORT: z.coerce.number().int().default(8081),
  /** catalogue sync cadence in minutes, by time of day in Harare */
  SYNC_EVERY_MIN_DAY: z.coerce.number().positive().default(10),
  SYNC_EVERY_MIN_NIGHT: z.coerce.number().positive().default(30),
  SOLD_SWEEP_EVERY_MIN: z.coerce.number().positive().default(180),
  /** pause between enrichment detail fetches */
  ENRICH_EVERY_MS: z.coerce.number().int().min(500).default(3000),
  /** Historical backfill: walk old lot IDs through the detail endpoint (see jobs/history.ts). */
  HISTORY_ENABLED: bool.default(true),
  HISTORY_MONTHS: z.coerce.number().int().min(1).max(120).default(12),
  /** pause between backfill requests overnight (22:00 to 06:00) and by day */
  HISTORY_NIGHT_MS: z.coerce.number().int().min(500).default(1000),
  HISTORY_DAY_MS: z.coerce.number().int().min(500).default(3000),
  /** no backfill in these hours (Harare), when lots close and live polling matters most */
  HISTORY_PAUSE_FROM_HOUR: z.coerce.number().int().min(0).max(23).default(16),
  HISTORY_PAUSE_TO_HOUR: z.coerce.number().int().min(0).max(23).default(22),
  /** backfill requests per UTC day, persisted so restarts don't reset it */
  HISTORY_DAILY_MAX: z.coerce.number().int().min(0).default(22_000),
  /** always leave this much of ABC_DAILY_CAP for live use */
  HISTORY_RESERVE: z.coerce.number().int().min(0).default(15_000),
  DISPLAY_TZ: z.string().default("Africa/Harare"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadConfig(): WorkerConfig {
  if (!process.env.DATABASE_URL && existsSync(".env.local"))
    process.loadEnvFile(".env.local");
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}
