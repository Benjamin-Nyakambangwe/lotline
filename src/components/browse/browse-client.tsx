"use client";

import {
  ArrowRight,
  ChevronDown,
  Gavel,
  LayoutGrid,
  List,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  parseAsArrayOf,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral,
  useQueryState,
  useQueryStates,
} from "nuqs";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatMoney } from "@/lib/domain/money";
import { formatTime, formatWhen } from "@/lib/domain/time";
import type { AuctionInfo } from "@/lib/lot-view";
import type { FacetName, Filters, Hit, SortKey } from "@/lib/search/engine";
import { cn } from "@/lib/utils";
import { useCatalogue } from "../catalogue/catalogue-provider";
import { LocationSwitch, readLocationPref } from "../location/location-switch";
import {
  AllIn,
  BigCountdown,
  Countdown,
  ExtendedChip,
  Highlight,
  LotThumb,
  RunBadge,
  ratesOf,
} from "../lot/bits";
import { PhotoCarousel, zoomOf } from "../lot/photo-carousel";
import { useNow } from "../time/ticker";

const ENDS = ["hour", "today", "tomorrow", "week", "later"] as const;
const PRICES = ["u10", "10-50", "50-200", "200-1k", "1k+"] as const;
const BIDS = ["none", "some"] as const;
const SORTS = [
  "relevance",
  "ending",
  "price-asc",
  "price-desc",
  "newest",
] as const;

const LABELS: Record<string, Record<string, string>> = {
  ends: {
    hour: "Within an hour",
    today: "Today",
    tomorrow: "Tomorrow",
    week: "This week",
    later: "Later",
  },
  price: {
    u10: "Under $10",
    "10-50": "$10–50",
    "50-200": "$50–200",
    "200-1k": "$200–1,000",
    "1k+": "$1,000+",
  },
  bids: { none: "No bids yet", some: "Has bids" },
};
const FACET_TITLE: Record<FacetName, string> = {
  auction: "Auction",
  category: "Category",
  location: "Location",
  ends: "Closes",
  price: "Next bid",
  condition: "Condition",
  bids: "Bids",
};
const FIXED_ORDER: Partial<Record<FacetName, readonly string[]>> = {
  ends: ENDS,
  price: PRICES,
  bids: BIDS,
};
const SORT_LABEL: Record<SortKey, string> = {
  relevance: "Best match",
  ending: "Closing soonest",
  "price-asc": "Lowest price",
  "price-desc": "Highest price",
  newest: "Newest",
};

const PAGE = 48;

