"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CatalogueResponse } from "@/lib/lot-view";
import { CatalogueSearch } from "@/lib/search/engine";
import { syncServerTime } from "../time/ticker";

interface CatalogueState {
  engine: CatalogueSearch | null;
  data: CatalogueResponse | null;
  loading: boolean;
  error: boolean;
  /** milliseconds the last index build took, for the curious */
  buildMs: number | null;
  load: () => void;
}

const Ctx = createContext<CatalogueState | null>(null);

async function fetchCatalogue(): Promise<CatalogueResponse> {
  const res = await fetch("/api/catalogue", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`catalogue ${res.status}`);
  return res.json();
}

/**
 * Holds the in-browser search index. Nothing downloads until a page (Browse) or the ⌘K
 * palette asks for it; after that it stays warm and refreshes every few minutes.
 */
export function CatalogueProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false);
  const q = useQuery({
    queryKey: ["catalogue"],
    queryFn: fetchCatalogue,
    enabled,
    staleTime: 4 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (q.data) syncServerTime(q.data.now);
  }, [q.data]);

  const built = useMemo(() => {
    if (!q.data) return { engine: null, ms: null };
    const t0 = performance.now();
    const engine = new CatalogueSearch(q.data.lots, "Africa/Harare");
    return { engine, ms: Math.round(performance.now() - t0) };
  }, [q.data]);

  const value = useMemo<CatalogueState>(
    () => ({
      engine: built.engine,
      data: q.data ?? null,
      loading: enabled && q.isPending,
      error: q.isError,
      buildMs: built.ms,
      load: () => setEnabled(true),
    }),
    [built, q.data, q.isPending, q.isError, enabled],
  );

  return <Ctx value={value}>{children}</Ctx>;
}

/** Use the catalogue; asks for it to be loaded on first use. */
export function useCatalogue(): CatalogueState {
  const ctx = use(Ctx);
  if (!ctx)
    throw new Error("useCatalogue must be used inside CatalogueProvider");
  const { load } = ctx;
  useEffect(() => load(), [load]);
  return ctx;
}
