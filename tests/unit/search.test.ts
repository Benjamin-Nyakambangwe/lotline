import { describe, expect, it } from "vitest";
import {
  type CatalogueDoc,
  CatalogueSearch,
  dayBounds,
  highlightParts,
} from "@/lib/search/engine";
import { computeRuns, runKey } from "@/lib/search/runs";

const NOW = new Date("2026-11-06T14:00:00Z"); // Fri 16:00 in Harare
let nid = 1;
const doc = (title: string, o: Partial<CatalogueDoc> = {}): CatalogueDoc => ({
  id: nid++,
  type: 1,
  lotNumber: null,
  title,
  location: "Harare",
  auction: null,
  category: "Electronics",
  subCategory: null,
  finalCategory: null,
  condition: "As Is",
  currentBid: null,
  startingBid: 1000,
  endAt: new Date(NOW.getTime() + 3 * 3600_000 + nid * 60_000).toISOString(),
  extended: false,
  stc: false,
  quantity: 1,
  thumbUrl: null,
  photos: 0,
  cpu: null,
  rates: null,
  ...o,
});

const docs: CatalogueDoc[] = [
  ...Array.from({ length: 5 }, (_, i) =>
    doc("Dell OptiPlex 7060 Micro Desktop", {
      cpu: "i5 · 8th gen",
      currentBid: 3000 + i * 1000,
    }),
  ),
  doc("Dell OptiPlex 7060 Micro Form Factor PC", {
    id: 795334,
    lotNumber: 261008550,
  }),
  doc("Dell OptiPlex 7070 Micro PC", { startingBid: 6000 }),
  doc("Cisco Catalyst 2960-X Series Network Switch", { location: "Bulawayo" }),
  doc("TP-Link Omada WiFi Access Points"),
  doc("Four Piece Deep Red Upholstered Lounge Suite", {
    category: "Furniture",
  }),
  doc("Defy Refrigerator 300L", {
    category: "Home & Garden",
    startingBid: 15000,
  }),
  doc("Lot of 8 Black Lead-Acid Batteries", {
    category: "Hardware",
    endAt: new Date(NOW.getTime() + 40 * 60_000).toISOString(),
  }),
];
const engine = new CatalogueSearch(docs, "Africa/Harare");
const titles = (
  q: string,
  o: Parameters<CatalogueSearch["search"]>[0] = { q },
) => engine.search({ now: NOW, ...o, q }).hits.map((h) => h.doc.title);

describe("instant search", () => {
  it("tolerates typos", () => {
    expect(titles("optiplx")[0]).toMatch(/OptiPlex/);
    expect(titles("catalist")[0]).toMatch(/Catalyst/);
  });

  it("matches the word being typed as a prefix", () => {
    expect(titles("opti").length).toBe(7);
    expect(titles("refrig")[0]).toMatch(/Refrigerator/);
  });

  it("understands synonyms and plurals", () => {
    expect(titles("fridge")).toEqual(["Defy Refrigerator 300L"]);
    expect(titles("couch")).toEqual([
      "Four Piece Deep Red Upholstered Lounge Suite",
    ]);
    expect(titles("battery")[0]).toMatch(/Batteries/);
    expect(titles("wireless access point")[0]).toMatch(/Omada/);
  });

  it("requires every word, so model numbers narrow results", () => {
    const r = titles("optiplex 7060");
    expect(r).toHaveLength(6);
    expect(r.every((t) => t.includes("7060"))).toBe(true);
  });

  it("falls back to any word when nothing matches them all, and says so", () => {
    const r = engine.search({ q: "optiplex sandwich", now: NOW });
    expect(r.mode).toBe("any");
    expect(r.total).toBeGreaterThan(0);
  });

  it("jumps to a lot by Id, ABC lot number, or pasted link", () => {
    expect(engine.search({ q: "261008550", now: NOW }).jump?.id).toBe(795334);
    expect(engine.search({ q: "795334", now: NOW }).jump?.id).toBe(795334);
    expect(
      engine.search({
        q: "https://app.abcauctions.co.zw/home(dialog:lot/1/795334)",
        now: NOW,
      }).jump?.id,
    ).toBe(795334);
  });

  it("sorts by closing time when browsing, and by relevance when searching", () => {
    expect(titles("")[0]).toMatch(/Batteries/);
    expect(
      engine.search({ q: "", now: NOW, sort: "price-desc" }).hits[0].doc.title,
    ).toMatch(/Refrigerator/);
  });
});

