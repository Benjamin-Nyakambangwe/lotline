import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  accessFor,
  createAuth,
  newCaptureId,
  takeCapturedLink,
} from "@/lib/auth/config";
import { hashToken, INVITE_TTL_MS, newInviteToken } from "@/lib/auth/tokens";
import * as schema from "@/lib/db/schema";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });
const OWNER = "owner@lotline.test";
const delivered: { email: string; url: string }[] = [];

const auth = createAuth({
  db,
  secret: "test-secret-test-secret-test-secret-0000",
  baseURL: "http://localhost:3000",
  ownerEmail: OWNER,
  deliver: async (m) => void delivered.push(m),
});

const headers = () => new Headers({ "x-forwarded-for": "127.0.0.1" });
const requestLink = (email: string) =>
  auth.api.signInMagicLink({ body: { email }, headers: headers() });
const tokenOf = (url: string) =>
  new URL(url).searchParams.get("token") as string;

async function invite(
  email: string,
  extra: Partial<typeof schema.invites.$inferInsert> = {},
) {
  await db.insert(schema.invites).values({
    email,
    tokenHash: hashToken(newInviteToken()),
    role: "member",
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    ...extra,
  });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
afterAll(async () => {
  await pg.close();
});
beforeEach(() => {
  delivered.length = 0;
});

describe("invite-only sign-in", () => {
  it("answers strangers generically and sends nothing", async () => {
    const res = await requestLink("stranger@example.com");
    expect(res.status).toBe(true);
    expect(delivered).toHaveLength(0);
  });

  it("lets the owner in as an admin and creates their settings", async () => {
    await requestLink(OWNER);
    expect(delivered).toHaveLength(1);
    await auth.api.magicLinkVerify({
      query: { token: tokenOf(delivered[0].url) },
      headers: headers(),
    });
    const [u] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, OWNER));
    expect(u.role).toBe("admin");
    const settings = await db
      .select()
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, u.id));
    expect(settings).toHaveLength(1);
    expect(settings[0].theme).toBe("dark");
  });

  it("lets invited people in as members and marks the invite accepted", async () => {
    await invite("Friend@Example.com");
    await requestLink("friend@example.com");
    expect(delivered).toHaveLength(1);
    await auth.api.magicLinkVerify({
      query: { token: tokenOf(delivered[0].url) },
      headers: headers(),
    });
    const [u] = await db
      .select()
      .from(schema.user)
      .where(eq(schema.user.email, "friend@example.com"));
    expect(u.role).toBe("member");
    const [inv] = await db
      .select()
      .from(schema.invites)
      .where(eq(schema.invites.email, "Friend@Example.com"));
    expect(inv.acceptedAt).toBeInstanceOf(Date);
  });

  it("ignores revoked and expired invites", async () => {
    await invite("revoked@example.com", { revokedAt: new Date() });
    await invite("expired@example.com", {
      expiresAt: new Date(Date.now() - 1000),
    });
    await requestLink("revoked@example.com");
    await requestLink("expired@example.com");
    expect(delivered).toHaveLength(0);
  });

  it("refuses banned users", async () => {
    await db
      .update(schema.user)
      .set({ banned: true })
      .where(eq(schema.user.email, "friend@example.com"));
    expect((await accessFor(db, "friend@example.com", OWNER)).allowed).toBe(
      false,
    );
    await requestLink("friend@example.com");
    expect(delivered).toHaveLength(0);
  });

  it("captures the link for the invite page instead of delivering it", async () => {
    const id = newCaptureId();
    await auth.api.signInMagicLink({
      body: { email: OWNER, metadata: { captureId: id } },
      headers: headers(),
    });
    expect(delivered).toHaveLength(0);
    expect(takeCapturedLink(id)).toMatch(
      /\/api\/auth\/magic-link\/verify\?token=/,
    );
    expect(takeCapturedLink(id)).toBeNull();
  });
});
