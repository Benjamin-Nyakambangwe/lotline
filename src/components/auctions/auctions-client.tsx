"use client";

import {
  CalendarClock,
  ExternalLink,
  Gavel,
  History,
  MapPin,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/domain/money";
import { formatWhen, localDate } from "@/lib/domain/time";
import { cn } from "@/lib/utils";
import type { AuctionView } from "@/server/auctions";
import { LocationSwitch, readLocationPref } from "../location/location-switch";
import { useNow } from "../time/ticker";

type Phase = "closing" | "upcoming" | "closed";

/** Phase from the clock, so cards move on their own as auctions start closing. */
function phaseAt(a: AuctionView, now: number): Phase {
  const first = a.firstEnd ? Date.parse(a.firstEnd) : null;
  const last = a.lastEnd ? Date.parse(a.lastEnd) : null;
  if (!first || now < first) return "upcoming";
  // Soft-close extensions can run past the last scheduled end: allow 15 minutes.
  if ((last && now < last + 15 * 60_000) || a.open > 0) return "closing";
  return "closed";
}

const at = (iso: string) => Date.parse(iso);
const time = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Harare",
  }).format(new Date(iso));

/** ABC's own page for an auction's lots (sold lots stay there for about two weeks). */
const abcLink = (name: string) =>
  `https://app.abcauctions.co.zw/search?sort=2&facets=${encodeURIComponent(JSON.stringify({ campaign: [name] }))}`;

export function AuctionsClient({ auctions }: { auctions: AuctionView[] }) {
  const router = useRouter();
  const ticked = useNow();
  const now = ticked || Date.now();
  const [location, setLocation] = useState<string | null>(null);
  useEffect(() => setLocation(readLocationPref()), []);
  const [showClosed, setShowClosed] = useQueryState(
    "closed",
    parseAsBoolean.withDefault(false),
  );

  // Lot counts change as lots close: refresh from the server every minute while visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  const here = (a: AuctionView) =>
    !location || (a.location ?? "").split(" & ").includes(location);
  const counts = new Map<string, number>();
  for (const a of auctions)
    if (phaseAt(a, now) !== "closed")
      for (const l of (a.location ?? "").split(" & ").filter(Boolean))
        counts.set(l, (counts.get(l) ?? 0) + 1);
  const shown = auctions.filter(here);
  const closed = shown.filter((a) => phaseAt(a, now) === "closed");

  const today = localDate(now);
  const groups: { title: string; items: AuctionView[] }[] = [
    {
      title: "Closing now",
      items: shown.filter((a) => phaseAt(a, now) === "closing"),
    },
    {
      title: "Closing today",
      items: shown.filter(
        (a) =>
          phaseAt(a, now) === "upcoming" &&
          !!a.firstEnd &&
          localDate(at(a.firstEnd)) === today,
      ),
    },
    {
      title: "Coming up",
      items: shown.filter(
        (a) =>
          phaseAt(a, now) === "upcoming" &&
          !(a.firstEnd && localDate(at(a.firstEnd)) === today),
      ),
    },
    ...(showClosed
      ? [{ title: "Closed in the last 30 days", items: closed }]
      : []),
  ];
  const any = groups.some((g) => g.items.length);

  return (
    <div>
      <PageHeader
        title="Auctions"
        description="Every ABC auction with lots on sale. An auction's lots close one after another, about 20 seconds apart. Times are in Harare."
        actions={
          <LocationSwitch
            value={location}
            onChange={setLocation}
            counts={counts}
          />
        }
      />
      {!any ? (
        <EmptyState
          icon={<Gavel />}
          title={
            auctions.length ? "No auctions here right now" : "No auctions yet"
          }
        >
          {auctions.length
            ? "Try another location."
            : "The worker finds auctions every 30 minutes. Start it with npm run dev:worker."}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-8">
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <section key={g.title} aria-labelledby={`g-${g.title}`}>
                <h2
                  id={`g-${g.title}`}
                  className="mb-3 text-sm font-semibold text-muted-foreground"
                >
                  {g.title}{" "}
                  <span className="tabular-nums opacity-70">
                    {g.items.length}
                  </span>
                </h2>
                <div className="@container">
                  <div className="grid gap-4 @2xl:grid-cols-2 @5xl:grid-cols-3">
                    {g.items.map((a) => (
                      <AuctionCard
                        key={a.key}
                        a={a}
                        phase={phaseAt(a, now)}
                        now={now}
                      />
                    ))}
                  </div>
                </div>
              </section>
            ))}
        </div>
      )}
      {closed.length > 0 && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            onClick={() => void setShowClosed(showClosed ? null : true)}
            aria-pressed={showClosed}
          >
            <History />
            {showClosed
              ? "Hide closed auctions"
              : `Show closed auctions (${closed.length})`}
          </Button>
        </div>
      )}
    </div>
  );
}

