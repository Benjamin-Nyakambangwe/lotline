"use client";

import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Gavel,
  Images,
  Info,
  Layers,
  MapPin,
  Package,
  Sparkles,
  Truck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { lotUrl } from "@/lib/abc/urls";
import {
  allIn,
  type FeeRates,
  feeBreakdown,
  maxHammerFor,
} from "@/lib/domain/fees";
import { formatMoney, parseCents } from "@/lib/domain/money";
import { formatClock, formatTime } from "@/lib/domain/time";
import type { LotView } from "@/lib/lot-view";
import type { CatalogueDoc } from "@/lib/search/engine";
import type { RunInfo } from "@/lib/search/runs";
import { cn } from "@/lib/utils";
import {
  AllIn,
  BigCountdown,
  Countdown,
  ExtendedChip,
  LotThumb,
  RunBadge,
  ratesOf,
} from "./bits";

/** Fields we can show before the detail arrives (from the in-browser catalogue). */
type Basic = Pick<
  CatalogueDoc,
  | "id"
  | "type"
  | "title"
  | "location"
  | "condition"
  | "currentBid"
  | "startingBid"
  | "endAt"
  | "stc"
> & {
  lotNumber?: number | null;
  photoUrl?: string | null;
  thumbUrl?: string | null;
};

