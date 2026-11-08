import type { AbcClient, SearchPage } from "@/lib/abc/client";
import type { LotListRow } from "@/lib/abc/normalize";
import type { Db } from "@/lib/db/client";
import { runningAuctionNames, upsertAuction } from "@/lib/db/queries/auctions";
import type { Logger } from "../log";

/** ABC returns at most this many values per facet. */
const FACET_CAP = 10;
/** Dimensions to split by when an auction list is cut off at the cap. */
const SPLITS = ["location", "lot_type", "category", "condition"] as const;

type Facets = Record<string, string[]>;
const bucketsOf = (page: SearchPage, name: string) =>
  page.facets.find((f) => f.Name === name)?.Buckets ?? [];

/**
 * Every auction with lots on sale. ABC lists at most 10 auctions per query, so when a list is
 * full and doesn't account for every lot, split the query (by location, then lot type, ...)
 * until each part is complete.
 */
export async function discoverAuctions(
  abc: AbcClient,
  base: Facets = { sale_status: ["Available"] },
) {
  const names = new Set<string>();
  let requests = 0;
  let complete = true;
  const walk = async (facets: Facets, dims: readonly string[]) => {
    const page = await abc.search({ size: 1, facets }, "sync");
    requests++;
    const buckets = bucketsOf(page, "campaign");
    for (const b of buckets) names.add(b.Value);
    const listed = buckets.reduce((s, b) => s + b.Count, 0);
    if (buckets.length < FACET_CAP || listed >= page.count) return;
    // Split by the next dimension that has values here (and isn't already filtered).
    const at = dims.findIndex(
      (d) => !facets[d] && bucketsOf(page, d).length > 0,
    );
    if (at < 0) {
      complete = false;
      return;
    }
    const dim = dims[at];
    for (const b of bucketsOf(page, dim))
      await walk({ ...facets, [dim]: [b.Value] }, dims.slice(at + 1));
  };
  await walk(base, SPLITS);
  return { names: [...names], requests, complete };
}

/**
 * Find every auction on sale and tag its lots. Cheap in steady state (~20 requests): re-read the
 * auctions we already know plus the top ones ABC lists; only when that leaves lots untagged,
 * run the full discovery to find the rest.
 */
export async function syncAuctions(db: Db, abc: AbcClient, log: Logger) {
  const started = Date.now();
  const base = { sale_status: ["Available"] };
  const root = await abc.search({ size: 1, facets: base }, "sync");
  let requests = 1;
  const seen = new Set<number>();
  const done = new Set<string>();
  let tagged = 0;
  const readAuction = async (name: string) => {
    done.add(name);
    const items: LotListRow[] = [];
    for await (const page of abc.searchAll(
      { size: 500, facets: { ...base, campaign: [name] } },
      { maxPages: 6, priority: "sync" },
    )) {
      requests++;
      items.push(...page.items);
    }
    for (const i of items) seen.add(i.id);
    tagged += (await upsertAuction(db, name, items)).tagged;
  };

  const known = new Set([
    ...bucketsOf(root, "campaign").map((b) => b.Value),
    ...(await runningAuctionNames(db)),
  ]);
  for (const name of known) await readAuction(name);
  let discovered = 0;
  if (seen.size < root.count) {
    const found = await discoverAuctions(abc, base);
    requests += found.requests;
    for (const name of found.names)
      if (!done.has(name)) {
        discovered++;
        await readAuction(name);
      }
  }
  log.info(
    {
      auctions: done.size,
      discovered,
      lots: seen.size,
      onSale: root.count,
      complete: seen.size >= root.count,
      tagged,
      requests,
      ms: Date.now() - started,
    },
    "auctions synced",
  );
}
