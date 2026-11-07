import MiniSearch, {
  type SearchResult as MiniResult,
  type Query,
} from "minisearch";
import { parseLotRef } from "../abc/urls";
import { localDate } from "../domain/time";
import { computeRuns, type RunInfo } from "./runs";
import { processTerm, queryTerms, synonymsOf, tokenize } from "./text";

/**
 * Instant, typo-tolerant catalogue search that runs in the browser. The whole open catalogue
 * (~2,500 lots) is indexed on the device, so every keystroke returns in a few milliseconds.
 *
 *  - typo tolerance (1 edit from 4 letters, 2 from 7), prefix matching on the word being typed
 *  - synonyms ("pc" finds desktops), plurals, accents
 *  - field weights: title ≫ category/specs ≫ condition/location
 *  - all words must match; if nothing does, fall back to any word (and say so)
 *  - lot Id / ABC lot number / pasted ABC link → the exact lot
 *  - disjunctive facet counts (each facet ignores its own selection, like Algolia)
 */

export interface CatalogueDoc {
  id: number;
  type: number;
  lotNumber: number | null;
  title: string;
  location: string | null;
  category: string | null;
  subCategory: string | null;
  finalCategory: string | null;
  condition: string | null;
  /** cents */
  currentBid: number | null;
  /** cents: the next minimum bid */
  startingBid: number | null;
  endAt: string | null;
  extended: boolean;
  stc: boolean;
  quantity: number;
  thumbUrl: string | null;
  cpu: string | null;
  /** fee rates if known: [levy, vat, lotVat] */
  rates: [number, number, number] | null;
}

export type EndsBucket = "hour" | "today" | "tomorrow" | "week" | "later";
export type PriceBucket = "u10" | "10-50" | "50-200" | "200-1k" | "1k+";
export type BidsBucket = "none" | "some";

export interface Filters {
  location?: string[];
  category?: string[];
  condition?: string[];
  ends?: EndsBucket[];
  price?: PriceBucket[];
  bids?: BidsBucket[];
}
export type FacetName = keyof Filters;
export const FACETS: FacetName[] = [
  "category",
  "location",
  "ends",
  "price",
  "condition",
  "bids",
];

export type SortKey =
  | "relevance"
  | "ending"
  | "price-asc"
  | "price-desc"
  | "newest";

export interface Hit {
  doc: CatalogueDoc;
  score: number;
  /** processed terms that matched, for highlighting */
  matched: Set<string>;
  run: RunInfo | null;
}

export interface SearchResponse {
  hits: Hit[];
  total: number;
  /** "all": every word matched; "any": fell back to any word; "browse": no query */
  mode: "all" | "any" | "browse";
  /** an exact lot the query refers to (Id, lot number or pasted link) */
  jump: CatalogueDoc | null;
  facets: Record<FacetName, { value: string; count: number }[]>;
  ms: number;
}

const endsBucket = (
  endAt: string | null,
  now: Date,
  tz?: string,
): EndsBucket => {
  if (!endAt) return "later";
  const end = new Date(endAt);
  const left = end.getTime() - now.getTime();
  if (left <= 3600_000) return "hour";
  const today = localDate(now, tz);
  const day = localDate(end, tz);
  if (day === today) return "today";
  const tomorrow = localDate(new Date(now.getTime() + 86_400_000), tz);
  if (day === tomorrow) return "tomorrow";
  return left <= 7 * 86_400_000 ? "week" : "later";
};

const priceBucket = (cents: number | null): PriceBucket => {
  const d = (cents ?? 0) / 100;
  if (d < 10) return "u10";
  if (d < 50) return "10-50";
  if (d < 200) return "50-200";
  if (d < 1000) return "200-1k";
  return "1k+";
};

export class CatalogueSearch {
  private readonly mini: MiniSearch<CatalogueDoc & { specs: string }>;
  private readonly byId = new Map<number, CatalogueDoc>();
  private readonly byLotNumber = new Map<number, CatalogueDoc>();
  readonly runs: Map<number, RunInfo>;

  constructor(
    readonly docs: CatalogueDoc[],
    private readonly tz?: string,
  ) {
    this.mini = new MiniSearch({
      idField: "id",
      fields: [
        "title",
        "finalCategory",
        "subCategory",
        "category",
        "specs",
        "condition",
        "location",
      ],
      tokenize,
      processTerm,
      searchOptions: {
        boost: {
          title: 6,
          finalCategory: 2.5,
          subCategory: 2,
          specs: 2,
          category: 1.2,
          condition: 0.6,
          location: 0.5,
        },
        fuzzy: (term) =>
          term.length < 4 || /^\d+$/.test(term)
            ? false
            : term.length < 7
              ? 1
              : 2,
        prefix: (_term, i, terms) => i === terms.length - 1,
        weights: { fuzzy: 0.4, prefix: 0.8 },
        processTerm,
        tokenize,
      },
    });
    this.mini.addAll(
      docs.map((d) => ({
        ...d,
        specs: [d.cpu ?? "", d.lotNumber ?? ""].join(" "),
      })),
    );
    for (const d of docs) {
      this.byId.set(d.id, d);
      if (d.lotNumber) this.byLotNumber.set(d.lotNumber, d);
    }
    this.runs = computeRuns(docs, tz);
  }

  get(id: number) {
    return this.byId.get(id);
  }

