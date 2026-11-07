import { randomUUID } from "node:crypto";
import { type BetterAuthPlugin, betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins/admin";
import { magicLink } from "better-auth/plugins/magic-link";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "../db/schema";
import { INVITE_GRACE_MS } from "./tokens";

/**
 * Better Auth for Lotline: invite-only magic links.
 *
 * Who may sign in:
 *  - the owner (OWNER_EMAIL), who becomes an admin;
 *  - existing users;
 *  - anyone holding a usable invite.
 * Everyone else gets the same generic "check your email" response and no email is sent.
 *
 * Framework-free so tests can build it on PGlite; the web app adds the Next.js cookie plugin.
 */

// biome-ignore lint/suspicious/noExplicitAny: works with both node-postgres and PGlite Drizzle instances
type AnyDb = PgDatabase<any, typeof schema>;

export interface AuthDeps {
  db: AnyDb;
  secret: string;
  baseURL: string;
  ownerEmail?: string;
  /** deliver a sign-in link (console log, email, or nothing in link-copy mode) */
  deliver: (msg: { email: string; url: string }) => Promise<void>;
  extraPlugins?: BetterAuthPlugin[];
  log?: (msg: string) => void;
}

export type Role = "admin" | "member";

/** Is this email allowed to get a sign-in link or create an account, and with which role? */
export async function accessFor(
  db: AnyDb,
  email: string,
  ownerEmail?: string,
): Promise<{ allowed: boolean; role: Role }> {
  const e = email.trim().toLowerCase();
  if (ownerEmail && e === ownerEmail.toLowerCase())
    return { allowed: true, role: "admin" };
  const existing = await db
    .select({ role: schema.user.role, banned: schema.user.banned })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${e}`)
    .limit(1);
  if (existing[0])
    return {
      allowed: !existing[0].banned,
      role: existing[0].role === "admin" ? "admin" : "member",
    };
  const now = new Date();
  const invite = await db
    .select({ role: schema.invites.role })
    .from(schema.invites)
    .where(
      and(
        sql`lower(${schema.invites.email}) = ${e}`,
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, now),
        or(
          isNull(schema.invites.acceptedAt),
          gt(
            schema.invites.acceptedAt,
            new Date(now.getTime() - INVITE_GRACE_MS),
          ),
        ),
      ),
    )
    .limit(1);
  if (invite[0]) return { allowed: true, role: invite[0].role };
  return { allowed: false, role: "member" };
}

/** Links captured for the invite flow (same process): captureId → URL. */
const captured = new Map<string, string>();
export const newCaptureId = () => randomUUID();
export function takeCapturedLink(captureId: string): string | null {
  const url = captured.get(captureId) ?? null;
  captured.delete(captureId);
  return url;
}

export function createAuth(d: AuthDeps) {
  return betterAuth({
    appName: "Lotline",
    baseURL: d.baseURL,
    secret: d.secret,
    database: drizzleAdapter(d.db, { provider: "pg", schema }),
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 30 * 24 * 3600, // auction night is no time to sign in again
      updateAge: 24 * 3600,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    rateLimit: { enabled: true, window: 60, max: 100 },
    plugins: [
      magicLink({
        expiresIn: 15 * 60,
        storeToken: "hashed",
        sendMagicLink: async ({ email, url, metadata }) => {
          const captureId = metadata?.captureId;
          if (typeof captureId === "string") {
            captured.set(captureId, url);
            setTimeout(() => captured.delete(captureId), 60_000).unref?.();
            return;
          }
          const access = await accessFor(d.db, email, d.ownerEmail);
          if (!access.allowed) {
            d.log?.(
              "sign-in requested for an email without access; no link sent",
            );
            return;
          }
          await d.deliver({ email, url });
        },
      }),
      admin({ defaultRole: "member", adminRoles: ["admin"] }),
      ...(d.extraPlugins ?? []),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const access = await accessFor(d.db, user.email, d.ownerEmail);
            if (!access.allowed) return false;
            // Magic-link sign-ups have no name yet: start with the email's local part.
            const name = user.name?.trim() || user.email.split("@")[0];
            return { data: { ...user, name, role: access.role } };
          },
          after: async (user) => {
            await d.db
              .insert(schema.userSettings)
              .values({ userId: user.id })
              .onConflictDoNothing();
            await d.db
              .update(schema.invites)
              .set({ acceptedAt: new Date() })
              .where(
                and(
                  sql`lower(${schema.invites.email}) = ${user.email.toLowerCase()}`,
                  isNull(schema.invites.acceptedAt),
                  isNull(schema.invites.revokedAt),
                ),
              );
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** Mark an existing user's invite accepted (new users are handled by the create hook). */
export async function acceptInviteById(db: AnyDb, inviteId: string) {
  await db
    .update(schema.invites)
    .set({ acceptedAt: new Date() })
    .where(eq(schema.invites.id, inviteId));
}
