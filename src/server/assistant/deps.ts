import "server-only";
import { eq, inArray } from "drizzle-orm";
import type { AssistantEvent } from "@/lib/assistant/run";
import type { ToolDeps } from "@/lib/assistant/tools";
import type { ActionView } from "@/lib/assistant/transcript";
import { proposeAction, watchedLots } from "@/lib/db/queries/assistant";
import { findClosedLots } from "@/lib/db/queries/market";
import * as schema from "@/lib/db/schema";
import { allIn, DEFAULT_RATES } from "@/lib/domain/fees";
import { parseCents } from "@/lib/domain/money";
import { listAuctions } from "../auctions";
import { catalogueSnapshot, getLotView } from "../catalogue";
import { getDb } from "../db";

/** The open catalogue changes every few minutes: share one copy across tool calls for a minute. */
let catalogueCache: {
  at: number;
  value: Awaited<ReturnType<typeof catalogueSnapshot>>;
} | null = null;
async function catalogue() {
  if (!catalogueCache || Date.now() - catalogueCache.at > 60_000)
    catalogueCache = { at: Date.now(), value: await catalogueSnapshot() };
  return catalogueCache.value;
}

/** Proposed actions as the chat shows them, with the lot's title and the all-in at the max. */
export async function actionViews(
  ids: string[],
): Promise<Map<string, ActionView>> {
  if (!ids.length) return new Map();
  const rows = await getDb()
    .select({
      id: schema.aiActions.id,
      kind: schema.aiActions.kind,
      lotId: schema.aiActions.lotId,
      payload: schema.aiActions.payload,
      status: schema.aiActions.status,
      title: schema.lots.title,
      levy: schema.lots.levyRate,
      vat: schema.lots.vatRate,
      lotVat: schema.lots.lotVatRate,
    })
    .from(schema.aiActions)
    .leftJoin(schema.lots, eq(schema.lots.id, schema.aiActions.lotId))
    .where(inArray(schema.aiActions.id, ids));
  return new Map(
    rows.map((r) => {
      const p = r.payload as { maxBid?: number; note?: string };
      const rates =
        r.levy !== null && r.vat !== null
          ? {
              levy: Number(r.levy),
              vat: Number(r.vat),
              lotVat: Number(r.lotVat ?? 0),
              estimated: false,
            }
          : DEFAULT_RATES;
      return [
        r.id,
        {
          id: r.id,
          kind: r.kind,
          lotId: r.lotId,
          title: r.title,
          maxBidCents: p.maxBid ?? null,
          allInCents: p.maxBid !== undefined ? allIn(p.maxBid, rates) : null,
          note: p.note ?? null,
          status: r.status,
        },
      ];
    }),
  );
}

export function toolDeps(
  userId: string,
  conversationId: string,
  emit: (e: AssistantEvent) => void,
): ToolDeps {
  const db = getDb();
  return {
    now: () => new Date(),
    catalogue: async () => {
      const c = await catalogue();
      return { lots: c.lots, auctions: c.auctions };
    },
    lot: (id) => getLotView(id),
    auctions: () => listAuctions(),
    closedLots: (q, o) => findClosedLots(db, q, o),
    watchlist: async () =>
      (await watchedLots(db, userId)).map((w) => ({
        lotId: w.lotId,
        maxBid: parseCents(w.maxBid),
        note: w.note,
      })),
    propose: async (kind, lotId, payload) => {
      const a = await proposeAction(db, {
        userId,
        conversationId,
        kind,
        lotId,
        payload,
      });
      const view = (await actionViews([a.id])).get(a.id);
      if (view) emit({ type: "action", action: view });
      return a;
    },
  };
}
