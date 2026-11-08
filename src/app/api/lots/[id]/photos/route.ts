import { eq } from "drizzle-orm";
import { lots } from "@/lib/db/schema";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

/** A lot's photo list from our database (never asks ABC): for card carousels. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/lots/[id]/photos">,
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id) || id <= 0)
    return Response.json({ error: "bad id" }, { status: 400 });
  const [r] = await getDb()
    .select({ gallery: lots.gallery })
    .from(lots)
    .where(eq(lots.id, id));
  return Response.json(
    { photos: r?.gallery ?? [] },
    { headers: { "Cache-Control": "private, max-age=600" } },
  );
}
