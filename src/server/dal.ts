import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./auth";

/**
 * Data access layer: the only place pages and actions learn who the user is.
 * Reads request headers, so callers must sit inside a <Suspense> boundary
 * (a Cache Components rule). Layouts are not a security boundary: every page and
 * action calls requireUser() / requireAdmin() itself.
 */

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  image: string | null;
};

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string | null };
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "admin" ? "admin" : "member",
    image: u.image ?? null,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}
