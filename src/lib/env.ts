import { z } from "zod";

/** Server environment, validated once on first use (not at import, so builds don't need secrets). */
const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  APP_URL: z.url().default("http://localhost:3000"),
  BETTER_AUTH_URL: z.url().optional(),
  OWNER_EMAIL: z
    .string()
    .optional()
    .transform((v) => v?.trim().toLowerCase() || undefined)
    .pipe(z.email().optional()),
  AUTH_EMAIL_MODE: z
    .enum(["console", "link-copy", "resend"])
    .default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  DISPLAY_TZ: z.string().default("Africa/Harare"),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
