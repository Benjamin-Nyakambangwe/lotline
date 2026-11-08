import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { MarketRow } from "../db/queries/market";
import type { AuctionPhase } from "../domain/auctions";
import {
  allIn,
  DEFAULT_RATES,
  type FeeRates,
  maxHammerFor,
} from "../domain/fees";
import { formatCountdown, formatWhen } from "../domain/time";
import type { AuctionInfo, LotView } from "../lot-view";
import {
  type CatalogueDoc,
  CatalogueSearch,
  type EndsBucket,
  type SortKey,
} from "../search/engine";
import { marketSummary } from "./market";

/** What the tools need from the app: injected, so the tools and the loop are testable. */
export interface ToolDeps {
  now(): Date;
  catalogue(): Promise<{ lots: CatalogueDoc[]; auctions: AuctionInfo[] }>;
  lot(id: number): Promise<LotView | null>;
  auctions(): Promise<
    {
      key: string;
      title: string;
      code: string | null;
      location: string | null;
      lots: number;
      open: number;
      withBids: number;
      firstEnd: string | null;
      lastEnd: string | null;
      nextEnd: string | null;
      topCategories: string[];
      phase: AuctionPhase;
    }[]
  >;
  closedLots(
    query: string,
    opts: { months: number; location: string | null },
  ): Promise<MarketRow[]>;
  watchlist(): Promise<
    { lotId: number; maxBid: number | null; note: string | null }[]
  >;
  propose(
    kind: "watch" | "unwatch",
    lotId: number,
    payload: Record<string, unknown>,
  ): Promise<{ id: string }>;
}

const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? null : Math.round(cents) / 100;
const LOCATION = z.enum(["Harare", "Bulawayo"]);

