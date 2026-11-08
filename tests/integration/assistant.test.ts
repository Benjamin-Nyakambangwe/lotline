import Anthropic from "@anthropic-ai/sdk";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LotListRow } from "@/lib/abc/normalize";
import { demoStream, fakeMessage, streamOf } from "@/lib/assistant/fake";
import {
  type AssistantEvent,
  buildParams,
  runTurn,
  type StreamFn,
} from "@/lib/assistant/run";
import type { ToolDeps } from "@/lib/assistant/tools";
import { type ActionView, transcript } from "@/lib/assistant/transcript";
import {
  allowance,
  appendMessages,
  createConversation,
  decideAction,
  listActions,
  loadMessages,
  proposeAction,
  recordUsage,
  watchedLots,
} from "@/lib/db/queries/assistant";
import { upsertClosedFromList } from "@/lib/db/queries/closed";
import { upsertListRows } from "@/lib/db/queries/lots";
import { findClosedLots } from "@/lib/db/queries/market";
import * as schema from "@/lib/db/schema";
import type { LotView } from "@/lib/lot-view";
import type { CatalogueDoc } from "@/lib/search/engine";

const pg = new PGlite({ extensions: { pg_trgm } });
const db = drizzle(pg, { schema });

const row = (
  id: number,
  title: string,
  over: Partial<LotListRow> = {},
): LotListRow => ({
  id,
  type: 1,
  title,
  photoUrl: null,
  thumbUrl: null,
  lotNumber: null,
  location: "Harare",
  currency: "USD",
  startingBid: 5000,
  openingBid: 1000,
  currentBid: 4000,
  currentBidderId: null,
  startAt: null,
  endAt: new Date(Date.now() + 86_400_000),
  status: 1,
  saleStatus: 1,
  stc: false,
  auctionLotId: null,
  ...over,
});

const doc = (r: LotListRow): CatalogueDoc => ({
  id: r.id,
  type: 1,
  lotNumber: null,
  title: r.title,
  location: r.location,
  auction: "HGA#288",
  category: "Electronics",
  subCategory: null,
  finalCategory: null,
  condition: "As Is",
  currentBid: r.currentBid,
  startingBid: r.startingBid,
  endAt: r.endAt?.toISOString() ?? null,
  extended: false,
  stc: false,
  quantity: 1,
  thumbUrl: null,
  cpu: null,
  rates: null,
});

const OPEN = [
  row(1, "Dell OptiPlex 7060 Micro Desktop"),
  row(2, "Dell OptiPlex 7070 Micro PC"),
  row(3, "Defy Refrigerator 300L"),
];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  await db.insert(schema.user).values([
    { id: "u1", name: "Tendai", email: "u1@lotline.test" },
    { id: "u2", name: "Friend", email: "u2@lotline.test" },
  ]);
  await upsertListRows(db, OPEN, new Set());
});
afterAll(async () => {
  await pg.close();
});

describe("conversations and allowance", () => {
  it("stores messages in order, exactly as given", async () => {
    const c = await createConversation(db, "u1", "Fridges");
    await appendMessages(db, c, [{ role: "user", content: "hi" }]);
    await appendMessages(db, c, [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
    expect(await loadMessages(db, c)).toEqual([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "", signature: "sig" },
          { type: "text", text: "Hello" },
        ],
      },
    ]);
  });

  it("adds up this month's spend against a $10 default cap", async () => {
    await recordUsage(db, {
      userId: "u2",
      conversationId: null,
      model: "claude-opus-5-5",
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costMicros: 250_000, // 25¢
    });
    expect(await allowance(db, "u2")).toEqual({
      capCents: 1000,
      spentCents: 25,
      leftCents: 975,
    });
  });
});

describe("proposed changes", () => {
  it("does nothing until confirmed, then watches the lot with the max bid; only the owner decides, once", async () => {
    const c = await createConversation(db, "u1", "Watch");
    const a = await proposeAction(db, {
      userId: "u1",
      conversationId: c,
      kind: "watch",
      lotId: 1,
      payload: { maxBid: 6000, note: "for the homelab" },
    });
    expect(await watchedLots(db, "u1")).toEqual([]);
    expect(await decideAction(db, a.id, "u2", "confirmed")).toBeNull();
    expect((await decideAction(db, a.id, "u1", "confirmed"))?.status).toBe(
      "confirmed",
    );
    expect(await watchedLots(db, "u1")).toEqual([
      { lotId: 1, maxBid: "60.00", note: "for the homelab" },
    ]);
    expect(await decideAction(db, a.id, "u1", "declined")).toBeNull();

    const b = await proposeAction(db, {
      userId: "u1",
      conversationId: c,
      kind: "unwatch",
      lotId: 1,
      payload: {},
    });
    await decideAction(db, b.id, "u1", "confirmed");
    expect(await watchedLots(db, "u1")).toEqual([]);
  });
});