export function BrowseClient() {
  const { engine, data, loading, error } = useCatalogue();
  const [, setLot] = useQueryState(
    "lot",
    parseAsInteger.withOptions({ history: "push" }),
  );
  const [state, setState] = useQueryStates(
    {
      q: parseAsString.withDefault(""),
      auction: parseAsArrayOf(parseAsString).withDefault([]),
      category: parseAsArrayOf(parseAsString).withDefault([]),
      location: parseAsArrayOf(parseAsString).withDefault([]),
      condition: parseAsArrayOf(parseAsString).withDefault([]),
      ends: parseAsArrayOf(parseAsStringLiteral(ENDS)).withDefault([]),
      price: parseAsArrayOf(parseAsStringLiteral(PRICES)).withDefault([]),
      bids: parseAsArrayOf(parseAsStringLiteral(BIDS)).withDefault([]),
      sort: parseAsStringLiteral(SORTS),
      view: parseAsStringLiteral(["grid", "list"] as const).withDefault("grid"),
    },
    { history: "replace", throttleMs: 400 },
  );

  // The input is local state so typing never waits for the URL; results use a deferred copy.
  const [input, setInput] = useState(state.q);
  const query = useDeferredValue(input);
  useEffect(() => {
    if (input !== state.q) void setState({ q: input || null });
  }, [input, state.q, setState]);

  const filters: Filters = {
    auction: state.auction,
    category: state.category,
    location: state.location,
    condition: state.condition,
    ends: state.ends,
    price: state.price,
    bids: state.bids,
  };
  const filterKey = JSON.stringify(filters);

  const result = useMemo(() => {
    if (!engine) return null;
    return engine.search({
      q: query,
      filters: JSON.parse(filterKey),
      sort: state.sort ?? undefined,
    });
  }, [engine, query, filterKey, state.sort]);

  const [limit, setLimit] = useState(PAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset paging whenever the result set changes
  useEffect(() => setLimit(PAGE), [query, filterKey, state.sort]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + PAGE);
      },
      { rootMargin: "800px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // "/" focuses search from anywhere on the page.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !/input|textarea|select/i.test(t.tagName) &&
        !t.isContentEditable
      ) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeCount = Object.entries(filters).reduce(
    (a, [k, v]) => a + (k === "location" ? 0 : (v?.length ?? 0)),
    0,
  );

  // Start from the location this viewer chose last time, unless the link says otherwise.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on arrival
  useEffect(() => {
    const pref = readLocationPref();
    if (pref && !state.location.length && !state.auction.length)
      void setState({ location: [pref] });
  }, []);
  const location = state.location.length === 1 ? state.location[0] : null;

  const auctions = useMemo(
    () => new Map((data?.auctions ?? []).map((a) => [a.key, a])),
    [data?.auctions],
  );
  const auctionLabel = (key: string) => {
    const a = auctions.get(key);
    return key === "Unknown"
      ? "Not yet known"
      : a
        ? `${a.code ?? ""} ${a.title}`.trim()
        : key;
  };
  const toggle = (facet: FacetName, value: string) => {
    const cur = (filters[facet] ?? []) as string[];
    const next = cur.includes(value)
      ? cur.filter((v) => v !== value)
      : [...cur, value];
    void setState({ [facet]: next.length ? next : null } as Parameters<
      typeof setState
    >[0]);
  };
  const clearAll = () =>
    void setState({
      auction: null,
      category: null,
      condition: null,
      ends: null,
      price: null,
      bids: null,
    });

  const onEnter = () => {
    const target = result?.jump ?? result?.hits[0]?.doc;
    if (target) void setLot(target.id);
  };

  return (
    <div className="@container flex flex-col gap-4">
      <div className="sticky top-14 z-20 -mx-4 bg-background/90 px-4 pt-1 pb-3 backdrop-blur sm:-mx-6 sm:px-6 lg:top-0 lg:-mx-8 lg:px-8 lg:pt-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onEnter();
              if (e.key === "Escape") setInput("");
            }}
            placeholder="Search 2,500 lots: “optiplex 7060”, “fridge”, a lot number or ABC link"
            aria-label="Search lots"
            className="h-13 w-full rounded-2xl border bg-card pr-12 pl-12 [&::-webkit-search-cancel-button]:hidden text-base shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-4 focus:ring-primary/15"
          />
          {input ? (
            <button
              type="button"
              onClick={() => {
                setInput("");
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          ) : (
            <kbd className="pointer-events-none absolute top-1/2 right-4 hidden -translate-y-1/2 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground sm:block">
              /
            </kbd>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          <LocationSwitch
            value={location}
            onChange={(v) => void setState({ location: v ? [v] : null })}
            counts={
              result
                ? new Map(result.facets.location.map((b) => [b.value, b.count]))
                : undefined
            }
          />
        </div>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
            {(
              [
                "auction",
                "category",
                "ends",
                "price",
                "condition",
                "bids",
              ] as FacetName[]
            ).map((f) => (
              <FacetChip
                key={f}
                facet={f}
                labelOf={f === "auction" ? auctionLabel : undefined}
                selected={(filters[f] ?? []) as string[]}
                buckets={result?.facets[f] ?? []}
                onToggle={(v) => toggle(f, v)}
                onClear={() =>
                  void setState({ [f]: null } as Parameters<typeof setState>[0])
                }
              />
            ))}
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 rounded-full"
                onClick={clearAll}
              >
                Clear all
              </Button>
            )}
          </div>
          <SortMenu
            value={state.sort ?? (query ? "relevance" : "ending")}
            onChange={(s) => void setState({ sort: s })}
          />
          <ToggleGroup
            type="single"
            value={state.view}
            onValueChange={(v) =>
              v && void setState({ view: v as "grid" | "list" })
            }
            className="hidden sm:flex"
            aria-label="Layout"
          >
            <ToggleGroupItem value="grid" aria-label="Grid">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          Couldn’t load the catalogue. Check your connection and refresh.
        </p>
      )}

      {!result ? (
        <BrowseSkeleton loading={loading} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
            <p aria-live="polite">
              <span className="font-medium text-foreground tabular-nums">
                {result.total.toLocaleString()}
              </span>{" "}
              {result.total === 1 ? "lot" : "lots"}
              {query && (
                <>
                  {" "}
                  for “<span className="text-foreground">{query}</span>”
                </>
              )}
              <span className="ml-2 tabular-nums opacity-70">
                {result.ms < 1 ? "<1" : Math.round(result.ms)} ms
              </span>
            </p>
            {data?.syncedAt && (
              <p className="text-xs">
                Catalogue updated{" "}
                {formatTime(new Date(data.syncedAt)).slice(0, 5)}
              </p>
            )}
          </div>

          {state.auction.length === 1 && data && (
            <AuctionBanner
              info={auctions.get(state.auction[0]) ?? null}
              auctionKey={state.auction[0]}
              docs={data.lots}
              onClear={() => void setState({ auction: null })}
            />
          )}

          {result.jump && (
            <button
              type="button"
              onClick={() => void setLot(result.jump?.id ?? null)}
              className="flex items-center justify-between gap-3 rounded-2xl border border-primary/40 bg-primary/8 p-4 text-left hover:bg-primary/12"
            >
              <span className="min-w-0">
                <span className="block text-xs font-medium text-primary">
                  Go to lot {result.jump.id}
                </span>
                <span className="block truncate font-medium">
                  {result.jump.title}
                </span>
              </span>
              <ArrowRight className="size-5 shrink-0 text-primary" />
            </button>
          )}

          {result.mode === "any" && (
            <p className="rounded-xl bg-muted px-4 py-3 text-sm">
              No lot matches every word, so these match some of them.
            </p>
          )}

          {result.total === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <p className="font-medium">No lots match</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Try fewer words, check the spelling, or clear some filters.
              </p>
              {activeCount > 0 && (
                <Button variant="outline" className="mt-4" onClick={clearAll}>
                  Clear filters
                </Button>
              )}
            </div>
          ) : state.view === "list" ? (
            <ul className="divide-y rounded-2xl border bg-card">
              {result.hits.slice(0, limit).map((h) => (
                <li key={h.doc.id}>
                  <ResultRow hit={h} onOpen={() => void setLot(h.doc.id)} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4">
              {result.hits.slice(0, limit).map((h, i) => (
                <ResultCard
                  key={h.doc.id}
                  hit={h}
                  eager={i < 3}
                  onOpen={() => void setLot(h.doc.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
      <div ref={sentinel} aria-hidden="true" />
    </div>
  );
}

function FacetChip({
  facet,
  selected,
  buckets,
  onToggle,
  onClear,
  labelOf,
}: {
  facet: FacetName;
  labelOf?: (v: string) => string;
  selected: string[];
  buckets: { value: string; count: number }[];
  onToggle: (v: string) => void;
  onClear: () => void;
}) {
  const order = FIXED_ORDER[facet];
  const counts = new Map(buckets.map((b) => [b.value, b.count]));
  const values = order
    ? order.filter((v) => counts.has(v) || selected.includes(v))
    : [...new Set([...selected, ...buckets.map((b) => b.value)])];
  const label = (v: string) => labelOf?.(v) ?? LABELS[facet]?.[v] ?? v;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors",
            selected.length
              ? "border-primary/50 bg-primary/12 text-foreground"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          {selected.length === 1 ? label(selected[0]) : FACET_TITLE[facet]}
          {selected.length > 1 && (
            <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
              {selected.length}
            </span>
          )}
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="mb-1 flex items-center justify-between px-2 py-1">
          <span className="text-xs font-semibold text-muted-foreground">
            {FACET_TITLE[facet]}
          </span>
          {selected.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-primary hover:underline"
            >
              Clear
            </button>
          )}
        </div>
        <ul className="max-h-80 overflow-y-auto">
          {values.map((v) => {
            const id = `f-${facet}-${v}`;
            return (
              <li key={v}>
                <label
                  htmlFor={id}
                  className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-muted"
                >
                  <Checkbox
                    id={id}
                    checked={selected.includes(v)}
                    onCheckedChange={() => onToggle(v)}
                  />
                  <span className="flex-1 text-sm">{label(v)}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {(counts.get(v) ?? 0).toLocaleString()}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function SortMenu({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (s: SortKey) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 rounded-full"
        >
          <SlidersHorizontal />
          <span className="hidden sm:inline">{SORT_LABEL[value]}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Sort by
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as SortKey)}
        >
          {SORTS.map((s) => (
            <DropdownMenuRadioItem key={s} value={s}>
              {SORT_LABEL[s]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriceLines({ hit }: { hit: Hit }) {
  const d = hit.doc;
  const rates = ratesOf(d.rates);
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">
        {d.currentBid === null ? "No bids yet" : "Current bid"}
      </p>
      <p className="text-lg leading-tight font-semibold tabular-nums">
        {formatMoney(d.currentBid ?? d.startingBid)}
      </p>
      {d.startingBid !== null && (
        <p className="truncate text-xs text-muted-foreground">
          {d.currentBid === null ? "opens at" : "next"}{" "}
          <span className="tabular-nums">{formatMoney(d.startingBid)}</span> ·{" "}
          <AllIn hammer={d.startingBid} rates={rates} /> all-in
        </p>
      )}
    </div>
  );
}

function ResultCard({
  hit,
  onOpen,
  eager = false,
}: {
  hit: Hit;
  onOpen: () => void;
  eager?: boolean;
}) {
  const d = hit.doc;
  return (
    <article className="group flex flex-col overflow-hidden rounded-2xl border bg-card transition-colors hover:border-primary/40">
      <PhotoCarousel
        lotId={d.id}
        title={d.title}
        first={zoomOf(d.thumbUrl)}
        count={d.photos}
        sizes="(min-width: 1536px) 24vw, (min-width: 1024px) 32vw, (min-width: 640px) 50vw, 100vw"
        onOpen={() => onOpen()}
        eager={eager}
        className="aspect-[4/3]"
        overlay={
          (hit.run || d.extended) && (
            <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1">
              {hit.run && (
                <RunBadge
                  run={hit.run}
                  className="bg-background/90 shadow-sm backdrop-blur"
                />
              )}
              {d.extended && (
                <ExtendedChip className="bg-background/90 shadow-sm backdrop-blur" />
              )}
            </div>
          )
        }
      />
      <button
        type="button"
        onClick={onOpen}
        className="flex flex-1 flex-col p-3 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h3 className="line-clamp-2 text-[0.95rem] leading-snug font-semibold">
          <Highlight title={d.title} matched={hit.matched} />
        </h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {[d.location, d.auction, d.condition ?? d.category, d.cpu]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-3">
          <PriceLines hit={hit} />
          <Countdown
            endAt={d.endAt}
            variant="pill"
            showWhen
            className="shrink-0 text-sm"
          />
        </div>
      </button>
    </article>
  );
}

function ResultRow({ hit, onOpen }: { hit: Hit; onOpen: () => void }) {
  const d = hit.doc;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
    >
      <LotThumb src={d.thumbUrl} alt="" size={56} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">
          <Highlight title={d.title} matched={hit.matched} />
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {[d.location, d.condition ?? d.category, `#${d.lotNumber ?? d.id}`]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </span>
      {hit.run && <RunBadge run={hit.run} className="hidden md:inline-flex" />}
      <span className="w-20 text-right text-sm font-semibold tabular-nums">
        {formatMoney(d.currentBid ?? d.startingBid)}
      </span>
      <Countdown
        endAt={d.endAt}
        variant="pill"
        className="shrink-0 justify-end text-xs"
      />
    </button>
  );
}

function BrowseSkeleton({ loading }: { loading: boolean }) {
  return (
    <div aria-busy="true">
      <p className="mb-3 text-sm text-muted-foreground">
        {loading ? "Loading the catalogue…" : " "}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 9 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
          <div key={i} className="overflow-hidden rounded-2xl border">
            <Skeleton className="aspect-[4/3] rounded-none" />
            <div className="space-y-2 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-6 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The auction being browsed: what it is, where, and a live countdown to its next close. */
function AuctionBanner({
  info,
  auctionKey,
  docs,
  onClear,
}: {
  info: AuctionInfo | null;
  auctionKey: string;
  docs: Hit["doc"][];
  onClear: () => void;
}) {
  const ends = docs
    .filter((d) => d.auction === auctionKey && d.endAt)
    .map((d) => Date.parse(d.endAt as string))
    .sort((a, b) => a - b);
  const ticked = useNow();
  const now = ticked || Date.now();
  const next = ends.find((e) => e > now) ?? null;
  const open = ends.filter((e) => e > now).length;
  const first = ends[0];
  const last = ends.at(-1);
  return (
    <section
      aria-label="Auction"
      className="relative overflow-hidden rounded-2xl border bg-card p-4"
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-chart-1/10" />
      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium text-primary">
            <Gavel className="size-3.5" aria-hidden="true" />
            {info?.code ?? "Auction"}
            {info?.location && (
              <span className="text-muted-foreground">· {info.location}</span>
            )}
          </p>
          <h2 className="mt-1 text-lg font-semibold">
            {info?.title ?? auctionKey}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
            {open.toLocaleString()} {open === 1 ? "lot" : "lots"} open
            {first && last && (
              <>
                {" "}
                · closing {formatWhen(first)}
                {last - first > 60_000 && (
                  <>
                    {" "}
                    →{" "}
                    {formatWhen(last).replace(
                      /^(today|tomorrow|yesterday) /,
                      "",
                    )}
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-3">
          {next && (
            <BigCountdown
              endAt={new Date(next).toISOString()}
              label={
                next === first ? "First lot closes in" : "Next lot closes in"
              }
              className="text-right"
            />
          )}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            onClick={onClear}
            aria-label="Show all auctions"
          >
            <X />
          </Button>
        </div>
      </div>
    </section>
  );
}
