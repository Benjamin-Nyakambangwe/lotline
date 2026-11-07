"use client";

import { Check, Copy, Link2 } from "lucide-react";
import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createInviteAction,
  type InviteFormState,
} from "@/server/actions/invites";

export function InviteForm() {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(
    createInviteAction,
    null,
  );
  const [copied, setCopied] = useState(false);

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Invite link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy. Select the link and copy it manually.");
    }
  };

  return (
    <div className="rounded-2xl border bg-card p-5">
      <form
        action={action}
        className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end"
      >
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            name="email"
            type="email"
            required
            autoComplete="off"
            placeholder="name@example.com"
            className="h-11"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-role">Role</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="member"
            className="h-11 rounded-lg border border-input bg-transparent px-3 text-sm dark:bg-input/30"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
        </div>
        <Button type="submit" size="lg" className="h-11" disabled={pending}>
          <Link2 /> {pending ? "Creating…" : "Create link"}
        </Button>
      </form>

      {state && !state.ok && (
        <p className="mt-3 text-sm text-destructive">{state.error}</p>
      )}
      {state?.ok && (
        <div className="mt-4 rounded-xl border border-primary/30 bg-primary/8 p-4">
          <p className="text-sm">
            {state.existing ? "A fresh sign-in link" : "An invite"} for{" "}
            <strong>{state.email}</strong>. Send it to them privately (it works
            once, for 7 days):
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              readOnly
              value={state.url}
              className="h-11 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="lg"
              className="h-11"
              onClick={() => copy(state.url)}
            >
              {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
