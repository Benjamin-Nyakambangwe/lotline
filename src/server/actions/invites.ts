"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  acceptInviteById,
  newCaptureId,
  takeCapturedLink,
} from "@/lib/auth/config";
import { getAuth } from "../auth";
import { requireAdmin } from "../dal";
import { getDb } from "../db";
import {
  createInvite,
  findUsableInvite,
  revokeInvite,
  userExists,
} from "../invites";

export type InviteFormState =
  | { ok: true; email: string; url: string; existing: boolean }
  | { ok: false; error: string }
  | null;

const inviteInput = z.object({
  email: z.email("Enter a valid email address"),
  role: z.enum(["member", "admin"]).default("member"),
});

/** Admin: create an invite link (or a fresh sign-in link for an existing member). */
export async function createInviteAction(
  _prev: InviteFormState,
  form: FormData,
): Promise<InviteFormState> {
  const admin = await requireAdmin();
  const parsed = inviteInput.safeParse({
    email: form.get("email"),
    role: form.get("role") || undefined,
  });
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  const existing = await userExists(parsed.data.email);
  const invite = await createInvite({ ...parsed.data, invitedBy: admin.id });
  revalidatePath("/admin/invites");
  return { ok: true, email: invite.email, url: invite.url, existing };
}

export async function revokeInviteAction(form: FormData): Promise<void> {
  await requireAdmin();
  const id = z.uuid().safeParse(form.get("id"));
  if (id.success) await revokeInvite(id.data);
  revalidatePath("/admin/invites");
}

/**
 * Anyone holding a valid invite link: sign them in. We ask Better Auth for a magic link,
 * capture it in-process instead of emailing it, and send the browser straight to it.
 */
export async function acceptInviteAction(form: FormData): Promise<void> {
  const token = String(form.get("token") ?? "");
  const invite = await findUsableInvite(token);
  if (!invite) redirect(`/invite/${encodeURIComponent(token)}?invalid=1`);

  const captureId = newCaptureId();
  await getAuth().api.signInMagicLink({
    body: {
      email: invite.email,
      callbackURL: "/dashboard",
      metadata: { captureId },
    },
    headers: await headers(),
  });
  const link = takeCapturedLink(captureId);
  const magicToken = link ? new URL(link).searchParams.get("token") : null;
  if (!magicToken) redirect(`/invite/${encodeURIComponent(token)}?invalid=1`);

  // Verify on the server: Better Auth's nextCookies plugin sets the session cookie on this
  // action's response, so the browser lands on the dashboard already signed in.
  try {
    await getAuth().api.magicLinkVerify({
      query: { token: magicToken },
      headers: await headers(),
    });
  } catch {
    redirect(`/invite/${encodeURIComponent(token)}?invalid=1`);
  }

  // New users have their invite marked accepted when the account is created;
  // existing members (a fresh sign-in link) are marked here.
  if (await userExists(invite.email))
    await acceptInviteById(getDb(), invite.id);
  redirect("/dashboard");
}
