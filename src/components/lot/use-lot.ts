"use client";

import { useQuery } from "@tanstack/react-query";
import type { LotResponse, LotView } from "@/lib/lot-view";
import { syncServerTime } from "../time/ticker";

async function fetchLot(id: number): Promise<LotResponse> {
  const res = await fetch(`/api/lots/${id}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("signed out");
  const body = (await res.json()) as LotResponse;
  syncServerTime(body.now);
  return body;
}

/**
 * One lot, kept fresh: while the worker is fetching new data we poll every 2 s; an open lot
 * refreshes every 30 s (the live board in M5 polls faster for lots you're bidding on).
 */
export function useLot(id: number | null, initial?: LotView | null) {
  return useQuery({
    queryKey: ["lot", id],
    queryFn: () => fetchLot(id as number),
    enabled: id !== null,
    initialData: initial
      ? { now: new Date().toISOString(), lot: initial, refreshing: false }
      : undefined,
    initialDataUpdatedAt: initial ? 0 : undefined,
    refetchInterval: (q) => {
      const d = q.state.data;
      if (!d) return false;
      if (d.refreshing) return 2_000;
      return d.lot && d.lot.finalState !== "final" ? 30_000 : false;
    },
  });
}
