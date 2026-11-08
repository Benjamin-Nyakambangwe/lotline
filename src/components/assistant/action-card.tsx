"use client";

import { Check, Eye, EyeOff, X } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionView } from "@/lib/assistant/transcript";
import { formatMoney } from "@/lib/domain/money";
import { decideAssistantAction } from "@/server/actions/assistant";

/** A change the assistant proposed. Nothing happens until the person taps Confirm. */
export function ActionCard({ action: initial }: { action: ActionView }) {
  const [action, setAction] = useState(initial);
  const [pending, start] = useTransition();
  const decide = (decision: "confirmed" | "declined") =>
    start(async () => {
      const res = await decideAssistantAction({ id: action.id, decision });
      if (res.action) setAction(res.action);
      if (res.ok && decision === "confirmed")
        toast.success(
          action.kind === "watch"
            ? "Added to your watchlist"
            : "Removed from your watchlist",
        );
    });
  const Icon = action.kind === "watch" ? Eye : EyeOff;
  return (
    <div className="my-3 rounded-xl border border-primary/30 bg-primary/6 p-3">
      <p className="flex items-center gap-2 text-xs font-medium text-primary">
        <Icon className="size-3.5" aria-hidden="true" />
        {action.kind === "watch"
          ? "Watch this lot?"
          : "Stop watching this lot?"}
      </p>
      <p className="mt-1 text-sm font-medium">
        {action.title ?? `Lot ${action.lotId}`}
      </p>
      {action.maxBidCents !== null && (
        <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
          Your max {formatMoney(action.maxBidCents)} hammer
          {action.allInCents !== null && (
            <> · {formatMoney(action.allInCents)} all-in</>
          )}
        </p>
      )}
      {action.note && (
        <p className="mt-0.5 text-sm text-muted-foreground">“{action.note}”</p>
      )}
      {action.status === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            onClick={() => decide("confirmed")}
            disabled={pending}
          >
            <Check /> Confirm
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => decide("declined")}
            disabled={pending}
          >
            <X /> Not now
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-muted-foreground">
          {action.status === "confirmed" ? "Done" : "Not done"}
        </p>
      )}
    </div>
  );
}
