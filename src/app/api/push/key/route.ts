import { subscriptionCount } from "@/lib/db/queries/push";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

/** The public VAPID key (read at run time, so changing keys needs no rebuild) and device count. */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json(
    {
      key: process.env.VAPID_PUBLIC_KEY || null,
      devices: await subscriptionCount(getDb(), session.user.id),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