describe("facets", () => {
  it("counts each facet as if its own selection were cleared (disjunctive)", () => {
    const r = engine.search({
      q: "",
      now: NOW,
      filters: { location: ["Harare"] },
    });
    expect(r.total).toBe(docs.length - 1);
    const loc = Object.fromEntries(
      r.facets.location.map((b) => [b.value, b.count]),
    );
    expect(loc).toEqual({ Harare: docs.length - 1, Bulawayo: 1 });
    const cat = Object.fromEntries(
      r.facets.category.map((b) => [b.value, b.count]),
    );
    expect(cat.Electronics).toBe(8);
  });

  it("buckets closing time and price", () => {
    const r = engine.search({ q: "", now: NOW });
    const ends = Object.fromEntries(
      r.facets.ends.map((b) => [b.value, b.count]),
    );
    expect(ends.hour).toBe(1);
    expect(ends.today).toBe(docs.length - 1);
    expect(
      engine
        .search({ q: "", now: NOW, filters: { price: ["50-200"] } })
        .hits.map((h) => h.doc.title),
    ).toEqual(["Dell OptiPlex 7070 Micro PC", "Defy Refrigerator 300L"]);
  });

  it("splits 'today' and 'tomorrow' at midnight in Harare", () => {
    const now = new Date("2026-11-06T21:30:00Z"); // Fri 23:30 in Harare
    const e = new CatalogueSearch(
      [
        doc("a", { endAt: "2026-11-07T00:00:00Z" }), // Sat 02:00
        doc("b", { endAt: "2026-11-07T21:59:00Z" }), // Sat 23:59
        doc("c", { endAt: "2026-11-07T22:01:00Z" }), // Sun 00:01
      ],
      "Africa/Harare",
    );
    const ends = Object.fromEntries(
      e.search({ q: "", now }).facets.ends.map((b) => [b.value, b.count]),
    );
    expect(ends).toEqual({ tomorrow: 2, week: 1 });
    expect(dayBounds(now, "Africa/Harare").endOfToday).toBe(
      Date.parse("2026-11-06T22:00:00Z"),
    );
  });

  it("filters by auction", () => {
    const e = new CatalogueSearch(
      [
        doc("Office chair", { auction: "HGA#288" }),
        doc("Office desk", { auction: "HGA#288" }),
        doc("Office chair, red", { auction: "BGA#240", location: "Bulawayo" }),
      ],
      "Africa/Harare",
    );
    const r = e.search({
      q: "office",
      now: NOW,
      filters: { auction: ["HGA#288"] },
    });
    expect(r.hits.map((h) => h.doc.title).sort()).toEqual([
      "Office chair",
      "Office desk",
    ]);
    expect(
      Object.fromEntries(r.facets.auction.map((b) => [b.value, b.count])),
    ).toEqual({ "HGA#288": 2, "BGA#240": 1 });
  });
});

describe("highlighting", () => {
  it("marks the words that matched, including plurals", () => {
    const hit = engine.search({ q: "battery", now: NOW }).hits[0];
    const parts = highlightParts(hit.doc.title, hit.matched);
    expect(parts.filter((p) => p.hit).map((p) => p.text)).toEqual([
      "Batteries",
    ]);
  });
});

describe("runs", () => {
  it("groups the same model regardless of form-factor words", () => {
    expect(runKey("Dell OptiPlex 7060 Micro Desktop")).toBe(
      runKey("Dell OptiPlex 7060 Micro Form Factor PC"),
    );
    expect(runKey("Dell OptiPlex 7060 Micro Tower")).toBe("optiplex 7060");
    expect(runKey("Cisco Catalyst 2960-X Series Network Switch")).toBe(
      "catalyst 2960",
    );
    expect(runKey("TP-Link Omada WiFi Access Points")).toBe("tp link omada");
  });

  it("gives each lot its position in tonight's run", () => {
    const runs = computeRuns(docs, "Africa/Harare");
    const sevenSixty = docs.filter((d) => d.title.includes("7060"));
    const positions = sevenSixty.map((d) => runs.get(d.id));
    expect(positions.every((p) => p?.size === 6)).toBe(true);
    expect(positions.map((p) => p?.position)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(positions[0]?.after).toBe(5);
    expect(runs.get(docs[docs.length - 1].id)).toBeUndefined();
  });
});

describe("speed", () => {
  it("searches 2,500 lots in a few milliseconds (best of repeated runs)", () => {
    const many = Array.from({ length: 2500 }, (_, i) =>
      doc(
        `${["Dell OptiPlex", "HP EliteDesk", "Lenovo ThinkCentre", "Defy Fridge", "Office Chair"][i % 5]} ${7000 + (i % 90)} unit ${i}`,
      ),
    );
    const big = new CatalogueSearch(many, "Africa/Harare");
    for (const q of ["opti", "elitedsk", "chair 70", "fridge"]) {
      big.search({ q, now: NOW });
      const ts: number[] = [];
      for (let i = 0; i < 9; i++) {
        const t0 = performance.now();
        big.search({ q, now: NOW });
        ts.push(performance.now() - t0);
      }
      ts.sort((a, b) => a - b);
      // ~1–3 ms on a laptop. Judge the fastest run: it measures the search, not whatever
      // else the machine is doing (the slow version this guards against took ~47 ms at best).
      expect(ts[0]).toBeLessThan(25);
    }
  });
});