  /** The lot a query points at, if it's an Id, an ABC lot number, or a pasted ABC link. */
  jumpTarget(q: string): CatalogueDoc | null {
    const ref = parseLotRef(q);
    if (!ref) return null;
    return (
      (ref.kind === "id"
        ? this.byId.get(ref.id)
        : this.byLotNumber.get(ref.lotNumber)) ?? null
    );
  }

  private query(terms: string[], combineWith: "AND" | "OR"): Query {
    return {
      combineWith,
      queries: terms.map((t) => {
        const syn = synonymsOf(t);
        return syn.length ? { combineWith: "OR", queries: [t, ...syn] } : t;
      }),
    } as Query;
  }

  search(opts: {
    q: string;
    filters?: Filters;
    sort?: SortKey;
    now?: Date;
    limit?: number;
  }): SearchResponse {
    const t0 = performance.now();
    const now = opts.now ?? new Date();
    const filters = opts.filters ?? {};
    const terms = queryTerms(opts.q);
    const jump = this.jumpTarget(opts.q);

    let mode: SearchResponse["mode"] = "browse";
    let candidates: {
      doc: CatalogueDoc;
      score: number;
      matched: Set<string>;
    }[];
    if (!terms.length) {
      candidates = this.docs.map((doc) => ({
        doc,
        score: 0,
        matched: new Set(),
      }));
    } else {
      let res: MiniResult[] = this.mini.search(this.query(terms, "AND"));
      mode = "all";
      if (!res.length && terms.length > 1) {
        res = this.mini.search(this.query(terms, "OR"));
        mode = "any";
      }
      candidates = res
        .map((r) => ({
          doc: this.byId.get(r.id as number) as CatalogueDoc,
          score: r.score,
          matched: new Set(Object.keys(r.match)),
        }))
        .filter((c) => c.doc);
      if (jump && !candidates.some((c) => c.doc.id === jump.id)) {
        candidates.unshift({
          doc: jump,
          score: Number.MAX_SAFE_INTEGER,
          matched: new Set(),
        });
      }
    }

    // Facet values per doc, computed once.
    const values = (d: CatalogueDoc): Record<FacetName, string> => ({
      category: d.category ?? "Other",
      location: d.location ?? "Unknown",
      condition: d.condition ?? "Unknown",
      ends: endsBucket(d.endAt, now, this.tz),
      price: priceBucket(d.startingBid ?? d.currentBid),
      bids: d.currentBid === null ? "none" : "some",
    });
    const active = FACETS.filter((f) => filters[f]?.length);
    const passes = (v: Record<FacetName, string>, except?: FacetName) =>
      active.every(
        (f) => f === except || (filters[f] as string[]).includes(v[f]),
      );

    const facetCounts = Object.fromEntries(
      FACETS.map((f) => [f, new Map<string, number>()]),
    ) as Record<FacetName, Map<string, number>>;
    const kept: typeof candidates = [];
    for (const c of candidates) {
      const v = values(c.doc);
      if (passes(v)) kept.push(c);
      // Disjunctive counts: each facet counts as if its own selection were cleared.
      for (const f of FACETS)
        if (passes(v, f))
          facetCounts[f].set(v[f], (facetCounts[f].get(v[f]) ?? 0) + 1);
    }

    const sort = opts.sort ?? (terms.length ? "relevance" : "ending");
    const endMs = (d: CatalogueDoc) =>
      d.endAt ? Date.parse(d.endAt) : Number.MAX_SAFE_INTEGER;
    const price = (d: CatalogueDoc) => d.startingBid ?? d.currentBid ?? 0;
    const cmp: Record<
      SortKey,
      (a: (typeof kept)[0], b: (typeof kept)[0]) => number
    > = {
      relevance: (a, b) => b.score - a.score || endMs(a.doc) - endMs(b.doc),
      ending: (a, b) => endMs(a.doc) - endMs(b.doc) || a.doc.id - b.doc.id,
      "price-asc": (a, b) =>
        price(a.doc) - price(b.doc) || endMs(a.doc) - endMs(b.doc),
      "price-desc": (a, b) =>
        price(b.doc) - price(a.doc) || endMs(a.doc) - endMs(b.doc),
      newest: (a, b) => b.doc.id - a.doc.id,
    };
    kept.sort(cmp[sort]);

    const limit = opts.limit ?? kept.length;
    return {
      hits: kept
        .slice(0, limit)
        .map((c) => ({ ...c, run: this.runs.get(c.doc.id) ?? null })),
      total: kept.length,
      mode,
      jump,
      facets: Object.fromEntries(
        FACETS.map((f) => [
          f,
          [...facetCounts[f]]
            .map(([value, count]) => ({ value, count }))
            .sort((a, b) => b.count - a.count),
        ]),
      ) as SearchResponse["facets"],
      ms: performance.now() - t0,
    };
  }
}

/** Split a title into plain and highlighted parts for the words that matched. */
export function highlightParts(
  title: string,
  matched: Set<string>,
): { text: string; hit: boolean; start: number }[] {
  if (!matched.size) return [{ text: title, hit: false, start: 0 }];
  const parts: { text: string; hit: boolean; start: number }[] = [];
  const re = /[\p{L}\p{N}]+|[^\p{L}\p{N}]+/gu;
  for (const m of title.matchAll(re)) {
    const tok = m[0];
    const p = /[\p{L}\p{N}]/u.test(tok) ? processTerm(tok) : null;
    const hit = !!p && matched.has(p);
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += tok;
    else parts.push({ text: tok, hit, start: m.index ?? 0 });
  }
  return parts;
}
