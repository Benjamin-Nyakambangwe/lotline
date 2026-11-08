"use client";

import {
  ArrowRight,
  BadgeCheck,
  Bell,
  CircleAlert,
  CircleCheck,
  ExternalLink,
  FolderKanban,
  Gavel,
  Hourglass,
  type LucideIcon,
  RefreshCw,
  Search,
  Timer,
  Trophy,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { parseAsInteger, useQueryState } from "nuqs";
import { lotUrl } from "@/lib/abc/urls";
import { formatMoney } from "@/lib/domain/money";
import { STATUS_LABEL } from "@/lib/domain/status";
import { formatCountdown, formatWhen, localDate } from "@/lib/domain/time";
import type { LiveAlert, LiveLot } from "@/lib/live-view";
import { cn } from "@/lib/utils";
import type { AuctionView } from "@/server/auctions";
import { useLive } from "../live/live-provider";
import { StatusChip } from "../live/status-chip";
import { LotThumb } from "../lot/bits";
import { useNow } from "../time/ticker";
import { MarkShape, TonightTimeline } from "./tonight-timeline";

const HOUR = 3_600_000;

export function DashboardClient({
  greeting,
  auctions,
  won,
}: {
  greeting: string;
  auctions: AuctionView[];
  won: { count: number; allInCents: number };
}) {
  const live = useLive();
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const ticked = useNow();
  const now = ticked || Date.now();
  const lots = live.data?.lots ?? [];
  const open = lots
    .filter((l) => l.phase !== "final" && l.endAt)
    .sort((a, b) => (a.endAt as string).localeCompare(b.endAt as string));
  const next = open[0] ?? null;
  const winning = open.filter(
    (l) => l.status === "winning" || l.provisional === "winning",
  );
  const outbid = open.filter(
    (l) => l.status === "outbid" || l.provisional === "outbid",
  );
  const soon = open.filter((l) => Date.parse(l.endAt as string) - now <= HOUR);
  const today = localDate(now);
  const tonight = lots.filter((l) => {
    const t = l.closedAt ?? l.endAt;
    return !!t && (localDate(Date.parse(t)) === today || l.phase === "closing");
  });
  const upcoming = auctions.filter((a) => a.phase !== "closed").slice(0, 3);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm font-medium text-primary">{greeting}</p>

      {next ? (
        <NextUp lot={next} now={now} onOpen={() => void setLot(next.id)} />
      ) : (
        <NothingWatched auction={upcoming[0] ?? null} loading={!live.data} />
      )}

      <section
        aria-label="Your numbers"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <Kpi
          icon={CircleCheck}
          tone="text-win"
          label="Winning"
          value={winning.length}
          detail={winning.length ? "lots you lead" : "none right now"}
          href="/watchlist"
        />
        <Kpi
          icon={CircleAlert}
          tone="text-outbid"
          label="Outbid"
          value={outbid.length}
          detail={
            outbid.length
              ? `next bid from ${formatMoney(Math.min(...outbid.map((l) => l.nextBid ?? Number.POSITIVE_INFINITY)))}`
              : "all clear"
          }
          href="/watchlist"
        />
        <Kpi
          icon={Timer}
          tone="text-closing"
          label="Closing within an hour"
          value={soon.length}
          detail={
            soon[0]?.endAt
              ? `next ${formatWhen(Date.parse(soon[0].endAt), now)}`
              : open[0]?.endAt
                ? `next ${formatWhen(Date.parse(open[0].endAt), now)}`
                : "nothing watched"
          }
          href="/watchlist"
        />
        <Kpi
          icon={Trophy}
          tone="text-win"
          label="Won this month"
          value={won.count}
          detail={
            won.count ? `${formatMoney(won.allInCents)} all-in` : "nothing yet"
          }
          href="/won"
        />
      </section>

      {tonight.length > 0 && (
        <section
          aria-labelledby="tonight-h"
          className="rounded-2xl border bg-card p-4 sm:p-5"
        >
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 id="tonight-h" className="font-semibold">
              Tonight{" "}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {tonight.length} lots
              </span>
            </h2>
            <Link
              href="/watchlist?tab=live"
              className="text-sm text-primary hover:underline"
            >
              Board
            </Link>
          </div>
          <TonightTimeline lots={tonight} onOpen={(id) => void setLot(id)} />
          {/* The same lots as a list: the chart's table view. */}
          <ul className="mt-4 divide-y border-t" aria-label="Tonight's lots">
            {[...tonight]
              .sort((a, b) => (a.endAt ?? "").localeCompare(b.endAt ?? ""))
              .slice(0, 8)
              .map((l) => (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => void setLot(l.id)}
                    className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-surface-2"
                  >
                    <span className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                      {l.endAt
                        ? new Intl.DateTimeFormat("en-GB", {
                            hour: "2-digit",
                            minute: "2-digit",
                            timeZone: "Africa/Harare",
                          }).format(Date.parse(l.endAt))
                        : "–"}
                    </span>
                    <svg
                      width="14"
                      height="14"
                      className="shrink-0 sm:hidden"
                      role="img"
                      aria-label={STATUS_LABEL[l.status]}
                    >
                      <MarkShape status={l.status} x={7} y={7} r={5} />
                    </svg>
                    <span className="min-w-0 flex-1 truncate">{l.title}</span>
                    <StatusChip
                      status={l.status}
                      confidence={l.confidence}
                      provisional={l.provisional}
                      className="hidden sm:inline-flex"
                    />
                    <span className="w-16 shrink-0 text-right font-medium tabular-nums">
                      {formatMoney(l.finalPrice ?? l.currentBid ?? l.nextBid)}
                    </span>
                  </button>
                </li>
              ))}
          </ul>
          {tonight.length > 8 && (
            <Link
              href="/watchlist?tab=live"
              className="mt-2 inline-block text-sm text-primary hover:underline"
            >
              All {tonight.length} on the board
            </Link>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Alerts
          alerts={live.data?.alerts ?? []}
          now={now}
          onOpen={(id) => void setLot(id)}
        />
        <UpcomingAuctions auctions={upcoming} now={now} />
      </div>

      {live.data && lots.length === 0 && <GettingStarted />}
    </div>
  );
}

/** The ring: how much of the final hour is left, coloured by how close the close is. */
function Ring({ left, closing }: { left: number; closing: boolean }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const frac = closing ? 0 : Math.max(0, Math.min(1, left / HOUR));
  const color =
    closing || left < 2 * 60_000
      ? "var(--outbid)"
      : left < 10 * 60_000
        ? "var(--closing)"
        : "var(--primary)";
  return (
    <svg
      viewBox="0 0 120 120"
      className="size-28 shrink-0 -rotate-90 sm:size-32"
      aria-hidden="true"
    >
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="var(--muted)"
        strokeWidth="8"
      />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={`${c * frac} ${c}`}
        className={cn(
          "transition-[stroke-dasharray] duration-700",
          closing && "animate-pulse",
        )}
      />
    </svg>
  );
}

function NextUp({
  lot: l,
  now,
  onOpen,
}: {
  lot: LiveLot;
  now: number;
  onOpen: () => void;
}) {
  const end = Date.parse(l.endAt as string);
  const left = end - now;
  const closing = l.phase === "closing" || left <= 0;
  return (
    <section
      aria-label="Next to close"
      className="mesh relative overflow-hidden rounded-2xl border bg-card p-5 sm:p-6"
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="relative">
            <Ring left={left} closing={closing} />
            <button
              type="button"
              onClick={onOpen}
              className="absolute inset-0 m-auto size-16 overflow-hidden rounded-full sm:size-20"
              aria-label={`Open ${l.title}`}
            >
              <LotThumb
                src={l.thumbUrl}
                alt=""
                size={80}
                className="size-full rounded-full object-cover"
              />
            </button>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              Next to close
            </p>
            <p
              className="text-[clamp(2.5rem,9vw,3.5rem)] leading-none font-semibold tracking-tight tabular-nums"
              role="timer"
            >
              {closing ? "Closing…" : formatCountdown(left, { seconds: true })}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatWhen(end, now)}
              {l.extended ? " · extended" : ""}
            </p>
          </div>
        </div>
        <div className="min-w-0 flex-1 sm:border-l sm:pl-6">
          <button
            type="button"
            onClick={onOpen}
            className="line-clamp-2 text-left text-lg leading-snug font-semibold hover:underline"
          >
            {l.title}
          </button>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusChip
              status={l.status}
              confidence={l.confidence}
              provisional={l.provisional}
            />
            {l.overMax && (
              <span className="rounded-full bg-outbid-bg px-2 py-0.5 text-xs font-medium text-outbid">
                Over your max
              </span>
            )}
          </div>
          <p className="mt-2 text-sm tabular-nums">
            <span className="text-muted-foreground">
              {l.currentBid === null ? "Opens at " : "Now "}
            </span>
            <strong>{formatMoney(l.currentBid ?? l.nextBid)}</strong>
            {l.currentBid !== null && (
              <span className="text-muted-foreground">
                {" "}
                · next {formatMoney(l.nextBid)}
              </span>
            )}
            <span className="text-muted-foreground">
              {" "}
              · {formatMoney(l.allInNext)} all-in
            </span>
          </p>
          <div className="mt-4 flex gap-2">
            <a
              href={lotUrl(l.id, l.type)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Bid on ABC <ExternalLink className="size-4" />
            </a>
            <Link
              href="/watchlist"
              className="inline-flex h-10 items-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
            >
              Watchlist
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function NothingWatched({
  auction,
  loading,
}: {
  auction: AuctionView | null;
  loading: boolean;
}) {
  return (
    <section className="mesh relative overflow-hidden rounded-2xl border bg-card p-6 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {loading ? "Loading your lots…" : "Nothing you watch is closing yet."}
      </h1>
      <p className="mt-2 max-w-prose text-muted-foreground">
        Watch lots and this page counts down to the next one, with where you're
        winning or outbid.
        {auction && (
          <>
            {" "}
            Next up:{" "}
            <strong className="text-foreground">{auction.title}</strong>
            {auction.firstEnd && (
              <>
                {" "}
                closes{" "}
                {formatWhen(Date.parse(auction.firstEnd)).replace(
                  / (\d\d:\d\d)$/,
                  " from $1",
                )}
              </>
            )}
            .
          </>
        )}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/auctions"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Gavel className="size-4" /> See auctions
        </Link>
        <Link
          href="/browse"
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium hover:bg-muted"
        >
          <Search className="size-4" /> Browse lots
        </Link>
      </div>
    </section>
  );
}

function Kpi({
  icon: Icon,
  tone,
  label,
  value,
  detail,
  href,
}: {
  icon: LucideIcon;
  tone: string;
  label: string;
  value: number;
  detail: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group rounded-2xl border bg-card p-4 transition-colors hover:border-primary/40"
    >
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className={cn("size-4", tone)} aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-3xl font-semibold tracking-tight">
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{detail}</p>
    </Link>
  );
}

const ALERT_ICON: Record<string, { icon: LucideIcon; tone: string }> = {
  outbid: { icon: CircleAlert, tone: "text-outbid" },
  winning: { icon: CircleCheck, tone: "text-win" },
  won: { icon: Trophy, tone: "text-win" },
  lost: { icon: CircleAlert, tone: "text-muted-foreground" },
  ending_soon: { icon: Hourglass, tone: "text-closing" },
  extended: { icon: RefreshCw, tone: "text-extended" },
};

const ago = (iso: string, now: number) => {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  return m < 1
    ? "just now"
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : formatWhen(Date.parse(iso), now);
};

function Alerts({
  alerts,
  now,
  onOpen,
}: {
  alerts: LiveAlert[];
  now: number;
  onOpen: (id: number) => void;
}) {
  return (
    <section
      aria-labelledby="alerts-h"
      className="rounded-2xl border bg-card p-4 sm:p-5"
    >
      <h2 id="alerts-h" className="mb-3 font-semibold">
        Recent alerts
      </h2>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No alerts yet. Outbid, closing soon and results land here (and on your
          phone, if you turn alerts on in Settings).
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {alerts.slice(0, 6).map((a) => {
            const { icon: Icon, tone } = ALERT_ICON[a.kind] ?? {
              icon: Bell,
              tone: "text-primary",
            };
            return (
              <li key={a.id}>
                <button
                  type="button"
                  disabled={!a.lotId}
                  onClick={() => a.lotId && onOpen(a.lotId)}
                  className="flex w-full items-start gap-3 rounded-lg p-2 text-left hover:bg-muted disabled:hover:bg-transparent"
                >
                  <Icon
                    className={cn("mt-0.5 size-4 shrink-0", tone)}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-sm",
                        !a.read && "font-semibold",
                      )}
                    >
                      {a.title}
                    </span>
                    {a.body && (
                      <span className="line-clamp-1 text-xs text-muted-foreground">
                        {a.body}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {ago(a.createdAt, now)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function UpcomingAuctions({
  auctions,
  now,
}: {
  auctions: AuctionView[];
  now: number;
}) {
  return (
    <section
      aria-labelledby="upcoming-h"
      className="rounded-2xl border bg-card p-4 sm:p-5"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 id="upcoming-h" className="font-semibold">
          Next auctions
        </h2>
        <Link href="/auctions" className="text-sm text-primary hover:underline">
          All auctions
        </Link>
      </div>
      {auctions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No auctions found yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {auctions.map((a) => (
            <li key={a.key}>
              <Link
                href={`/browse?auction=${encodeURIComponent(a.key)}&sort=ending`}
                className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-muted"
              >
                <span className="relative h-12 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                  {(a.photoUrl ?? a.thumbs[0]) && (
                    <Image
                      src={(a.photoUrl ?? a.thumbs[0]) as string}
                      alt=""
                      fill
                      sizes="80px"
                      quality={60}
                      className="object-cover"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {a.title}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[a.code, a.location].filter(Boolean).join(" · ")} ·{" "}
                    {a.phase === "closing"
                      ? "closing now"
                      : a.firstEnd
                        ? formatWhen(Date.parse(a.firstEnd), now).replace(
                            / (\d\d:\d\d)$/,
                            " from $1",
                          )
                        : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {a.lots} lots
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GettingStarted() {
  const steps = [
    {
      icon: Search,
      title: "Find lots worth watching",
      body: "Search the live catalogue and tap Watch on the ones you want.",
      href: "/browse",
      cta: "Browse lots",
    },
    {
      icon: BadgeCheck,
      title: "Link your ABC bidder number",
      body: "After your next bid on ABC, tap “that's me” on the lot: winning and outbid become exact.",
      href: "/settings#bidder",
      cta: "How it works",
    },
    {
      icon: FolderKanban,
      title: "Turn on phone alerts",
      body: "Outbid and closing-soon alerts reach your phone even when Lotline is closed.",
      href: "/settings#alerts",
      cta: "Set up alerts",
    },
  ];
  return (
    <section aria-labelledby="getting-started">
      <h2
        id="getting-started"
        className="mb-3 text-sm font-semibold text-muted-foreground"
      >
        Getting started
      </h2>
      <div className="grid gap-3 md:grid-cols-3">
        {steps.map(({ icon: Icon, title, body, href, cta }) => (
          <Link
            key={title}
            href={href}
            className="group flex flex-col rounded-2xl border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-surface-2"
          >
            <Icon className="size-5 text-primary" aria-hidden="true" />
            <h3 className="mt-3 font-semibold">{title}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{body}</p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary">
              {cta}{" "}
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
