"use server";

import { headers } from "next/headers";
import { newCaptureId, takeCapturedLink } from "@/lib/auth/config";
import { getAuth } from "../auth";
import { requireUser } from "../dal";

/**
 * A one-time sign-in link for the person who is already signed in, to sign in another place
 * that can't share this browser's session: on iPhone, the Home Screen app keeps its own
 * cookies, apart from Safari's. Works once, for 15 minutes.
 */
export async function deviceSignInLink() {
  const user = await requireUser();
  const captureId = newCaptureId();
  await getAuth().api.signInMagicLink({
    body: {
      email: user.email,
      callbackURL: "/watchlist",
      metadata: { captureId },
    },
    headers: await headers(),
  });
  const url = takeCapturedLink(captureId);
  return url ? { ok: true as const, url } : { ok: false as const };
}
