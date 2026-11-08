"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { toast } from "sonner";
import type { LiveResponse } from "@/lib/live-view";
import { syncServerTime } from "../time/ticker";

const KEY = ["live"] as const;

/** Poll faster as watched lots near their close; pause while the tab is hidden. */
function intervalFor(data: LiveResponse | undefined): number {
  if (!data) return 15_000;
  const now = Date.now();
  let soonest = Number.POSITIVE_INFINITY;
  for (const l of data.lots) {
    if (l.phase === "closing") return 2_000;
    if (l.phase === "open" && l.endAt)
      soonest = Math.min(soonest, Date.parse(l.endAt) - now);
  }
  if (soonest <= 10 * 60_000) return 2_000;
  if (soonest <= 60 * 60_000) return 5_000;
  return data.lots.length ? 15_000 : 30_000;
}

const SOUND_KEY = "lotline.sound";
export const soundOn = () => {
  try {
    return localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
};
export const setSoundOn = (on: boolean) => {
  try {
    localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // not remembered
  }
};

let audio: AudioContext | null = null;
/** A short two-tone alert. Browsers allow sound only after a tap, so the toggle unlocks it. */
export function beep() {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const t = audio.currentTime;
    for (const [i, f] of [880, 660].entries()) {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
      o.connect(g).connect(audio.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.17);
    }
  } catch {
    // no audio
  }
}

interface LiveContext {
  data: LiveResponse | undefined;
  watched: Set<number>;
  /** optimistic: reflect a watch change before the server confirms */
  setWatched: (lotId: number, on: boolean) => void;
  refresh: () => void;
}
const Ctx = createContext<LiveContext | null>(null);

export function useLive() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useLive outside LiveProvider");
  return c;
}

/**
 * The live connection for the whole app: polls /api/live (faster near closes), keeps the
 * server clock in sync, and turns new alerts into toasts (plus a sound and a buzz for outbid,
 * when switched on). Also badges the tab title with how many lots you're outbid on.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  // Read the URL only when a toast's "Open" is tapped: reading it while rendering would need
  // a Suspense boundary around the whole app.
  const openLot = useCallback(
    (id: number) => {
      const u = new URL(window.location.href);
      u.searchParams.set("lot", String(id));
      router.push(`${u.pathname}${u.search}`);
    },
    [router],
  );
  const { data } = useQuery<LiveResponse>({
    queryKey: KEY,
    queryFn: async () => {
      const r = await fetch("/api/live", { cache: "no-store" });
      if (!r.ok) throw new Error(`live ${r.status}`);
      return r.json();
    },
    refetchInterval: (q) => intervalFor(q.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 1_000,
  });

  useEffect(() => {
    if (data) syncServerTime(data.now);
  }, [data]);

  // Toast alerts newer than the newest one we'd already seen when the app loaded.
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!data) return;
    const newest = data.alerts[0]?.id ?? 0;
    if (seen.current === null) {
      seen.current = newest;
      return;
    }
    const fresh = data.alerts
      .filter((a) => a.id > (seen.current ?? 0))
      .reverse();
    seen.current = Math.max(seen.current, newest);
    for (const a of fresh.slice(-3)) {
      const urgent = a.kind === "outbid";
      (urgent ? toast.error : a.kind === "won" ? toast.success : toast)(
        a.title,
        {
          description: a.body ?? undefined,
          duration: urgent ? 15_000 : 8_000,
          action: a.lotId
            ? { label: "Open", onClick: () => openLot(a.lotId as number) }
            : undefined,
        },
      );
      if (urgent) {
        if (soundOn()) beep();
        navigator.vibrate?.([120, 60, 120]);
      }
    }
  }, [data, openLot]);

  const outbid =
    data?.lots.filter((l) => l.status === "outbid" && l.phase !== "final")
      .length ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = outbid ? `(${outbid}) ${base}` : base;
  }, [outbid]);

  const value = useMemo<LiveContext>(
    () => ({
      data,
      watched: new Set(data?.lots.map((l) => l.id)),
      setWatched: (lotId, on) =>
        qc.setQueryData<LiveResponse>(KEY, (d) =>
          d && !on ? { ...d, lots: d.lots.filter((l) => l.id !== lotId) } : d,
        ),
      refresh: () => void qc.invalidateQueries({ queryKey: KEY }),
    }),
    [data, qc],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Refresh the live data now (after a change), from anywhere. */
export function useRefreshLive() {
  const qc = useQueryClient();
  return useCallback(() => void qc.invalidateQueries({ queryKey: KEY }), [qc]);
}
