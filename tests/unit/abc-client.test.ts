import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Breaker } from "@/lib/abc/breaker";
import { AbcClient, AbcError } from "@/lib/abc/client";
import { Limiter } from "@/lib/abc/limiter";
import { lotUrl, parseLotRef, thumbOf } from "@/lib/abc/urls";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "..", "fixtures", "abc", name),
      "utf8",
    ),
  );

type Reply = {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
};

function fakeFetch(replies: Reply[]) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = replies[Math.min(i++, replies.length - 1)];
    const isJson =
      !r.headers?.["content-type"] ||
      r.headers["content-type"].includes("json");
    return new Response(
      isJson ? JSON.stringify(r.body ?? {}) : String(r.body ?? ""),
      {
        status: r.status ?? 200,
        headers: { "content-type": "application/json", ...r.headers },
      },
    );
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function client(
  replies: Reply[],
  extra: Partial<ConstructorParameters<typeof AbcClient>[0]> = {},
) {
  const f = fakeFetch(replies);
  const sleep = vi.fn(async (_ms: number) => {});
  const c = new AbcClient({
    fetch: f.fn,
    sleep,
    random: () => 0,
    limiter: new Limiter({ concurrency: 6, ratePerSec: 1000, burst: 100 }),
    ...extra,
  });
  return { c, sleep, calls: f.calls };
}

describe("AbcClient parsing", () => {
  it("normalises a lot detail into cents, dates, categories and fees", async () => {
    const { c } = client([{ body: fixture("detail-open.json") }]);
    const d = await c.detail(800829);
    expect(d.id).toBe(800829);
    expect(d.levy).toBe(0.175);
    expect(d.vat).toBe(0.155);
    expect(d.lotVat).toBe(0);
    expect(d.category).toBe("Toys & Games");
    expect(d.gallery.length).toBeGreaterThan(0);
    expect(d.gallery[0].thumb).toMatch(/-Thumb\.jpg$/);
    expect(d.destinations.find((x) => x.title === "Bulawayo")?.price).toBe(100);
    expect(d.viewing?.subtitle).toBe("Goods Warehouse");
    expect(d.endAt).toBeInstanceOf(Date);
  });

  it("reads the closed lot we bought: $60 hammer, Status 2", async () => {
    const { c } = client([{ body: fixture("detail-closed-795373.json") }]);
    const d = await c.detail(795373);
    expect(d.currentBid).toBe(6000);
    expect(d.status).toBe(2);
  });

  it("accepts the { Data: ... } wrapper too", async () => {
    const { c } = client([{ body: { Data: fixture("detail-open.json") } }]);
    expect((await c.detail(800829)).id).toBe(800829);
  });

  it("validates each search item on its own and counts the bad ones", async () => {
    const page = fixture("search-available-page1.json");
    page.List.push({ Id: "not-a-number", Title: 5 });
    const { c } = client([{ body: page }]);
    const res = await c.search({ size: 12 });
    expect(res.items).toHaveLength(12);
    expect(res.invalid).toBe(1);
    expect(res.cursor).toBeTruthy();
    expect(res.facets.length).toBeGreaterThan(0);
  });

  it("follows cursors and stops when the cursor runs out", async () => {
    const p1 = {
      List: [{ Id: 1, Title: "a" }],
      Meta: { Count: 2, Cursor: "c1", Facets: [] },
    };
    const p2 = {
      List: [{ Id: 2, Title: "b" }],
      Meta: { Count: 2, Cursor: null, Facets: [] },
    };
    const { c, calls } = client([{ body: p1 }, { body: p2 }]);
    const ids: number[] = [];
    for await (const page of c.searchAll({}))
      ids.push(...page.items.map((x) => x.id));
    expect(ids).toEqual([1, 2]);
    expect(calls[1].url).toContain("Cursor=c1");
  });

  it("resolves an invoice lot number to a lot id", async () => {
    const body = {
      List: [{ Id: 795334, Title: "OptiPlex", LotNumber: 261008550 }],
      Meta: { Count: 1, Facets: [] },
    };
    const { c, calls } = client([{ body }]);
    expect(await c.resolveLotNumber(261008550)).toBe(795334);
    expect(calls[0].url).toContain("Query=261008550");
  });

  it("sends a generic User-Agent and nothing personal", async () => {
    const { c, calls } = client([{ body: fixture("detail-open.json") }]);
    await c.detail(1);
    expect(calls[0].headers["User-Agent"]).toBe("Mozilla/5.0");
    expect(JSON.stringify(calls[0].headers)).not.toContain("@");
  });
});

