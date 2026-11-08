"use client";

import { ImageOff, Layers, RefreshCw, Timer } from "lucide-react";
import Image from "next/image";
import { allIn, DEFAULT_RATES, type FeeRates } from "@/lib/domain/fees";
import { formatMoney } from "@/lib/domain/money";
import { formatClock, formatCountdown, formatWhen } from "@/lib/domain/time";
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

/** Tone for time left: amber under 10 minutes, red under 2, amber again once past the end. */
function toneFor(left: number, final: boolean) {
  if (final) return "muted";
  if (left <= 0) return "closing";
  if (left < 120_000) return "outbid";
  if (left < 600_000) return "closing";
  return "normal";
}
const TEXT_TONE = {
  muted: "text-muted-foreground",
  closing: "text-closing",
  outbid: "text-outbid",
  normal: "",
} as const;
const PILL_TONE = {
  muted: "bg-muted text-muted-foreground",
  closing: "bg-closing-bg text-closing",
  outbid: "bg-outbid-bg text-outbid",
  normal: "bg-muted text-foreground",
} as const;

/**
 * Live countdown that ticks every second. Amber under 10 minutes, red under 2; "Closing…" past
 * the end until final. `pill` for cards, `seconds` to tick visibly even days out, `showWhen`
 * adds "today 19:03" underneath.
 */
export function Countdown({
  endAt,
  final = false,
  className,
  showClock = false,
  showWhen = false,
  seconds = false,
  variant = "plain",
}: {
  endAt: string | null;
  final?: boolean;
  className?: string;
  showClock?: boolean;
  showWhen?: boolean;
  seconds?: boolean;
  variant?: "plain" | "pill";
}) {
  const now = useNow();
  if (!endAt) return null;
  const end = Date.parse(endAt);
  const left = end - (now || Date.now());
  const tone = toneFor(left, final);
  const timer = (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        variant === "pill"
          ? cn("rounded-full px-2 py-0.5 font-semibold", PILL_TONE[tone])
          : TEXT_TONE[tone],
        !showWhen && className,
      )}
      role="timer"
      aria-label={
        final ? "Closed" : left <= 0 ? "Closing" : `Closes ${formatWhen(end)}`
      }
    >
      <Timer className="size-[1em] shrink-0" aria-hidden="true" />
      {final
        ? "Closed"
        : left <= 0
          ? "Closing…"
          : now
            ? formatCountdown(left, { seconds })
            : "–:––"}
      {showClock && (
        <span className="font-normal text-muted-foreground">
          · {formatClock(end)}
        </span>
      )}
    </span>
  );
  if (!showWhen) return timer;
  return (
    <span className={cn("inline-flex flex-col items-end gap-0.5", className)}>
      {timer}
      <span className="text-[0.75rem] text-muted-foreground tabular-nums">
        {final
          ? formatWhen(end, now || Date.now())
          : `closes ${formatWhen(end, now || Date.now())}`}
      </span>
    </span>
  );
}

/** A big, always-ticking timer for an auction or the lot page: label, digits, and when. */
export function BigCountdown({
  endAt,
  label,
  className,
}: {
  endAt: string | null;
  label: string;
  className?: string;
}) {
  const now = useNow();
  if (!endAt) return null;
  const end = Date.parse(endAt);
  const left = end - (now || Date.now());
  const tone = toneFor(left, false);
  return (
    <div className={cn("flex flex-col", className)} role="timer">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-2xl leading-tight font-semibold tracking-tight tabular-nums",
          TEXT_TONE[tone],
        )}
      >
        {left <= 0
          ? "Closing now"
          : now
            ? formatCountdown(left, { seconds: true })
            : "–:––:––"}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatWhen(end, now || Date.now())}
      </span>
    </div>
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
