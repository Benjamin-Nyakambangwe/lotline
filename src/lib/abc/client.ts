import { Breaker } from "./breaker";
import { Limiter, type Priority } from "./limiter";
import {
  type LotDetailRow,
  type LotListRow,
  normalizeDetail,
  normalizeListItem,
} from "./normalize";
import {
  type AbcFacet,
  detailSchema,
  listItemSchema,
  searchEnvelopeSchema,
  unwrap,
} from "./schemas";

/**
 * The only module that talks to ABC. Used by the worker; the web app never imports it
 * (enforced by a lint rule). Every request goes through one Limiter and one Breaker.
 */

export type AbcErrorKind =
  | "http"
  | "timeout"
  | "network"
  | "parse"
  | "blocked"
  | "breaker"
  | "cap"
  | "disabled";

export class AbcError extends Error {
  constructor(
    message: string,
    readonly kind: AbcErrorKind,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AbcError";
  }
}

export interface SearchParams {
  size?: number;
  query?: string;
  facets?: Record<string, string[]>;
  cursor?: string | null;
  /** server sort; we always re-sort locally (see docs/abc-api.md) */
  sort?: number;
}

export interface SearchPage {
  items: LotListRow[];
  /** list items that failed validation and were skipped */
  invalid: number;
  count: number;
  cursor: string | null;
  facets: AbcFacet[];
}

export interface RequestInfo {
  path: string;
  priority: Priority;
  status: number | "error";
  ms: number;
  attempt: number;
}

export interface AbcClientOptions {
  baseUrl?: string;
  userAgent?: string;
  fetch?: typeof fetch;
  limiter?: Limiter;
  breaker?: Breaker;
  timeoutMs?: number;
  maxRetries?: number;
  /** requests per UTC day before only "hot" requests are allowed */
  dailyCap?: number;
  enabled?: boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
  onRequest?: (info: RequestInfo) => void;
}

const DEFAULT_BASE = "https://app-api.abcauctions.co.zw/lots";

export class AbcClient {
  readonly limiter: Limiter;
  readonly breaker: Breaker;
  private readonly o: Required<
    Omit<AbcClientOptions, "limiter" | "breaker" | "onRequest">
  > &
    Pick<AbcClientOptions, "onRequest">;
  private day = "";
  private dayCount = 0;

  constructor(opts: AbcClientOptions = {}) {
    this.limiter =
      opts.limiter ?? new Limiter({ concurrency: 6, ratePerSec: 3, burst: 6 });
    this.breaker = opts.breaker ?? new Breaker();
    this.o = {
      baseUrl: DEFAULT_BASE,
      userAgent: "Mozilla/5.0",
      fetch: globalThis.fetch.bind(globalThis),
      timeoutMs: 20_000,
      maxRetries: 3,
      dailyCap: 40_000,
      enabled: true,
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: Date.now,
      random: Math.random,
      ...opts,
    };
  }

  get requestsToday() {
    return this.dayCount;
  }

  async search(
    params: SearchParams,
    priority: Priority = "sync",
  ): Promise<SearchPage> {
    const q = new URLSearchParams();
    q.set("Size", String(params.size ?? 500));
    q.set("Sort", String(params.sort ?? 0));
    if (params.query) q.set("Query", params.query);
    if (params.facets) q.set("FacetJson", JSON.stringify(params.facets));
    if (params.cursor) q.set("Cursor", params.cursor);
    const raw = await this.request(`search?${q.toString()}`, priority);
    const env = searchEnvelopeSchema.safeParse(unwrap(raw));
    if (!env.success)
      throw new AbcError("search response had an unexpected shape", "parse");
    let invalid = 0;
    const items: LotListRow[] = [];
    for (const it of env.data.List) {
      const parsed = listItemSchema.safeParse(it);
      if (parsed.success) items.push(normalizeListItem(parsed.data));
      else invalid++;
    }
    return {
      items,
      invalid,
      count: env.data.Meta.Count,
      cursor: env.data.Meta.Cursor ?? null,
      facets: env.data.Meta.Facets ?? [],
    };
  }

  /** Walk every page of a search, following the cursor, with a page guard. */
  async *searchAll(
    params: SearchParams,
    { maxPages = 40, priority = "sync" as Priority } = {},
  ) {
    let cursor = params.cursor ?? null;
    const seen = new Set<string>();
    for (let page = 0; page < maxPages; page++) {
      const res = await this.search({ ...params, cursor }, priority);
      yield res;
      if (!res.cursor || res.items.length === 0 || seen.has(res.cursor)) return;
      seen.add(res.cursor);
      cursor = res.cursor;
    }
  }

