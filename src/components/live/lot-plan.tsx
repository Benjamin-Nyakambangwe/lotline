"use client";

import { BadgeCheck, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { allIn, type FeeRates } from "@/lib/domain/fees";
import { formatMoney } from "@/lib/domain/money";
import { formatTime } from "@/lib/domain/time";
import {
  linkBidder,
  previewBidderLink,
  setLotPlan,
  unlinkBidder,
} from "@/server/actions/watch";
import { useLive } from "./live-provider";
import { MoneyInput } from "./money-input";
import { StatusChip } from "./status-chip";

/** For a watched lot: my status, my max (with its all-in), my ABC bid, and "That's me". */
export function LotPlan({ lotId, rates }: { lotId: number; rates: FeeRates }) {
  const live = useLive();
  const l = live.data?.lots.find((x) => x.id === lotId);
  const [, start] = useTransition();
  if (!l || !live.data) return null;
  const linked = live.data.bidder.linked;
  const save = (field: "maxBid" | "myBid") => (cents: number | null) =>
    start(async () => {
      await setLotPlan({ lotId, [field]: cents });
      live.refresh();
    });

  return (
    <section aria-label="Your plan" className="rounded-2xl border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Your plan</h3>
        <StatusChip
          status={l.status}
          confidence={l.confidence}
          provisional={l.provisional}
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <MoneyInput
          label="Your max"
          value={l.maxBid}
          onSave={save("maxBid")}
          hint={
            l.maxBid !== null
              ? `${formatMoney(allIn(l.maxBid, rates))} all-in`
              : "Most you'll bid (hammer)"
          }
        />
        {!linked && (
          <MoneyInput
            label="Your bid on ABC"
            value={l.myBid}
            onSave={save("myBid")}
            hint="So Lotline can tell if you lead"
          />
        )}
      </div>
      {l.overMax && l.phase !== "final" && (
        <p className="mt-3 rounded-lg bg-outbid-bg px-3 py-2 text-sm text-outbid">
          The next bid, {formatMoney(l.nextBid)}, is over your max.
        </p>
      )}
      {l.phase !== "final" && l.currentBid !== null && !linked && (
        <ThatsMe lotId={lotId} />
      )}
      {linked && (
        <p className="mt-3 text-xs text-muted-foreground">
          Status is exact: your ABC bidder {live.data.bidder.masked} is linked.
        </p>
      )}
    </section>
  );
}

/**
 * Link your ABC bidder ID from a lot you just bid on: read the lot fresh, show the top bid and
 * the last two digits of the leader's bidder number, and link it if that's you (with Undo).
 */
function ThatsMe({ lotId }: { lotId: number }) {
  const live = useLive();
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [preview, setPreview] = useState<{
    masked: string;
    currentBid: number;
    observedAt: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const begin = () => {
    setOpen(true);
    setPreview(null);
    setError(null);
    start(async () => {
      const r = await previewBidderLink({ lotId });
      if (r.ok) setPreview(r);
      else setError(r.error);
    });
  };
  const confirm = () =>
    start(async () => {
      if (!preview) return;
      const r = await linkBidder({ lotId, masked: preview.masked });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      live.refresh();
      toast.success(
        `Linked bidder ${r.masked}: winning and outbid are exact now`,
        {
          duration: 30_000,
          action: {
            label: "Undo",
            onClick: () => void unlinkBidder().then(() => live.refresh()),
          },
        },
      );
    });

  return (
    <>
      <Button variant="outline" className="mt-3 w-full" onClick={begin}>
        <BadgeCheck /> I just bid on ABC: that's me
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Is the top bid yours?</DialogTitle>
          <DialogDescription>
            Linking your ABC bidder number makes winning and outbid exact on
            every lot you watch.
          </DialogDescription>
          {busy && !preview && !error && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Reading the lot from
              ABC…
            </p>
          )}
          {error && <p className="text-sm text-outbid">{error}</p>}
          {preview && (
            <div className="rounded-xl bg-muted p-4 text-sm">
              <p>
                ABC's top bid is{" "}
                <strong className="tabular-nums">
                  {formatMoney(preview.currentBid * 100)}
                </strong>
                , by bidder{" "}
                <strong className="font-mono">{preview.masked}</strong>.
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Read at {formatTime(new Date(preview.observedAt))}. Only link it
                if that bid is yours.
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={!preview || busy}>
              That's me
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
