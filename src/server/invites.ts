import "server-only";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { hashToken, INVITE_TTL_MS, newInviteToken } from "@/lib/auth/tokens";
import * as schema from "@/lib/db/schema";
import { serverEnv } from "@/lib/env";
import { getDb } from "./db";

export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export function inviteStatus(i: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InviteStatus {
  if (i.revokedAt) return "revoked";
  if (i.acceptedAt) return "accepted";
  if (i.expiresAt.getTime() <= Date.now()) return "expired";
  return "pending";
}

/**
 * Create an invite (or a fresh sign-in link for an existing member). Any pending invite for the
 * same email is revoked first, so only the newest link works. Returns the link to share.
 */
export async function createInvite(input: {
  email: string;
  role: "member" | "admin";
  invitedBy: string;
}) {
  const db = getDb();
  const email = input.email.trim().toLowerCase();
  const token = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.invites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          sql`lower(${schema.invites.email}) = ${email}`,
          isNull(schema.invites.acceptedAt),
          isNull(schema.invites.revokedAt),
        ),
      );
    await tx.insert(schema.invites).values({
      email,
      tokenHash: hashToken(token),
      role: input.role,
      invitedBy: input.invitedBy,
      expiresAt,
    });
  });
  return { email, url: `${serverEnv().APP_URL}/invite/${token}`, expiresAt };
}

export async function listInvites(limit = 50) {
  const rows = await getDb()
    .select({
      id: schema.invites.id,
      email: schema.invites.email,
      role: schema.invites.role,
      createdAt: schema.invites.createdAt,
      expiresAt: schema.invites.expiresAt,
      acceptedAt: schema.invites.acceptedAt,
      revokedAt: schema.invites.revokedAt,
    })
    .from(schema.invites)
    .orderBy(desc(schema.invites.createdAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, status: inviteStatus(r) }));
}

export async function revokeInvite(id: string) {
  await getDb()
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invites.id, id),
        isNull(schema.invites.acceptedAt),
        isNull(schema.invites.revokedAt),
      ),
    );
}

/** A usable invite for this token: not accepted, not revoked, not expired. Links work once. */
export async function findUsableInvite(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [row] = await getDb()
    .select()
    .from(schema.invites)
    .where(
      and(
        eq(schema.invites.tokenHash, hashToken(token)),
        isNull(schema.invites.acceptedAt),
        isNull(schema.invites.revokedAt),
        gt(schema.invites.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function userExists(email: string) {
  const [row] = await getDb()
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = ${email.toLowerCase()}`)
    .limit(1);
  return !!row;
}

export async function listMembers() {
  return getDb()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      role: schema.user.role,
      banned: schema.user.banned,
      createdAt: schema.user.createdAt,
    })
    .from(schema.user)
    .orderBy(schema.user.createdAt);
}
