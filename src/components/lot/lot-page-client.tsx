"use client";

import type { LotView } from "@/lib/lot-view";
import { useCatalogue } from "../catalogue/catalogue-provider";
import { LotDetail } from "./lot-detail";
import { useLot } from "./use-lot";

/** Full-page lot view: server-rendered first, then kept fresh like the panel. */
export function LotPageClient({
  id,
  initial,
}: {
  id: number;
  initial: LotView | null;
}) {
  const { engine } = useCatalogue();
  const q = useLot(id, initial);
  const lot = q.data?.lot ?? initial;
  if (!lot && q.data && !q.data.refreshing) {
    return (
      <p className="text-muted-foreground">
        We couldn’t find lot {id}. It may have been withdrawn.
      </p>
    );
  }
  return (
    <LotDetail
      lot={lot}
      basic={engine?.get(id) ?? null}
      run={engine?.runs.get(id) ?? null}
      refreshing={!!q.data?.refreshing}
    />
  );
}
