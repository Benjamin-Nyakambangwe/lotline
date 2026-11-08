"use client";

import { ArrowRight, Gavel, MapPin } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { formatWhen, localDate } from "@/lib/domain/time";
import { cn } from "@/lib/utils";
import type { AuctionView } from "@/server/auctions";
import { LocationSwitch, readLocationPref } from "../location/location-switch";
import { BigCountdown } from "../lot/bits";
import { useNow } from "../time/ticker";

type Phase = "closing" | "upcoming" | "closed";

/** Phase from the clock, so cards move on their own as auctions start closing. */
function phaseAt(a: AuctionView, now: number): Phase {
  const first = a.firstEnd ? Date.parse(a.firstEnd) : null;
  const last = a.lastEnd ? Date.parse(a.lastEnd) : null;
  if (!first || now < first) return "upcoming";
  // Soft-close extensions can run past the last scheduled end: allow 15 minutes.
  if (last && now < last + 15 * 60_000) return "closing";
  return "closed";
}

const at = (iso: string) => Date.parse(iso);

export function AuctionsClient({ auctions }: { auctions: AuctionView[] }) {
  const router = useRouter();
  const ticked = useNow();
  const now = ticked || Date.now();
  const [location, setLocation] = useState<string | null>(null);
  useEffect(() => setLocation(readLocationPref()), []);

  // Lot counts change as lots close: refresh from the server every minute while visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  const counts = new Map<string, number>();
  for (const a of auctions)
    for (const l of (a.location ?? "").split(" & ").filter(Boolean))
      counts.set(l, (counts.get(l) ?? 0) + 1);
  const shown = auctions.filter(
    (a) => !location || (a.location ?? "").split(" & ").includes(location),
  );

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
          a.firstEnd &&
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
    {
      title: "Closed in the last day",
      items: shown.filter((a) => phaseAt(a, now) === "closed"),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Auctions"
        description="Every ABC auction with lots on sale. Lots in an auction close one after another, about 20 seconds apart. Times are in Harare."
        actions={
          <LocationSwitch
            value={location}
            onChange={setLocation}
            counts={counts}
          />
        }
      />
      {shown.length === 0 ? (
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
                  <div className="grid gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">
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
    </div>
  );
}

const PHASE_CHIP: Record<Phase, { label: string; cls: string }> = {
  closing: { label: "Closing now", cls: "bg-closing-bg text-closing" },
  upcoming: { label: "Open for bids", cls: "bg-primary/12 text-primary" },
  closed: { label: "Closed", cls: "bg-muted text-muted-foreground" },
};

function AuctionCard({
  a,
  phase,
  now,
}: {
  a: AuctionView;
  phase: Phase;
  now: number;
}) {
  const closed = a.lots - a.open;
  const chip = PHASE_CHIP[phase];
  const next = a.nextEnd && at(a.nextEnd) > now ? a.nextEnd : null;
  return (
    <Link
      href={`/browse?auction=${encodeURIComponent(a.key)}&sort=ending`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring",
        phase === "closed" && "opacity-75",
      )}
    >
      {phase === "closing" && (
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-closing/10 via-transparent to-transparent" />
      )}
      <div className="relative flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-xs">
          {a.code && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono font-medium">
              {a.code}
            </span>
          )}
          {a.location && (
            <span className="flex items-center gap-1 truncate text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
              {a.location}
            </span>
          )}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
            chip.cls,
          )}
        >
          {chip.label}
        </span>
      </div>

      <h3 className="relative mt-2 text-base leading-snug font-semibold">
        {a.title}
      </h3>
      <p className="relative mt-1 text-sm text-muted-foreground tabular-nums">
        {a.lots.toLocaleString()} lots · {a.withBids.toLocaleString()} with bids
      </p>
      {a.topCategories.length > 0 && (
        <p className="relative mt-2 flex flex-wrap gap-1">
          {a.topCategories.map((c) => (
            <span
              key={c}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
            >
              {c}
            </span>
          ))}
        </p>
      )}

      <div className="relative mt-4 flex items-end justify-between gap-3">
        {next ? (
          <BigCountdown
            endAt={next}
            label={
              phase === "closing" ? "Next lot closes in" : "First lot closes in"
            }
          />
        ) : (
          <div className="flex flex-col">
            <span className="text-xs font-medium text-muted-foreground">
              {phase === "closed" ? "Closed" : "Last lots closing"}
            </span>
            <span className="text-sm tabular-nums">
              {a.lastEnd ? formatWhen(at(a.lastEnd), now) : "–"}
            </span>
          </div>
        )}
        <ArrowRight
          className="size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
          aria-hidden="true"
        />
      </div>

      {a.firstEnd && a.lastEnd && phase !== "closed" && (
        <p className="relative mt-2 text-xs text-muted-foreground tabular-nums">
          Closes {formatWhen(at(a.firstEnd), now)} →{" "}
          {formatWhen(at(a.lastEnd), now).replace(
            /^(today|tomorrow|yesterday) /,
            "",
          )}
        </p>
      )}

      {phase === "closing" && a.lots > 0 && (
        <div className="relative mt-3">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={a.lots}
            aria-valuenow={closed}
            aria-label={`${closed} of ${a.lots} lots closed`}
          >
            <div
              className="h-full rounded-full bg-closing transition-[width]"
              style={{ width: `${(closed / a.lots) * 100}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {closed} of {a.lots} closed
          </p>
        </div>
      )}
    </Link>
  );
}
