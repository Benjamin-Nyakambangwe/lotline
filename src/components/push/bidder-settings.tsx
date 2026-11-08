"use client";

import { BadgeCheck } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { unlinkBidder } from "@/server/actions/watch";
import { useLive } from "../live/live-provider";

/** The ABC bidder number linked to this account: masked, with Unlink. */
export function BidderSettings() {
  const live = useLive();
  const [busy, start] = useTransition();
  const bidder = live.data?.bidder;
  if (!bidder) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!bidder.linked)
    return (
      <p className="text-sm text-muted-foreground">
        Not linked. After your next bid on ABC, open that lot in Lotline and tap
        “I just bid on ABC: that's me”. From then on, winning and outbid are
        exact on every lot you watch.
      </p>
    );
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="flex items-center gap-2 text-sm">
        <BadgeCheck className="size-4 text-win" aria-hidden="true" />
        ABC bidder{" "}
        <span className="font-mono font-semibold">{bidder.masked}</span> is
        linked: status is exact.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() =>
          start(async () => {
            await unlinkBidder();
            live.refresh();
            toast(
              "Bidder unlinked: status is estimated from the bids you enter",
            );
          })
        }
      >
        Unlink
      </Button>
    </div>
  );
}
