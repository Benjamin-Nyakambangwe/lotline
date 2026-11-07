import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic gate: no session cookie → sign-in page (or 401 for APIs).
 * This is only a fast path. Real authorization happens in the data access layer
 * (src/server/dal.ts) on every page and action.
 */
const PUBLIC = [
  /^\/sign-in(?:\/|$)/,
  /^\/invite\//,
  /^\/api\/auth\//,
  /^\/api\/health(?:\/|$)/,
];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC.some((r) => r.test(pathname))) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search =
    pathname === "/" || pathname === "/dashboard"
      ? ""
      : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|robots.txt).*)",
  ],
};
