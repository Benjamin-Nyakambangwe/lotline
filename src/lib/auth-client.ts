import { magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side auth client (same origin). */
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });

/** Only allow same-site relative paths as post-sign-in destinations (no open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (
    !next ||
    !next.startsWith("/") ||
    next.startsWith("//") ||
    next.startsWith("/\\")
  )
    return "/dashboard";
  return next;
}