  async detail(
    id: number,
    type = 1,
    priority: Priority = "warm",
  ): Promise<LotDetailRow> {
    const raw = await this.request(`detail?id=${id}&type=${type}`, priority);
    const parsed = detailSchema.safeParse(unwrap(raw));
    if (!parsed.success)
      throw new AbcError(`detail ${id} had an unexpected shape`, "parse");
    return normalizeDetail(parsed.data);
  }

  /** Resolve an ABC lot number (as printed on invoices) to a lot Id, across all statuses. */
  async resolveLotNumber(
    lotNumber: number,
    priority: Priority = "ondemand",
  ): Promise<number | null> {
    const res = await this.search(
      { size: 5, query: String(lotNumber) },
      priority,
    );
    return res.items.find((x) => x.lotNumber === lotNumber)?.id ?? null;
  }

  private countRequest(priority: Priority) {
    const today = new Date(this.o.now()).toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.dayCount = 0;
    }
    if (this.dayCount >= this.o.dailyCap && priority !== "hot") {
      throw new AbcError("daily request cap reached", "cap");
    }
    this.dayCount++;
  }

  private async request(path: string, priority: Priority): Promise<unknown> {
    if (!this.o.enabled)
      throw new AbcError("ABC polling is disabled", "disabled");
    let lastErr: AbcError | undefined;
    for (let attempt = 1; attempt <= this.o.maxRetries + 1; attempt++) {
      if (!this.breaker.canRequest())
        throw new AbcError("circuit breaker is open", "breaker");
      this.countRequest(priority);
      const result = await this.limiter.schedule(
        () => this.once(path, priority, attempt),
        priority,
      );
      if (result.ok) {
        this.breaker.onSuccess();
        return result.body;
      }
      if (
        result.error.kind === "http" &&
        !result.retryable &&
        (result.error.status ?? 500) < 500
      ) {
        // A clean "no such lot" (ABC answers 400 for unknown IDs): the API is healthy, so this
        // must not count against the breaker, or a run of missing IDs would stop live polling.
        this.breaker.onSuccess();
        throw result.error;
      }
      this.breaker.onFailure();
      lastErr = result.error;
      if (!result.retryable || attempt > this.o.maxRetries) break;
      const backoff =
        result.retryAfterMs ?? Math.min(300_000, 2000 * 2 ** (attempt - 1));
      await this.o.sleep(backoff + Math.floor(this.o.random() * 500));
    }
    throw lastErr ?? new AbcError("request failed", "network");
  }

  private async once(
    path: string,
    priority: Priority,
    attempt: number,
  ): Promise<
    | { ok: true; body: unknown }
    | { ok: false; error: AbcError; retryable: boolean; retryAfterMs?: number }
  > {
    const t0 = this.o.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    const report = (status: number | "error") =>
      this.o.onRequest?.({
        path,
        priority,
        status,
        ms: this.o.now() - t0,
        attempt,
      });
    try {
      const res = await this.o.fetch(`${this.o.baseUrl}/${path}`, {
        headers: { "User-Agent": this.o.userAgent, Accept: "application/json" },
        signal: ctrl.signal,
      });
      report(res.status);
      const type = res.headers.get("content-type") ?? "";
      if (res.status === 403 || (res.ok && !type.includes("json"))) {
        return {
          ok: false,
          error: new AbcError(`blocked (${res.status})`, "blocked", res.status),
          retryable: false,
        };
      }
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        return {
          ok: false,
          error: new AbcError(`HTTP ${res.status}`, "http", res.status),
          retryable: true,
          retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
        };
      }
      if (!res.ok)
        return {
          ok: false,
          error: new AbcError(`HTTP ${res.status}`, "http", res.status),
          retryable: false,
        };
      try {
        return { ok: true, body: await res.json() };
      } catch {
        return {
          ok: false,
          error: new AbcError("invalid JSON", "parse"),
          retryable: true,
        };
      }
    } catch (e) {
      report("error");
      const timeout = (e as Error)?.name === "AbortError";
      return {
        ok: false,
        error: new AbcError(
          timeout ? "timeout" : String(e),
          timeout ? "timeout" : "network",
        ),
        retryable: true,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
