"use client";

import { Search } from "lucide-react";
import { useDeferredValue, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatMoney } from "@/lib/domain/money";
import { formatWhen } from "@/lib/domain/time";
import type { CatalogueDoc } from "@/lib/search/engine";
import { addCandidatesAction } from "@/server/actions/projects";
import { useCatalogue } from "../catalogue/catalogue-provider";
import { Highlight, LotThumb } from "../lot/bits";

/**
 * Add many lots to a need at once: search the live catalogue, tick lots, add them as backups
 * in closing order (earliest first, so the backups roll forward through the evening).
 */
export function LotPicker({
  needId,
  needTitle,
  exclude,
  open,
  onOpenChange,
  onAdded,
}: {
  needId: string;
  needTitle: string;
  exclude: number[];
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAdded: () => void;
}) {
  const { engine } = useCatalogue();
  const [q, setQ] = useState(needTitle);
  const query = useDeferredValue(q);
  const [picked, setPicked] = useState<Map<number, CatalogueDoc>>(new Map());
  const [busy, start] = useTransition();
  const skip = useMemo(() => new Set(exclude), [exclude]);
  const hits = useMemo(
    () =>
      engine
        ? engine
            .search({ q: query, sort: query ? "relevance" : "ending" })
            .hits.filter((h) => !skip.has(h.doc.id))
            .slice(0, 60)
        : [],
    [engine, query, skip],
  );
  const toggle = (d: CatalogueDoc) =>
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(d.id)) n.delete(d.id);
      else n.set(d.id, d);
      return n;
    });
  const add = () =>
    start(async () => {
      const ordered = [...picked.values()]
        .sort((a, b) => (a.endAt ?? "9").localeCompare(b.endAt ?? "9"))
        .map((d) => d.id);
      const { added } = await addCandidatesAction({ needId, lotIds: ordered });
      toast.success(
        `Added ${added} ${added === 1 ? "lot" : "lots"} to ${needTitle} (and your watchlist)`,
      );
      setPicked(new Map());
      onOpenChange(false);
      onAdded();
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70dvh] max-w-2xl sm:max-h-[85dvh] flex-col gap-3">
        <DialogTitle>Add lots to {needTitle}</DialogTitle>
        <DialogDescription>
          Tick lots to add. They're added as backups in closing order, and
          watched.
        </DialogDescription>
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search lots to add"
            placeholder="Search lots"
            className="h-11 w-full rounded-xl border bg-background pr-3 pl-9 text-base outline-none focus:border-primary/60 focus:ring-3 focus:ring-primary/15"
          />
        </div>
        <ul
          className="-mx-2 min-h-0 flex-1 overflow-y-auto"
          aria-label="Lots to add"
        >
          {!engine && (
            <li className="p-3 text-sm text-muted-foreground">
              Loading the catalogue…
            </li>
          )}
          {engine && hits.length === 0 && (
            <li className="p-3 text-sm text-muted-foreground">
              No open lots match.
            </li>
          )}
          {hits.map((h) => {
            const d = h.doc;
            const id = `pick-${d.id}`;
            return (
              <li key={d.id}>
                <label
                  htmlFor={id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                >
                  <Checkbox
                    id={id}
                    checked={picked.has(d.id)}
                    onCheckedChange={() => toggle(d)}
                  />
                  <LotThumb src={d.thumbUrl} alt="" size={48} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      <Highlight title={d.title} matched={h.matched} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[
                        d.location,
                        d.auction,
                        d.endAt
                          ? `closes ${formatWhen(Date.parse(d.endAt))}`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {formatMoney(d.startingBid ?? d.currentBid)}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {picked.size} selected
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={add} disabled={!picked.size || busy}>
              Add {picked.size || ""} {picked.size === 1 ? "lot" : "lots"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
