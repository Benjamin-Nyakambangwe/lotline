import { LinkIcon, TicketCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { acceptInviteAction } from "@/server/actions/invites";
import { findUsableInvite } from "@/server/invites";

export const metadata: Metadata = { title: "Invitation" };

export default function InvitePage({
  params,
  searchParams,
}: PageProps<"/invite/[token]">) {
  return (
    <Suspense fallback={<Skeleton className="h-48 w-full" />}>
      <Invite params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Invite({
  params,
  searchParams,
}: Pick<PageProps<"/invite/[token]">, "params" | "searchParams">) {
  // Invite validity depends on the current time, so this must render per request.
  await connection();
  const { token } = await params;
  const { invalid } = await searchParams;
  const invite = invalid ? null : await findUsableInvite(token);

  if (!invite) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <LinkIcon className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold">This link no longer works</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite links work once and expire after 7 days. Ask the person who
          invited you for a fresh one.
        </p>
        <Button asChild variant="ghost" className="mt-6">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={acceptInviteAction} className="text-center">
      <input type="hidden" name="token" value={token} />
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-primary/12 text-primary">
        <TicketCheck className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">
        You&apos;re invited to Lotline
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Live prices, exact winning and outbid status, and budgets that include
        fees, for ABC Auctions.
      </p>
      <p className="mt-5 rounded-lg border bg-background/60 px-3 py-2 text-sm">
        Signing in as <strong>{invite.email}</strong>
      </p>
      <Button type="submit" size="lg" className="mt-6 h-11 w-full">
        Continue
      </Button>
    </form>
  );
}