export function LotDetail({
  lot,
  basic,
  run,
  refreshing,
  compact = false,
}: {
  lot: LotView | null;
  basic: Basic | null;
  run: RunInfo | null;
  refreshing: boolean;
  compact?: boolean;
}) {
  const b = lot ?? basic;
  if (!b) return <DetailSkeleton />;
  const rates: FeeRates = lot
    ? lot.rates
    : ratesOf((basic as CatalogueDoc | null)?.rates);
  const final = lot ? lot.finalState === "final" : false;
  const extended = lot
    ? !!lot.endAt && !!lot.originalEndAt && lot.endAt > lot.originalEndAt
    : !!(basic as CatalogueDoc | null)?.extended;
  const next = b.startingBid;
  const photo = lot?.photoUrl ?? basic?.photoUrl ?? basic?.thumbUrl ?? null;

  return (
    <article className="flex flex-col gap-5">
      <header className="flex gap-3">
        {compact && <LotThumb src={photo} alt="" size={72} />}
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            Lot {b.id}
            {b.lotNumber ? ` · #${b.lotNumber}` : ""}
          </p>
          <h2
            className={cn(
              "mt-0.5 font-semibold tracking-tight",
              compact ? "text-lg leading-snug" : "text-2xl sm:text-3xl",
            )}
          >
            {b.title}
          </h2>
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {b.location && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5">
                <MapPin className="size-3" aria-hidden="true" />
                {b.location}
              </span>
            )}
            {lot?.auction && (
              <Link
                href={`/browse?auction=${encodeURIComponent(lot.auction.key)}&sort=ending`}
                className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-primary hover:bg-primary/20"
                title={`See every lot in ${lot.auction.title}`}
              >
                <Gavel className="size-3" aria-hidden="true" />
                {lot.auction.code ?? lot.auction.title}
              </Link>
            )}
            {lot?.condition && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                {lot.condition}
              </span>
            )}
            {lot?.state && lot.state !== lot.condition && (
              <span className="rounded-full bg-muted px-2 py-0.5">
                {lot.state}
              </span>
            )}
            {lot?.cpu && (
              <span className="rounded-full bg-win-bg px-2 py-0.5 text-win">
                {lot.cpu}
              </span>
            )}
            {b.stc && (
              <span className="rounded-full bg-closing-bg px-2 py-0.5 text-closing">
                Subject to confirmation
              </span>
            )}
          </div>
          {lot?.categoryPath && (
            <p className="mt-2 text-xs text-muted-foreground">
              {lot.categoryPath}
            </p>
          )}
        </div>
      </header>

      <section
        aria-label="Price and time"
        className="rounded-2xl border bg-surface-2/60 p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          {final ? (
            <Countdown
              endAt={b.endAt}
              final
              showClock
              className="text-base font-semibold"
            />
          ) : (
            <BigCountdown endAt={b.endAt} label="Closes in" />
          )}
          <div className="flex gap-1.5">
            {extended && <ExtendedChip />}
            {run && <RunBadge run={run} />}
          </div>
        </div>
        {final ? (
          <p className="mt-3 text-sm">
            {lot?.finalPrice !== null && lot?.finalPrice !== undefined ? (
              <>
                Sold for{" "}
                <strong className="tabular-nums">
                  {formatMoney(lot.finalPrice)}
                </strong>{" "}
                (
                <AllIn hammer={lot.finalPrice} rates={rates} /> all-in)
                {lot.closedAt
                  ? ` · closed ${formatClock(Date.parse(lot.closedAt))}`
                  : ""}
              </>
            ) : (
              "Closed with no bids."
            )}
          </p>
        ) : (
          <dl className="mt-3 grid grid-cols-3 gap-2">
            <Stat
              label={b.currentBid === null ? "No bids yet" : "Current bid"}
              value={formatMoney(b.currentBid)}
            />
            <Stat
              label={b.currentBid === null ? "Opening bid" : "Next bid"}
              value={formatMoney(next)}
            />
            <Stat
              label="All-in at next"
              value={
                next === null ? "–" : <AllIn hammer={next} rates={rates} />
              }
              strong
            />
          </dl>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild size="lg" className="h-11 flex-1">
            <a
              href={lotUrl(b.id, b.type)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Bid on ABC <ExternalLink />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline" className="h-11">
            <Link
              aria-label="Ask Lotline about this lot"
              href={`/assistant?q=${encodeURIComponent(`Is lot ${b.id} (${b.title}) worth bidding on? What should my max be?`)}`}
            >
              <Sparkles /> Ask
            </Link>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {refreshing
            ? "Refreshing from ABC…"
            : lot?.priceObservedAt
              ? `Prices from ${formatTime(new Date(lot.priceObservedAt))}`
              : " "}
        </p>
      </section>

      {run && run.size >= 3 && !final && (
        <section className="flex gap-3 rounded-2xl border border-chart-1/30 bg-chart-1/8 p-4 text-sm">
          <Layers
            className="mt-0.5 size-4 shrink-0 text-chart-1"
            aria-hidden="true"
          />
          <p>
            <strong>
              #{run.position} of {run.size}
            </strong>{" "}
            similar lots closing the same day.{" "}
            {run.after > 0
              ? `${run.after} more close after this one. Prices often rise toward the end of a run as people who lost earlier lots move on.`
              : "This is the last one in the run: expect competition from everyone who lost the earlier ones."}
          </p>
        </section>
      )}

      {!final && next !== null && <FeeCalculator next={next} rates={rates} />}

      {lot && lot.gallery.length > 0 && <Gallery lot={lot} />}

      {lot?.descriptionHtml && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">
            Description
          </h3>
          <div
            className="prose-sm max-w-none text-sm leading-relaxed text-text-2 [&_li]:ml-4 [&_li]:list-disc [&_p]:mb-2"
            // Sanitised on ingest by the worker (simple formatting tags only, no attributes).
            // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised server-side with sanitize-html
            dangerouslySetInnerHTML={{ __html: lot.descriptionHtml }}
          />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {lot.quantityText && (
              <>
                <dt>Quantity</dt>
                <dd className="text-foreground">{lot.quantityText}</dd>
              </>
            )}
            {lot.size && (
              <>
                <dt>Size</dt>
                <dd className="text-foreground">{lot.size}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {lot?.viewing && (
        <section className="rounded-2xl border p-4 text-sm">
          <h3 className="mb-2 flex items-center gap-2 font-semibold">
            <Package
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Viewing and collection
          </h3>
          <p>{lot.viewing.title}</p>
          {lot.viewing.subtitle && (
            <p className="text-muted-foreground">{lot.viewing.subtitle}</p>
          )}
          {lot.viewing.descriptionHtml && (
            <div
              className="mt-2 text-xs text-muted-foreground [&_br]:mb-1"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitised server-side with sanitize-html
              dangerouslySetInnerHTML={{ __html: lot.viewing.descriptionHtml }}
            />
          )}
          {lot.offerWindowEndAt && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
              ABC’s offer window for this lot ends{" "}
              {formatClock(Date.parse(lot.offerWindowEndAt))}.
            </p>
          )}
        </section>
      )}

      {lot && lot.destinations.filter((d) => (d.price ?? 0) > 0).length > 0 && (
        <details className="rounded-2xl border p-4 text-sm">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <Truck
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            Delivery options
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            {lot.destinations
              .filter((d) => (d.price ?? 0) > 0)
              .map((d) => (
                <li
                  key={`${d.id}-${d.title}`}
                  className="flex justify-between gap-2"
                >
                  <span>{d.title}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatMoney(d.price)}
                    {d.tax ? ` + ${Math.round(d.tax * 1000) / 10}% tax` : ""}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}

      {!lot && <DetailSkeleton />}
    </article>
  );
}

function Stat({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl bg-background/70 p-3">
      <dt className="truncate text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 truncate font-semibold tabular-nums",
          strong ? "text-lg text-primary" : "text-lg",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Two-way calculator: what a bid costs all-in, and the biggest bid that fits an all-in budget. */
function FeeCalculator({ next, rates }: { next: number; rates: FeeRates }) {
  const [bid, setBid] = useState(String(next / 100));
  const [budget, setBudget] = useState("");
  const bidCents = parseCents(bid.replace(/[$,\s]/g, ""));
  const budgetCents = parseCents(budget.replace(/[$,\s]/g, ""));
  const breakdown = bidCents ? feeBreakdown(bidCents, rates) : null;
  const fit = budgetCents ? maxHammerFor(budgetCents, rates) : null;
  const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;

  return (
    <section className="rounded-2xl border p-4">
      <h3 className="text-sm font-semibold">Fees</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {pct(rates.levy)} purchaser’s levy, plus {pct(rates.vat)} VAT on the
        levy
        {rates.lotVat ? `, plus ${pct(rates.lotVat)} VAT on the lot` : ""}
        {rates.estimated
          ? " (standard rates; this lot’s details are still loading)"
          : ""}
        .
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-xs text-muted-foreground">
          If I bid
          <span className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              inputMode="decimal"
              enterKeyHint="done"
              value={bid}
              onChange={(e) => setBid(e.target.value)}
              className="h-11 w-full rounded-lg border bg-background pl-6 text-base text-foreground tabular-nums outline-none focus:border-primary"
            />
          </span>
          {breakdown && (
            <span>
              costs{" "}
              <strong className="text-foreground tabular-nums">
                {formatMoney(breakdown.allIn)}
              </strong>{" "}
              all-in (levy {formatMoney(breakdown.levy)} + VAT{" "}
              {formatMoney(breakdown.levyVat + breakdown.lotVat)})
            </span>
          )}
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">
          My all-in budget
          <span className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
              $
            </span>
            <input
              inputMode="decimal"
              enterKeyHint="done"
              value={budget}
              placeholder="e.g. 60"
              onChange={(e) => setBudget(e.target.value)}
              className="h-11 w-full rounded-lg border bg-background pl-6 text-base text-foreground tabular-nums outline-none focus:border-primary"
            />
          </span>
          {fit && (
            <span>
              bid up to{" "}
              <strong className="text-foreground tabular-nums">
                {formatMoney(fit.hammer)}
              </strong>{" "}
              ({formatMoney(fit.allIn)} all-in); {formatMoney(fit.next.hammer)}{" "}
              would be {formatMoney(fit.next.allIn)}
            </span>
          )}
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        At the next bid: {formatMoney(next)} → {formatMoney(allIn(next, rates))}{" "}
        all-in.
      </p>
    </section>
  );
}

/** Photos on demand: one small image, and the full gallery only when asked for. */
function Gallery({ lot }: { lot: LotView }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const items = lot.gallery;
  const cur = items[i];
  const go = (d: number) => setI((x) => (x + d + items.length) % items.length);
  const first = useMemo(
    () => items[0]?.thumb ?? items[0]?.zoom ?? null,
    [items],
  );
  return (
    <section>
      <button
        type="button"
        onClick={() => {
          setI(0);
          setOpen(true);
        }}
        className="group flex w-full items-center gap-3 rounded-2xl border p-3 text-left hover:bg-surface-2"
      >
        <LotThumb src={first} alt="" size={96} />
        <span className="flex-1">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Images
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            View {items.length} photo{items.length === 1 ? "" : "s"}
          </span>
          <span className="text-xs text-muted-foreground">
            Loads full-size images only when you open them.
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-4xl gap-3 p-3 sm:p-4"
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <DialogTitle className="pr-8 text-sm">
            {lot.title} · {i + 1} of {items.length}
          </DialogTitle>
          {cur && (
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-black">
              <Image
                src={cur.zoom}
                alt={`${lot.title}, photo ${i + 1}`}
                fill
                sizes="(max-width: 900px) 100vw, 900px"
                quality={75}
                className="object-contain"
              />
            </div>
          )}
          {items.length > 1 && (
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="lg"
                onClick={() => go(-1)}
                aria-label="Previous photo"
              >
                <ChevronLeft />
              </Button>
              <span className="text-sm text-muted-foreground tabular-nums">
                {i + 1} / {items.length}
              </span>
              <Button
                variant="outline"
                size="lg"
                onClick={() => go(1)}
                aria-label="Next photo"
              >
                <ChevronRight />
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function DetailSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-3">
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}