describe("market history", () => {
  it("finds closed lots by every word of the query", async () => {
    await upsertClosedFromList(
      db,
      [
        row(101, "Dell OptiPlex 7060 Micro", {
          status: 2,
          currentBid: 5000,
          endAt: new Date(Date.now() - 3 * 86_400_000),
        }),
        row(102, "HP EliteDesk 800 G4", {
          status: 2,
          currentBid: 4500,
          endAt: new Date(Date.now() - 3 * 86_400_000),
        }),
      ],
      "sweep",
    );
    const found = await findClosedLots(db, "optiplex 7060", {});
    expect(found.map((r) => [r.lotId, r.hammer])).toEqual([[101, 5000]]);
    expect(await findClosedLots(db, "100% off", {})).toEqual([]);
  });
});

describe("a turn of the assistant", () => {
  const deps = (
    conversationId: string,
    emit: (e: AssistantEvent) => void,
  ): ToolDeps => ({
    now: () => new Date(),
    catalogue: async () => ({ lots: OPEN.map(doc), auctions: [] }),
    lot: async (id) => {
      const r = OPEN.find((x) => x.id === id);
      return r
        ? ({
            id,
            title: r.title,
            rates: { levy: 0.175, vat: 0.155, lotVat: 0, estimated: true },
            finalState: "open",
            status: 1,
            currentBid: r.currentBid,
            startingBid: r.startingBid,
            endAt: r.endAt?.toISOString() ?? null,
            originalEndAt: null,
            gallery: [],
            destinations: [],
          } as unknown as LotView)
        : null;
    },
    auctions: async () => [],
    closedLots: (q, o) => findClosedLots(db, q, o),
    watchlist: async () => [],
    propose: async (kind, lotId, payload) => {
      const a = await proposeAction(db, {
        userId: "u1",
        conversationId,
        kind,
        lotId,
        payload,
      });
      emit({
        type: "action",
        action: {
          id: a.id,
          kind,
          lotId,
          title: null,
          maxBidCents: null,
          allInCents: null,
          note: null,
          status: "pending",
        },
      });
      return a;
    },
  });
  const store = (conversationId: string, userId = "u1") => ({
    appendMessages: (m: Parameters<typeof appendMessages>[2]) =>
      appendMessages(db, conversationId, m),
    recordUsage: (
      u: Omit<Parameters<typeof recordUsage>[1], "userId" | "conversationId">,
    ) => recordUsage(db, { ...u, userId, conversationId }),
    allowance: () => allowance(db, userId),
  });

  it("searches, answers with links, proposes a watch, and stores the whole exchange append-only", async () => {
    const c = await createConversation(db, "u1", "OptiPlex");
    const events: AssistantEvent[] = [];
    const emit = (e: AssistantEvent) => events.push(e);
    const calls: Parameters<StreamFn>[0][] = [];
    const stream: StreamFn = (p, s) => {
      calls.push(structuredClone(p));
      return demoStream(p, s);
    };
    await runTurn({
      history: [],
      question: "Find me an OptiPlex",
      context: "Now: Sunday. Asking: Tendai.",
      stream,
      deps: deps(c, emit),
      store: store(c),
      emit,
      signal: new AbortController().signal,
    });

    const text = events
      .flatMap((e) => (e.type === "text" ? [e.delta] : []))
      .join("");
    expect(text).toContain("[Dell OptiPlex 7060 Micro Desktop](/lots/1)");
    expect(
      events
        .filter((e) => e.type === "tool")
        .map((e) => (e as { state: string }).state),
    ).toEqual(["running", "done", "running", "done"]);
    expect(events.some((e) => e.type === "action")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done" });

    // Three model calls, each sent the full history so far, with the frozen prefix.
    expect(calls).toHaveLength(3);
    expect(calls[0].messages.map((m) => m.role)).toEqual(["user", "system"]);
    expect(calls[2].messages.map((m) => m.role)).toEqual([
      "user",
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
    ]);
    expect(calls[0].system).toEqual(calls[2].system);
    expect(calls[0].tools).toEqual(calls[2].tools);
    expect(calls[0]).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      output_config: { effort: "medium" },
    });

    const stored = await loadMessages(db, c);
    expect(stored.map((m) => m.role)).toEqual([
      "user",
      "system",
      "assistant",
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    const [pending] = await listActions(db, c);
    expect(pending).toMatchObject({
      kind: "watch",
      lotId: 1,
      status: "pending",
      payload: { maxBid: 5000 },
    });
    expect((await allowance(db, "u1")).spentCents).toBeGreaterThan(0);

    // Reopening the conversation shows the same chat.
    const view = transcript(
      stored,
      new Map<string, ActionView>([
        [
          pending.id,
          {
            id: pending.id,
            kind: "watch",
            lotId: 1,
            title: "x",
            maxBidCents: 5000,
            allInCents: 6011,
            note: null,
            status: "pending",
          },
        ],
      ]),
    );
    expect(view[0]).toEqual({ role: "user", text: "Find me an OptiPlex" });
    expect(view).toHaveLength(2);
    const parts = view[1].role === "assistant" ? view[1].parts : [];
    expect(parts.map((p) => p.type)).toEqual([
      "text",
      "tool",
      "text",
      "tool",
      "action",
      "text",
    ]);
  });

  it("stops before calling Claude once the month's allowance is used", async () => {
    await db
      .insert(schema.userSettings)
      .values({ userId: "u2", aiCapCents: 20 });
    const c = await createConversation(db, "u2", "Over");
    const events: AssistantEvent[] = [];
    let called = false;
    await runTurn({
      history: [],
      question: "anything",
      context: "",
      stream: (p, s) => {
        called = true;
        return demoStream(p, s);
      },
      deps: deps(c, () => {}),
      store: store(c, "u2"),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(called).toBe(false);
    expect(events.find((e) => e.type === "error")).toMatchObject({
      message: expect.stringMatching(/\$0 assistant allowance|allowance/),
    });
    await db
      .update(schema.userSettings)
      .set({ aiCapCents: 1000 })
      .where(eq(schema.userSettings.userId, "u2"));
  });

  it("re-issues a turn whose tool input couldn't be parsed, but lets API errors through", async () => {
    const c = await createConversation(db, "u1", "Retry");
    let n = 0;
    const flaky: StreamFn = () => {
      n++;
      if (n === 1)
        return {
          [Symbol.asyncIterator]: () => ({
            next: () =>
              Promise.reject(new SyntaxError("Unexpected token in JSON")),
          }),
          finalMessage: async () => {
            throw new SyntaxError("Unexpected token in JSON");
          },
        };
      return streamOf(fakeMessage([{ type: "text", text: "OK" } as never]));
    };
    const events: AssistantEvent[] = [];
    await runTurn({
      history: [],
      question: "q",
      context: "",
      stream: flaky,
      deps: deps(c, () => {}),
      store: store(c),
      emit: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(n).toBe(2);
    expect(events.at(-1)).toEqual({ type: "done" });

    const overloaded: StreamFn = () => {
      throw new Anthropic.InternalServerError(
        529,
        { type: "error" },
        "Overloaded",
        new Headers(),
      );
    };
    await expect(
      runTurn({
        history: [],
        question: "q",
        context: "",
        stream: overloaded,
        deps: deps(c, () => {}),
        store: store(c),
        emit: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(Anthropic.APIError);
  });

  it("rejects a tool input that doesn't match the schema instead of running it", async () => {
    const c = await createConversation(db, "u1", "Bad input");
    let round = 0;
    const bad: StreamFn = () =>
      ++round === 1
        ? streamOf(
            fakeMessage(
              [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "propose_watch",
                  input: { lot_id: "one" },
                } as never,
              ],
              "tool_use",
            ),
          )
        : streamOf(fakeMessage([{ type: "text", text: "Sorry." } as never]));
    await runTurn({
      history: [],
      question: "watch it",
      context: "",
      stream: bad,
      deps: deps(c, () => {}),
      store: store(c),
      emit: () => {},
      signal: new AbortController().signal,
    });
    const stored = await loadMessages(db, c);
    const result = (
      stored[3].content as { is_error?: boolean; content: string }[]
    )[0];
    expect(result.is_error).toBe(true);
    expect(result.content).toContain("INVALID_JSON");
    expect(
      await db
        .select()
        .from(schema.aiActions)
        .where(and(eq(schema.aiActions.conversationId, c))),
    ).toEqual([]);
  });

  it("keeps the cached prefix identical across conversations", () => {
    const a = buildParams([{ role: "user", content: "a" }]);
    const b = buildParams([{ role: "user", content: "b" }]);
    expect(JSON.stringify([a.tools, a.system])).toBe(
      JSON.stringify([b.tools, b.system]),
    );
  });
});
