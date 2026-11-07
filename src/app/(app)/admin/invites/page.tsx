import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/empty-state";
import { PageSkeleton } from "@/components/page-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatClock } from "@/lib/domain/time";
import { revokeInviteAction } from "@/server/actions/invites";
import { requireAdmin } from "@/server/dal";
import { type InviteStatus, listInvites, listMembers } from "@/server/invites";
import { InviteForm } from "./invite-form";

export const metadata: Metadata = { title: "Invites" };

export default function InvitesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Invites />
    </Suspense>
  );
}

const STATUS_STYLE: Record<InviteStatus, string> = {
  pending: "bg-closing-bg text-closing",
  accepted: "bg-win-bg text-win",
  revoked: "bg-muted text-muted-foreground",
  expired: "bg-muted text-muted-foreground",
};

async function Invites() {
  const admin = await requireAdmin();
  const [invites, members] = await Promise.all([listInvites(), listMembers()]);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="People"
        description="Lotline is invite-only. Create a link and send it privately; it signs the person in. Use the same form to give an existing member a fresh sign-in link."
      />

      <InviteForm />

      <section aria-labelledby="members-heading">
        <h2
          id="members-heading"
          className="mb-3 text-sm font-semibold text-muted-foreground"
        >
          Members ({members.length})
        </h2>
        <ul className="divide-y rounded-2xl border bg-card">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {m.name || m.email}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {m.email}
                </span>
              </span>
              {m.id === admin.id && <Badge variant="outline">You</Badge>}
              <Badge variant={m.role === "admin" ? "default" : "secondary"}>
                {m.role === "admin" ? "Admin" : "Member"}
              </Badge>
              {m.banned && <Badge variant="destructive">Banned</Badge>}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="invites-heading">
        <h2
          id="invites-heading"
          className="mb-3 text-sm font-semibold text-muted-foreground"
        >
          Recent invite links
        </h2>
        {invites.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invites yet.
          </p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {invites.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{i.email}</span>
                  <span className="block text-xs text-muted-foreground">
                    Created {formatClock(i.createdAt)} ·{" "}
                    {i.role === "admin" ? "Admin" : "Member"}
                  </span>
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[i.status]}`}
                >
                  {i.status}
                </span>
                {i.status === "pending" && (
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="id" value={i.id} />
                    <Button type="submit" variant="ghost" size="sm">
                      Revoke
                    </Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