describe("AbcClient resilience", () => {
  it("honours Retry-After on 429 and then succeeds", async () => {
    const { c, sleep } = client([
      { status: 429, headers: { "retry-after": "2" } },
      { body: fixture("detail-open.json") },
    ]);
    await expect(c.detail(1)).resolves.toMatchObject({ id: 800829 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("backs off exponentially on 5xx and gives up after the retries", async () => {
    const { c, sleep, calls } = client([{ status: 502 }]);
    await expect(c.detail(1)).rejects.toMatchObject({
      kind: "http",
      status: 502,
    });
    expect(calls).toHaveLength(4);
    expect(sleep.mock.calls.map((x) => x[0])).toEqual([2000, 4000, 8000]);
  });

  it("treats 403 and HTML challenge pages as blocked, without retrying", async () => {
    const a = client([{ status: 403 }]);
    await expect(a.c.detail(1)).rejects.toMatchObject({ kind: "blocked" });
    expect(a.calls).toHaveLength(1);
    const b = client([
      {
        status: 200,
        body: "<html>challenge</html>",
        headers: { "content-type": "text/html" },
      },
    ]);
    await expect(b.c.detail(1)).rejects.toMatchObject({ kind: "blocked" });
  });

  it("opens the breaker after repeated failures and stops calling ABC", async () => {
    const { c, calls } = client([{ status: 403 }], { maxRetries: 0 });
    for (let i = 0; i < 5; i++)
      await expect(c.detail(i)).rejects.toBeInstanceOf(AbcError);
    expect(c.breaker.state).toBe("open");
    await expect(c.detail(9)).rejects.toMatchObject({ kind: "breaker" });
    expect(calls).toHaveLength(5);
  });

  it("treats 'no such lot' (400/404) as a healthy answer: no retry, breaker stays closed", async () => {
    const { c, calls } = client([{ status: 400, body: { Message: "bad" } }]);
    for (let i = 0; i < 20; i++)
      await expect(c.detail(i)).rejects.toMatchObject({
        kind: "http",
        status: 400,
      });
    expect(calls).toHaveLength(20);
    expect(c.breaker.state).toBe("closed");
  });

  it("enforces the daily cap except for hot lots", async () => {
    const { c } = client([{ body: fixture("detail-open.json") }], {
      dailyCap: 2,
    });
    await c.detail(1, 1, "warm");
    await c.detail(2, 1, "sync");
    await expect(c.detail(3, 1, "warm")).rejects.toMatchObject({ kind: "cap" });
    await expect(c.detail(4, 1, "hot")).resolves.toBeTruthy();
  });

  it("refuses everything when polling is disabled", async () => {
    const { c, calls } = client([{ body: {} }], { enabled: false });
    await expect(c.detail(1)).rejects.toMatchObject({ kind: "disabled" });
    expect(calls).toHaveLength(0);
  });
});

describe("lot links and references", () => {
  it("builds bid links by type", () => {
    expect(lotUrl(795373)).toBe(
      "https://app.abcauctions.co.zw/home(dialog:lot/1/795373)",
    );
    expect(lotUrl(23551, 2)).toBe(
      "https://app.abcauctions.co.zw/home(dialog:lot/2/23551)",
    );
  });
  it("parses pasted links, ids and invoice lot numbers", () => {
    expect(
      parseLotRef("https://app.abcauctions.co.zw/home(dialog:lot/1/795373)"),
    ).toEqual({ kind: "id", type: 1, id: 795373 });
    expect(parseLotRef("https://app.abcauctions.co.zw/lot/2/23551")).toEqual({
      kind: "id",
      type: 2,
      id: 23551,
    });
    expect(parseLotRef("795334")).toEqual({ kind: "id", id: 795334 });
    expect(parseLotRef("261008550")).toEqual({
      kind: "lotNumber",
      lotNumber: 261008550,
    });
    expect(parseLotRef("optiplex")).toBeNull();
  });
  it("derives thumbnails", () => {
    expect(thumbOf("https://cdn-s3.abcauctions.co.zw/a/a-Zoom.jpg")).toBe(
      "https://cdn-s3.abcauctions.co.zw/a/a-Thumb.jpg",
    );
  });
});

describe("Breaker", () => {
  it("opens, half-opens for one probe, and closes on success", () => {
    let t = 0;
    const b = new Breaker({ now: () => t, openMs: 1000 });
    for (let i = 0; i < 5; i++) b.onFailure();
    expect(b.canRequest()).toBe(false);
    t = 1000;
    expect(b.state).toBe("half-open");
    expect(b.canRequest()).toBe(true);
    expect(b.canRequest()).toBe(false);
    b.onSuccess();
    expect(b.state).toBe("closed");
  });
  it("re-opens when the probe fails, and opens on a high failure rate", () => {
    let t = 0;
    const b = new Breaker({ now: () => t, openMs: 1000 });
    for (let i = 0; i < 5; i++) b.onFailure();
    t = 1000;
    b.canRequest();
    b.onFailure();
    expect(b.state).toBe("open");
    const r = new Breaker({ now: () => 0 });
    // 10 samples, 7 failures, never 5 in a row: the rate check trips on the last failure.
    for (let i = 0; i < 10; i++) i % 3 === 2 ? r.onSuccess() : r.onFailure();
    expect(r.state).toBe("open");
  });
});

describe("Limiter", () => {
  const flush = () => new Promise((r) => setImmediate(r));

  it("respects the rate and burst", async () => {
    let t = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const l = new Limiter({
      concurrency: 10,
      ratePerSec: 2,
      burst: 2,
      now: () => t,
      setTimer: (fn, ms) => timers.push({ at: t + ms, fn }),
    });
    let started = 0;
    for (let i = 0; i < 5; i++) l.schedule(async () => void started++);
    await flush();
    expect(started).toBe(2);
    const advance = async (ms: number) => {
      t += ms;
      for (const tm of timers.splice(0).filter((x) => x.at <= t)) tm.fn();
      await flush();
    };
    await advance(500);
    expect(started).toBe(3);
    await advance(500);
    expect(started).toBe(4);
  });

  it("caps concurrency", async () => {
    const l = new Limiter({ concurrency: 2, ratePerSec: 100, burst: 100 });
    for (let i = 0; i < 4; i++) l.schedule(() => new Promise(() => {}));
    await flush();
    expect(l.inFlight).toBe(2);
    expect(l.queued).toBe(2);
  });

  it("serves hot lots before catalogue sync", async () => {
    const l = new Limiter({ concurrency: 1, ratePerSec: 100, burst: 100 });
    let release!: () => void;
    const order: string[] = [];
    l.schedule(() => new Promise<void>((r) => (release = r)));
    l.schedule(async () => void order.push("sync"), "sync");
    l.schedule(async () => void order.push("hot"), "hot");
    await flush();
    release();
    await flush();
    await flush();
    expect(order).toEqual(["hot", "sync"]);
  });
});
