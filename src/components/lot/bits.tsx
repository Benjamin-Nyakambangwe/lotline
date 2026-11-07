"use client";

import { ImageOff, Layers, RefreshCw, Timer } from "lucide-react";
import Image from "next/image";
import { allIn, DEFAULT_RATES, type FeeRates } from "@/lib/domain/fees";
import { formatMoney } from "@/lib/domain/money";
import { formatClock, formatCountdown } from "@/lib/domain/time";
import { highlightParts } from "@/lib/search/engine";
import type { RunInfo } from "@/lib/search/runs";
import { cn } from "@/lib/utils";
import { useNow } from "../time/ticker";

export const ratesOf = (
  r: [number, number, number] | null | undefined,
): FeeRates =>
  r ? { levy: r[0], vat: r[1], lotVat: r[2], estimated: false } : DEFAULT_RATES;

/** "$72.13" all-in for a hammer price, with an "est." marker when rates are defaults. */
export function AllIn({
  hammer,
  rates,
  className,
}: {
  hammer: number | null;
  rates: FeeRates;
  className?: string;
}) {
  if (hammer === null) return null;
  return (
    <span className={cn("tabular-nums", className)}>
      {formatMoney(allIn(hammer, rates))}
      {rates.estimated && (
        <span className="ml-0.5 text-[0.85em] text-muted-foreground">
          {" "}
          est.
        </span>
      )}
    </span>
  );
}

/** Live countdown. Amber under 10 minutes, red under 2; "Closing…" past the end until final. */
export function Countdown({
  endAt,
  final = false,
  className,
  showClock = false,
}: {
  endAt: string | null;
  final?: boolean;
  className?: string;
  showClock?: boolean;
}) {
  const now = useNow();
  if (!endAt) return null;
  const end = Date.parse(endAt);
  const left = end - (now || Date.now());
  const tone = final
    ? "text-muted-foreground"
    : left <= 0
      ? "text-closing"
      : left < 120_000
        ? "text-outbid"
        : left < 600_000
          ? "text-closing"
          : "";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        tone,
        className,
      )}
    >
      <Timer className="size-[1em] shrink-0" aria-hidden="true" />
      {final
        ? "Closed"
        : left <= 0
          ? "Closing…"
          : now
            ? formatCountdown(left)
            : "–:––"}
      {showClock && (
        <span className="text-muted-foreground">· {formatClock(end)}</span>
      )}
    </span>
  );
}

export function LotThumb({
  src,
  alt,
  size = 72,
  className,
}: {
  src: string | null;
  alt: string;
  size?: number;
  className?: string;
}) {
  if (!src) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
          className,
        )}
        style={{ width: size, height: Math.round(size * 0.75) }}
      >
        <ImageOff className="size-4" aria-hidden="true" />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt}
      width={size}
      height={Math.round(size * 0.75)}
      quality={60}
      sizes={`${size}px`}
      className={cn("shrink-0 rounded-lg bg-muted object-cover", className)}
      style={{ width: size, height: Math.round(size * 0.75) }}
    />
  );
}

export function Highlight({
  title,
  matched,
}: {
  title: string;
  matched: Set<string>;
}) {
  return (
    <>
      {highlightParts(title, matched).map((p) =>
        p.hit ? (
          <mark
            key={p.start}
            className="rounded-sm bg-primary/20 px-0.5 text-foreground"
          >
            {p.text}
          </mark>
        ) : (
          <span key={p.start}>{p.text}</span>
        ),
      )}
    </>
  );
}

/** "#3 of 6 tonight": position in a run of near-identical lots closing the same day. */
export function RunBadge({
  run,
  className,
}: {
  run: RunInfo;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-chart-1/15 px-2 py-0.5 text-xs font-medium text-chart-1",
        className,
      )}
      title={`${run.after} more like this close after it`}
    >
      <Layers className="size-3" aria-hidden="true" />#{run.position} of{" "}
      {run.size}
    </span>
  );
}

export function ExtendedChip({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-extended-bg px-2 py-0.5 text-xs font-medium text-extended",
        className,
      )}
    >
      <RefreshCw className="size-3" aria-hidden="true" />
      Extended
    </span>
  );
}