const PHASE_CHIP: Record<Phase, { label: string; cls: string }> = {
  closing: { label: "Closing now", cls: "bg-closing text-black" },
  upcoming: { label: "Open for bids", cls: "bg-white/90 text-black" },
  closed: { label: "Closed", cls: "bg-black/60 text-white" },
};

/** The auction's cover: ABC's photo, else a mosaic of its lots' photos. */
function Cover({ a }: { a: AuctionView }) {
  const sizes = "(min-width: 1280px) 30vw, (min-width: 768px) 45vw, 100vw";
  if (a.photoUrl)
    return (
      <Image
        src={a.photoUrl}
        alt=""
        fill
        sizes={sizes}
        quality={60}
        className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      />
    );
  if (a.thumbs.length >= 2)
    return (
      <div className="grid size-full grid-cols-2 grid-rows-2 gap-0.5">
        {a.thumbs.slice(0, 4).map((t, i) => (
          <div
            key={t}
            className={cn(
              "relative",
              a.thumbs.length === 2 && "row-span-2",
              a.thumbs.length === 3 && i === 0 && "row-span-2",
            )}
          >
            <Image
              src={t.replace(/-Thumb\.(jpe?g|png|webp)$/i, "-Zoom.$1")}
              alt=""
              fill
              sizes="25vw"
              quality={60}
              className="object-cover"
            />
          </div>
        ))}
      </div>
    );
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/30 via-chart-1/20 to-transparent">
      <Gavel className="size-10 text-primary/60" aria-hidden="true" />
    </div>
  );
}

function AuctionCard({
  a,
  phase,
  now,
}: {
  a: AuctionView;
  phase: Phase;
  now: number;
}) {
  const chip = PHASE_CHIP[phase];
  const closedCount = a.lots - a.open;
  const href =
    phase === "closed"
      ? abcLink(a.name)
      : `/browse?auction=${encodeURIComponent(a.key)}&sort=ending`;
  const external = phase === "closed";
  const body = (
    <>
      <div className="relative aspect-[16/9] overflow-hidden bg-muted">
        <Cover a={a} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
        <div className="absolute top-3 right-3 left-3 flex items-start justify-between gap-2">
          {a.code && (
            <span className="rounded-md bg-black/60 px-2 py-0.5 font-mono text-xs font-semibold text-white backdrop-blur-sm">
              {a.code}
            </span>
          )}
          <span
            className={cn(
              "ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold shadow-sm",
              chip.cls,
            )}
          >
            {chip.label}
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-0 p-4 text-white">
          <h3 className="text-lg leading-tight font-semibold text-balance drop-shadow">
            {a.title}
          </h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-white/85">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            {[a.kind, a.location].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock
            className="size-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          {phase === "closed"
            ? `Closed ${a.lastEnd ? formatWhen(at(a.lastEnd), now) : ""}`
            : phase === "closing"
              ? `Closing now${a.lastEnd ? `, last lots around ${time(a.lastEnd)}` : ""}`
              : a.firstEnd
                ? `Closes ${formatWhen(at(a.firstEnd), now).replace(/ (\d\d:\d\d)$/, " from $1")}`
                : "Closing time to be announced"}
        </p>

        {phase === "closing" && a.lots > 0 && (
          <div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={a.lots}
              aria-valuenow={closedCount}
              aria-label={`${closedCount} of ${a.lots} lots closed`}
            >
              <div
                className="h-full rounded-full bg-closing transition-[width]"
                style={{ width: `${(closedCount / a.lots) * 100}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground tabular-nums">
              {closedCount} of {a.lots} closed
            </p>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Lots" value={a.lots.toLocaleString()} />
          {phase === "closed" ? (
            <>
              <Stat
                label="Sold"
                value={a.sold ? a.sold.toLocaleString() : "–"}
              />
              <Stat
                label="Sold for"
                value={a.soldTotal ? formatMoney(a.soldTotal) : "–"}
              />
            </>
          ) : (
            <>
              <Stat label="With bids" value={a.withBids.toLocaleString()} />
              <Stat label="Open" value={a.open.toLocaleString()} />
            </>
          )}
        </dl>

        {a.topCategories.length > 0 && (
          <p className="mt-auto flex flex-wrap gap-1">
            {a.topCategories.map((c) => (
              <span
                key={c}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {c}
              </span>
            ))}
          </p>
        )}
        {external && (
          <p className="flex items-center gap-1 text-xs text-primary">
            See its lots on ABC{" "}
            <ExternalLink className="size-3" aria-hidden="true" />
          </p>
        )}
      </div>
    </>
  );
  const cls = cn(
    "group flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-2 focus-visible:outline-ring",
    phase === "closed" && "opacity-90",
  );
  return external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={cls}>
      {body}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {body}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-muted/50 px-2 py-2">
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