/** Plain text from ABC's (already sanitised) description HTML, capped. */
export const plainText = (html: string | null, max = 1500) => {
  if (!html) return null;
  const t = html
    .replace(/<\s*(br|\/p|\/li)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** shown in the chat while it runs */
  label: (input: z.infer<S>) => string;
  run: (input: z.infer<S>, deps: ToolDeps) => Promise<unknown>;
}
const tool = <S extends z.ZodType>(t: ToolSpec<S>) => t;

let engineCache: { lots: CatalogueDoc[]; engine: CatalogueSearch } | null =
  null;
const engineFor = (lots: CatalogueDoc[]) => {
  if (engineCache?.lots !== lots)
    engineCache = { lots, engine: new CatalogueSearch(lots, "Africa/Harare") };
  return engineCache.engine;
};

const ratesOfLot = (r: [number, number, number] | null): FeeRates =>
  r ? { levy: r[0], vat: r[1], lotVat: r[2], estimated: false } : DEFAULT_RATES;

const SPECS = [
  tool({
    name: "fee_calculator",
    description:
      "Work out ABC's fees. Give `hammer` (dollars) to get the all-in price, or `all_in_budget` (dollars) to get the highest hammer bid on ABC's ladder that stays within that all-in budget. Uses the standard 17.5% levy and 15.5% VAT unless `lot_id` is given, in which case that lot's own rates are used.",
    input: z.object({
      hammer: z.number().positive().optional(),
      all_in_budget: z.number().positive().optional(),
      lot_id: z.number().int().positive().optional(),
    }),
    label: () => "Working out fees",
    run: async (i, deps) => {
      const lot = i.lot_id ? await deps.lot(i.lot_id) : null;
      const rates = lot ? lot.rates : DEFAULT_RATES;
      const out: Record<string, unknown> = {
        rates: { levy: rates.levy, vat: rates.vat, lot_vat: rates.lotVat },
      };
      if (i.hammer !== undefined) {
        const h = Math.round(i.hammer * 100);
        out.hammer = i.hammer;
        out.all_in = dollars(allIn(h, rates));
      }
      if (i.all_in_budget !== undefined) {
        const m = maxHammerFor(Math.round(i.all_in_budget * 100), rates);
        out.budget = i.all_in_budget;
        out.max_hammer_bid = dollars(m.hammer);
        out.all_in_at_max = dollars(m.allIn);
        out.next_step_over_budget = {
          hammer: dollars(m.next.hammer),
          all_in: dollars(m.next.allIn),
        };
      }
      if (i.hammer === undefined && i.all_in_budget === undefined)
        throw new Error("give hammer or all_in_budget");
      return out;
    },
  }),
  tool({
    name: "get_lot",
    description:
      "Everything Lotline knows about one lot by its ID: title, description, condition, category, current and next bid with all-in prices, fees, closing time, auction, location and where to collect it, and the result if it has closed.",
    input: z.object({ lot_id: z.number().int().positive() }),
    label: (i) => `Reading lot ${i.lot_id}`,
    run: async (i, deps) => {
      const l = await deps.lot(i.lot_id);
      if (!l) return { error: `No lot ${i.lot_id} in Lotline.` };
      const now = deps.now();
      const end = l.endAt ? new Date(l.endAt) : null;
      const closed =
        l.finalState === "final" || l.status === 2 || l.status === 3;
      return {
        id: l.id,
        title: l.title,
        link: `/lots/${l.id}`,
        status: closed
          ? l.finalPrice !== null
            ? `sold for $${dollars(l.finalPrice)} hammer ($${dollars(allIn(l.finalPrice, l.rates))} all-in)`
            : "closed without a sale"
          : l.status === 0
            ? "not open for bids yet"
            : "open",
        auction: l.auction
          ? `${l.auction.title} ${l.auction.code ?? ""}`.trim()
          : null,
        location: l.location,
        collect_from: l.viewing?.title ?? l.sublocation,
        shelf: l.viewing?.subtitle ?? null,
        condition: l.condition,
        state: l.state,
        category: l.categoryPath,
        quantity: l.quantityText,
        current_bid: dollars(l.currentBid),
        next_bid: closed ? null : dollars(l.startingBid),
        all_in_at_next_bid:
          closed || l.startingBid === null
            ? null
            : dollars(allIn(l.startingBid, l.rates)),
        fees: { ...l.rates, estimated: l.rates.estimated },
        closes: end ? formatWhen(end, now) : null,
        closes_in:
          end && !closed && end > now ? formatCountdown(+end - +now) : null,
        extended: !!(l.endAt && l.originalEndAt && l.endAt > l.originalEndAt),
        subject_to_confirmation: l.stc,
        photos: l.gallery.length,
        delivery: l.destinations.map(
          (d) => `${d.title}${d.price !== null ? ` $${d.price}` : ""}`,
        ),
        description: plainText(l.descriptionHtml),
      };
    },
  }),
  tool({
    name: "list_auctions",
    description:
      "ABC's auctions with lots on sale or closed in the last day: code, title, location, lot and bid counts, top categories, when lots start and finish closing, and whether each is open, closing now or closed.",
    input: z.object({ location: LOCATION.optional() }),
    label: () => "Checking auctions",
    run: async (i, deps) => {
      const now = deps.now();
      const all = await deps.auctions();
      return all
        .filter((a) => !i.location || (a.location ?? "").includes(i.location))
        .map((a) => ({
          code: a.code,
          title: a.title,
          link: `/browse?auction=${encodeURIComponent(a.key)}`,
          location: a.location,
          phase: a.phase,
          lots: a.lots,
          open_lots: a.open,
          with_bids: a.withBids,
          top_categories: a.topCategories,
          first_close: a.firstEnd
            ? formatWhen(new Date(a.firstEnd), now)
            : null,
          last_close: a.lastEnd ? formatWhen(new Date(a.lastEnd), now) : null,
          next_close_in:
            a.nextEnd && new Date(a.nextEnd) > now
              ? formatCountdown(Date.parse(a.nextEnd) - +now)
              : null,
        }));
    },
  }),
  tool({
    name: "market_prices",
    description:
      'What a kind of lot has sold for, from Lotline\'s closed-lot history (up to 12 months): count, median and spread of hammer and all-in prices, monthly medians, how many passed unsold, whether lots late in a run of similar lots fetched more than early ones, and the most recent sales. `query` matches titles word by word, e.g. "optiplex 7060", "fridge", "catalyst 2960".',
    input: z.object({
      query: z.string().min(2).max(80),
      months: z.number().int().min(1).max(12).optional(),
      location: LOCATION.optional(),
    }),
    label: (i) => `Checking past prices for “${i.query}”`,
    run: async (i, deps) => {
      const rows = await deps.closedLots(i.query, {
        months: i.months ?? 12,
        location: i.location ?? null,
      });
      const s = marketSummary(rows);
      const sum = (p: ReturnType<typeof marketSummary>["hammer"]) =>
        p.n
          ? {
              n: p.n,
              median: dollars(p.median),
              p25: dollars(p.p25),
              p75: dollars(p.p75),
              min: dollars(p.min),
              max: dollars(p.max),
            }
          : null;
      return {
        query: i.query,
        months: i.months ?? 12,
        matched: s.matched,
        sold: s.sold,
        passed_unsold: s.passedUnsold,
        hammer: sum(s.hammer),
        all_in: sum(s.allIn),
        unit_price: s.unitPrice ? sum(s.unitPrice) : null,
        by_month: s.byMonth.map((m) => ({ ...m, median: dollars(m.median) })),
        run_position: s.runPosition
          ? {
              early_in_run_median: dollars(s.runPosition.earlyMedian),
              early_n: s.runPosition.earlyN,
              late_in_run_median: dollars(s.runPosition.lateMedian),
              late_n: s.runPosition.lateN,
            }
          : null,
        recent: s.recent.map((r) => ({
          id: r.lotId,
          title: r.title,
          link: `/lots/${r.lotId}`,
          hammer: dollars(r.hammer),
          all_in: dollars(r.allIn),
          closed: r.closedAt
            ? formatWhen(new Date(r.closedAt), deps.now())
            : null,
          location: r.location,
          condition: r.condition,
        })),
      };
    },
  }),
  tool({
    name: "my_watchlist",
    description:
      "The lots this person is watching in Lotline, with their max bid and note, and each lot's current state.",
    input: z.object({}),
    label: () => "Checking your watchlist",
    run: async (_i, deps) => {
      const now = deps.now();
      const rows = await deps.watchlist();
      return Promise.all(
        rows.map(async (w) => {
          const l = await deps.lot(w.lotId);
          return {
            id: w.lotId,
            title: l?.title ?? null,
            link: `/lots/${w.lotId}`,
            your_max_bid: dollars(w.maxBid),
            note: w.note,
            current_bid: dollars(l?.currentBid),
            next_bid: dollars(l?.startingBid),
            closes: l?.endAt ? formatWhen(new Date(l.endAt), now) : null,
            closed: l?.finalState === "final",
          };
        }),
      );
    },
  }),
  tool({
    name: "propose_unwatch",
    description:
      "Propose removing a lot from this person's watchlist. They see a card and must tap Confirm; nothing changes until then.",
    input: z.object({ lot_id: z.number().int().positive() }),
    label: (i) => `Suggesting to stop watching lot ${i.lot_id}`,
    run: async (i, deps) => {
      const l = await deps.lot(i.lot_id);
      if (!l) return { error: `No lot ${i.lot_id} in Lotline.` };
      const a = await deps.propose("unwatch", i.lot_id, {});
      return {
        proposed: true,
        action_id: a.id,
        note: "Shown as a card; waiting for the person to confirm.",
      };
    },
  }),
  tool({
    name: "propose_watch",
    description:
      "Propose adding a lot to this person's watchlist, optionally with their max hammer bid (dollars) and a short note. They see a card and must tap Confirm; nothing changes until then. Lotline never bids: the max is their own plan.",
    input: z.object({
      lot_id: z.number().int().positive(),
      max_bid: z.number().positive().optional(),
      note: z.string().max(200).optional(),
    }),
    label: (i) => `Suggesting to watch lot ${i.lot_id}`,
    run: async (i, deps) => {
      const l = await deps.lot(i.lot_id);
      if (!l) return { error: `No lot ${i.lot_id} in Lotline.` };
      const a = await deps.propose("watch", i.lot_id, {
        ...(i.max_bid !== undefined
          ? { maxBid: Math.round(i.max_bid * 100) }
          : {}),
        ...(i.note ? { note: i.note } : {}),
      });
      return {
        proposed: true,
        action_id: a.id,
        note: "Shown as a card; waiting for the person to confirm.",
      };
    },
  }),
  tool({
    name: "search_lots",
    description:
      "Search the lots open for bidding now (typo-tolerant, like the app's search). Filter by location, auction code (e.g. \"HGA#288\"), top-level category, the highest next bid you'd consider (dollars), and when they close. An empty query lists everything matching the filters. Returns current and next bids, all-in at the next bid, closing time and, for runs of near-identical lots closing together, the lot's place in its run.",
    input: z.object({
      query: z.string().max(80),
      location: LOCATION.optional(),
      auction: z.string().max(40).optional(),
      category: z.string().max(60).optional(),
      max_next_bid: z.number().positive().optional(),
      closes: z.enum(["hour", "today", "tomorrow", "week"]).optional(),
      sort: z
        .enum(["relevance", "ending", "price-asc", "price-desc"])
        .optional(),
      limit: z.number().int().min(1).max(25).optional(),
    }),
    label: (i) =>
      i.query ? `Searching lots for “${i.query}”` : "Browsing lots",
    run: async (i, deps) => {
      const now = deps.now();
      const { lots } = await deps.catalogue();
      const res = engineFor(lots).search({
        q: i.query,
        now,
        filters: {
          ...(i.location ? { location: [i.location] } : {}),
          ...(i.auction ? { auction: [i.auction.toUpperCase()] } : {}),
          ...(i.category ? { category: [i.category] } : {}),
          ...(i.closes ? { ends: [i.closes as EndsBucket] } : {}),
        },
        sort: i.sort as SortKey | undefined,
      });
      const cap = i.max_next_bid !== undefined ? i.max_next_bid * 100 : null;
      const hits = res.hits.filter(
        (h) =>
          cap === null || (h.doc.startingBid ?? h.doc.currentBid ?? 0) <= cap,
      );
      return {
        total: hits.length,
        showing: Math.min(hits.length, i.limit ?? 10),
        lots: hits.slice(0, i.limit ?? 10).map(({ doc: d, run }) => ({
          id: d.id,
          title: d.title,
          link: `/lots/${d.id}`,
          location: d.location,
          auction: d.auction,
          category: d.category,
          condition: d.condition,
          current_bid: dollars(d.currentBid),
          next_bid: dollars(d.startingBid),
          all_in_at_next_bid:
            d.startingBid === null
              ? null
              : dollars(allIn(d.startingBid, ratesOfLot(d.rates))),
          closes: d.endAt ? formatWhen(new Date(d.endAt), now) : null,
          closes_in:
            d.endAt && Date.parse(d.endAt) > +now
              ? formatCountdown(Date.parse(d.endAt) - +now)
              : "closing",
          run: run
            ? `#${run.position} of ${run.size} similar closing that evening`
            : null,
        })),
      };
    },
  }),
] as const;

/** Tool definitions for the API, in a fixed order (they're part of the cached prefix). */
export const TOOL_DEFINITIONS: Anthropic.Beta.BetaTool[] = SPECS.map((t) => {
  const { $schema: _drop, ...schema } = z.toJSONSchema(t.input) as Record<
    string,
    unknown
  >;
  return {
    name: t.name,
    description: t.description,
    input_schema: {
      ...schema,
      type: "object",
    } as Anthropic.Beta.BetaTool.InputSchema,
    // Inputs stream as they're generated; the loop validates every input before running it.
    eager_input_streaming: true,
  };
}).sort((a, b) => a.name.localeCompare(b.name));

const BY_NAME = new Map<string, (typeof SPECS)[number]>(
  SPECS.map((t) => [t.name, t]),
);

/** A short label for the chat while a tool runs. */
export function toolLabel(name: string, input: unknown): string {
  const t = BY_NAME.get(name);
  if (!t) return name;
  const parsed = t.input.safeParse(input);
  return parsed.success
    ? (t.label as (i: unknown) => string)(parsed.data)
    : t.name.replace(/_/g, " ");
}

/**
 * Run one tool call. Input is untrusted model output: validated against the tool's schema first
 * (eager input streaming means the API no longer validates it). Returns the tool_result block.
 */
export async function runTool(
  block: { id: string; name: string; input: unknown },
  deps: ToolDeps,
): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const t = BY_NAME.get(block.name);
  if (!t)
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: `Unknown tool ${block.name}.`,
    };
  const parsed = t.input.safeParse(block.input);
  if (!parsed.success)
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: JSON.stringify({ INVALID_JSON: JSON.stringify(block.input) }),
    };
  try {
    const out = await (t.run as (i: unknown, d: ToolDeps) => Promise<unknown>)(
      parsed.data,
      deps,
    );
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(out),
    };
  } catch (e) {
    return {
      type: "tool_result",
      tool_use_id: block.id,
      is_error: true,
      content: `Tool failed: ${String((e as Error).message).slice(0, 200)}`,
    };
  }
}
