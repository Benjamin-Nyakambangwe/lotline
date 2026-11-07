"use client";

import { Maximize2, X } from "lucide-react";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCatalogue } from "../catalogue/catalogue-provider";
import { LotDetail } from "./lot-detail";
import { useLot } from "./use-lot";

const WIDE = "(min-width: 1280px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** Sets a CSS variable on <html> so the page can make room for the panel or sheet. */
function useRoomVar(name: string, value: string | null) {
  useEffect(() => {
    if (value === null) return;
    document.documentElement.style.setProperty(name, value);
    return () => {
      document.documentElement.style.removeProperty(name);
    };
  }, [name, value]);
}

/**
 * Opens any lot over the current page via `?lot=ID`: a docked panel on wide screens, a
 * non-modal bottom sheet elsewhere. Back (or Escape) closes it.
 */
export function LotOverlay() {
  const [lotId, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const wide = useWide();
  const close = useCallback(() => void setLot(null), [setLot]);

  useEffect(() => {
    if (!lotId) return;
    const onKey = (e: KeyboardEvent) => {
      if (
        e.key === "Escape" &&
        !document.querySelector("[role=dialog][data-state=open]")
      )
        close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lotId, close]);

  if (!lotId) return null;
  return wide ? (
    <Panel id={lotId} onClose={close} />
  ) : (
    <Sheet id={lotId} onClose={close} />
  );
}

function Body({ id, onClose }: { id: number; onClose: () => void }) {
  const { engine } = useCatalogue();
  const q = useLot(id);
  const doc = engine?.get(id) ?? null;
  const run = engine?.runs.get(id) ?? null;
  const notFound = q.data && !q.data.lot && !q.data.refreshing;
  const closeRef = useRef<HTMLButtonElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: move focus when a different lot opens
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), [id]);

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b bg-background/95 px-4 py-2 backdrop-blur">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/lots/${id}`}>
            <Maximize2 /> Open full page
          </Link>
        </Button>
        <Button
          ref={closeRef}
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close lot"
        >
          <X />
        </Button>
      </div>
      <div className="p-4">
        {notFound ? (
          <p className="text-sm text-muted-foreground">
            We couldn’t find lot {id}. It may have been withdrawn.
          </p>
        ) : (
          <LotDetail
            lot={q.data?.lot ?? null}
            basic={doc}
            run={run}
            refreshing={!!q.data?.refreshing}
            compact
          />
        )}
      </div>
    </>
  );
}

function Panel({ id, onClose }: { id: number; onClose: () => void }) {
  useRoomVar("--panel-w", "460px");
  return (
    <aside
      aria-label="Lot details"
      className="fixed top-0 right-0 z-30 h-dvh w-[460px] overflow-y-auto border-l bg-background shadow-2xl shadow-black/20"
    >
      <Body id={id} onClose={onClose} />
    </aside>
  );
}

/** Non-modal bottom sheet: snaps to 45% or 70% of the screen and never covers it all. */
function Sheet({ id, onClose }: { id: number; onClose: () => void }) {
  const [snap, setSnap] = useState<"half" | "full">("half");
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const base = (snap === "full" ? 0.7 : 0.45) * vh;
  const height = Math.max(0.25 * vh, Math.min(0.7 * vh, base - drag));
  useRoomVar("--sheet-h", `${Math.round(height)}px`);

  const onDown = (e: React.PointerEvent) => {
    start.current = e.clientY;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (start.current !== null) setDrag(e.clientY - start.current);
  };
  const onUp = () => {
    if (start.current === null) return;
    const d = drag;
    start.current = null;
    setDrag(0);
    if (Math.abs(d) < 6) setSnap((s) => (s === "half" ? "full" : "half"));
    else if (d < -50) setSnap("full");
    else if (d > 90) {
      if (snap === "full") setSnap("half");
      else onClose();
    }
  };

  return (
    <section
      aria-label="Lot details"
      className={cn(
        "fixed inset-x-0 z-50 flex flex-col rounded-t-2xl border-t bg-background shadow-[0_-12px_40px_-12px_rgb(0_0_0/0.45)]",
        "bottom-[calc(3.5rem+env(safe-area-inset-bottom))] lg:bottom-0",
        start.current === null &&
          "transition-[height] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{ height, maxHeight: "70dvh" }}
    >
      <button
        type="button"
        aria-label={
          snap === "half" ? "Expand lot details" : "Shrink lot details"
        }
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="flex h-6 shrink-0 cursor-grab touch-none items-center justify-center"
      >
        <span className="h-1.5 w-10 rounded-full bg-muted-foreground/40" />
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <Body id={id} onClose={onClose} />
      </div>
    </section>
  );
}
