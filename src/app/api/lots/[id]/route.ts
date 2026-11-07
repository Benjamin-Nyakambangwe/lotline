import type { LotResponse } from "@/lib/lot-view";
import { getAuth } from "@/server/auth";
import { getLotView, requestLotFetch } from "@/server/catalogue";

const DETAIL_STALE_MS = 10 * 60_000;
const PRICE_STALE_MS = 2 * 60_000;

/** One lot for the detail view; asks the worker to refresh it if our copy is stale. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/lots/[id]">,
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });

  const { id: raw } = await ctx.params;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0)
    return Response.json({ error: "bad id" }, { status: 400 });

  const lot = await getLotView(id);
  const now = Date.now();
  const age = (iso: string | null) =>
    iso ? now - Date.parse(iso) : Number.POSITIVE_INFINITY;
  const open = !!lot && lot.status === 1 && lot.finalState !== "final";
  const stale =
    !lot ||
    age(lot.detailFetchedAt) > DETAIL_STALE_MS ||
    (open && age(lot.priceObservedAt) > PRICE_STALE_MS);
  if (stale) await requestLotFetch(id, session.user.id, "view");

  const body: LotResponse = {
    now: new Date(now).toISOString(),
    lot,
    refreshing: stale,
  };
  return Response.json(body, {
    status: lot ? 200 : 404,
    headers: { "Cache-Control": "private, no-store" },
  });
}
