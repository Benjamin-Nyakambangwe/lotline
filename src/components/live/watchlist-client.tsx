"use client";

import {
  BadgeCheck,
  CircleAlert,
  ExternalLink,
  Eye,
  Monitor,
  MonitorOff,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import Link from "next/link";
import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useEffect, useRef, useState, useTransition } from "react";
import { EmptyState, PageHeader } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { lotUrl } from "@/lib/abc/urls";
import { formatMoney } from "@/lib/domain/money";
import { formatWhen } from "@/lib/domain/time";
import type { LiveLot } from "@/lib/live-view";
import { cn } from "@/lib/utils";
import { setLotPlan, setWatch } from "@/server/actions/watch";
import { Countdown, ExtendedChip, LotThumb } from "../lot/bits";
import { beep, setSoundOn, soundOn, useLive } from "./live-provider";
import { MoneyInput } from "./money-input";
import { railOf, StatusChip } from "./status-chip";

const TABS = ["live", "open", "closed"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = {
  live: "Closing",
  open: "All open",
  closed: "Closed",
};

const inTab = (l: LiveLot, tab: Tab, now: number) => {
  if (tab === "closed") return l.phase === "final";
  if (l.phase === "final") return false;
  if (tab === "open") return true;
  return (
    l.phase === "closing" ||
    (!!l.endAt && Date.parse(l.endAt) - now < 24 * 3600_000)
  );
};

/** Keep the screen on during a close (Wake Lock), re-acquired when the tab comes back. */
function useWakeLock() {
  const [on, setOn] = useState(false);
  const lock = useRef<WakeLockSentinel | null>(null);
  useEffect(() => {
    if (!on) {
      void lock.current?.release();
      lock.current = null;
      return;
    }
    const get = async () => {
      try {
        lock.current = await navigator.wakeLock.request("screen");
      } catch {
        setOn(false);
      }
    };
    void get();
    const again = () => document.visibilityState === "visible" && void get();
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [on]);
  // Known only in the browser: decided after mount so server and client render alike.
  const [supported, setSupported] = useState(false);
  useEffect(() => setSupported("wakeLock" in navigator), []);
  return { on, setOn, supported };
}

export function WatchlistClient() {
  const live = useLive();
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("live"),
  );
  const [sound, setSound] = useState(false);
  useEffect(() => setSound(soundOn()), []);
  const wake = useWakeLock();

  // Opening the board marks alerts read.
  useEffect(() => {
    void fetch("/api/live", { method: "POST" });
  }, []);

  const data = live.data;
  const now = Date.now();
  const lots = data?.lots ?? [];
  const shown = lots
    .filter((l) => inTab(l, tab, now))
    .sort((a, b) =>
      tab === "closed"
        ? (b.closedAt ?? b.endAt ?? "").localeCompare(
            a.closedAt ?? a.endAt ?? "",
          )
        : (a.endAt ?? "9").localeCompare(b.endAt ?? "9"),
    );
  const outbid = lots.filter(
    (l) => l.status === "outbid" && l.phase !== "final",
  );
  const counts = Object.fromEntries(
    TABS.map((t) => [t, lots.filter((l) => inTab(l, t, now)).length]),
  ) as Record<Tab, number>;

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Your lots, live. Statuses update every few seconds as lots near their close."
        actions={
          <div className="flex items-center gap-1">
            <Button
              variant={sound ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={sound}
              onClick={() => {
                setSoundOn(!sound);
                setSound(!sound);
                if (!sound) beep();
              }}
            >
              {sound ? <Volume2 /> : <VolumeX />} Sound
            </Button>
            {wake.supported && (
              <Button
                variant={wake.on ? "secondary" : "ghost"}
                size="sm"
                aria-pressed={wake.on}
                onClick={() => wake.setOn(!wake.on)}
              >
                {wake.on ? <Monitor /> : <MonitorOff />} Keep awake
              </Button>
            )}
          </div>
        }
      />

      {data && (
        <p className="-mt-3 mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
          <BadgeCheck
            className={cn("size-3.5", data.bidder.linked && "text-win")}
            aria-hidden="true"
          />
          {data.bidder.linked
            ? `Exact status: ABC bidder ${data.bidder.masked} linked.`
            : "Status is estimated from the bids you enter. After your next bid on ABC, open the lot and tap “that's me” for exact status."}
        </p>
      )}

      {outbid.length > 0 && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-3 rounded-2xl border border-outbid/40 bg-outbid-bg p-4 text-outbid"
        >
          <CircleAlert className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="text-sm">
            <p className="font-semibold">
              Outbid on {outbid.length} {outbid.length === 1 ? "lot" : "lots"}
            </p>
            <p className="mt-0.5">
              {outbid
                .slice(0, 3)
                .map((l) => `${l.title} (next ${formatMoney(l.nextBid)})`)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      <div
        role="tablist"
        aria-label="Lots"
        className="mb-4 flex gap-1 rounded-full border bg-card p-1 sm:w-fit"
      >
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => void setTab(t)}
            className={cn(
              "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-medium sm:flex-none",
              tab === t
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {TAB_LABEL[t]}
            <span className="text-xs tabular-nums opacity-75">{counts[t]}</span>
          </button>
        ))}
      </div>

      {!data ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<Eye />}
          title={
            lots.length
              ? "Nothing here right now"
              : "You're not watching anything yet"
          }
        >
          {lots.length ? (
            "Try another tab."
          ) : (
            <>
              Open any lot and tap <strong>Watch</strong>, or{" "}
              <Link href="/assistant" className="text-primary underline">
                ask the assistant
              </Link>{" "}
              to find some. Watched lots are read every few seconds near their
              close.
            </>
          )}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label="Watched lots">
          {shown.map((l) => (
            <li key={l.id}>
              <WatchRow lot={l} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchRow({ lot: l }: { lot: LiveLot }) {
  const live = useLive();
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const [, start] = useTransition();
  const final = l.phase === "final";
  const saveMax = (cents: number | null) =>
    start(async () => {
      await setLotPlan({ lotId: l.id, maxBid: cents });
      live.refresh();
    });
  const remove = () =>
    start(async () => {
      live.setWatched(l.id, false);
      await setWatch({ lotId: l.id, watching: false });
      live.refresh();
    });

  return (
    <article className="relative flex gap-3 overflow-hidden rounded-2xl border bg-card p-3 pl-4">
      <span
        className={cn("absolute inset-y-0 left-0 w-1.5", railOf(l.status))}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={() => void setLot(l.id)}
        className="shrink-0 self-start"
        aria-label={`Open ${l.title}`}
      >
        <LotThumb src={l.thumbUrl} alt="" size={72} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => void setLot(l.id)}
            className="line-clamp-2 text-left text-sm leading-snug font-semibold hover:underline"
          >
            {l.title}
          </button>
          <button
            type="button"
            onClick={remove}
            aria-label={`Stop watching ${l.title}`}
            className="-mt-1 -mr-1 flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StatusChip
            status={l.status}
            confidence={l.confidence}
            provisional={l.provisional}
          />
          {l.extended && !final && <ExtendedChip />}
          {l.overMax && !final && (
            <span className="rounded-full bg-outbid-bg px-2 py-0.5 text-xs font-medium text-outbid">
              Over your max
            </span>
          )}
          {l.stc && (
            <span className="rounded-full bg-closing-bg px-2 py-0.5 text-xs text-closing">
              Subject to confirmation
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="text-sm tabular-nums">
            {final ? (
              <p>
                {l.finalPrice !== null ? (
                  <>
                    Closed at <strong>{formatMoney(l.finalPrice)}</strong>
                  </>
                ) : (
                  "Closed with no bids"
                )}
                {l.closedAt && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {formatWhen(new Date(l.closedAt))}
                  </span>
                )}
              </p>
            ) : (
              <>
                <p>
                  <span className="text-muted-foreground">
                    {l.currentBid === null ? "Opens at " : "Now "}
                  </span>
                  <strong className="text-base">
                    {formatMoney(l.currentBid ?? l.nextBid)}
                  </strong>
                  {l.currentBid !== null && (
                    <span className="text-muted-foreground">
                      {" "}
                      · next {formatMoney(l.nextBid)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatMoney(l.allInNext)} all-in at the next bid
                </p>
              </>
            )}
          </div>
          {!final && (
            <Countdown
              endAt={l.endAt}
              variant="pill"
              showWhen
              seconds
              className="text-sm"
            />
          )}
        </div>

        {!final && (
          <div className="mt-3 flex items-end gap-2">
            <MoneyInput
              label="Your max"
              value={l.maxBid}
              onSave={saveMax}
              className="w-40"
            />
            <Button asChild size="sm" className="ml-auto h-10">
              <a
                href={lotUrl(l.id, l.type)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Bid <ExternalLink />
              </a>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
