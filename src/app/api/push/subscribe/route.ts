import { z } from "zod";
import { removeSubscription, saveSubscription } from "@/lib/db/queries/push";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

const Sub = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
  label: z.string().max(80).nullish(),
});

/** Save this device's push subscription (alerts reach it even when Lotline is closed). */
export async function POST(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Sub.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "bad subscription" }, { status: 400 });
  const { endpoint, keys, label } = parsed.data;
  if (!/^https:\/\//.test(endpoint))
    return Response.json({ error: "bad endpoint" }, { status: 400 });
  await saveSubscription(getDb(), session.user.id, {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    label: label ?? null,
  });
  return Response.json({ ok: true });
}

/** Stop pushing to this device. */
export async function DELETE(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = z
    .object({ endpoint: z.string().max(1000) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "bad request" }, { status: 400 });
  await removeSubscription(getDb(), session.user.id, parsed.data.endpoint);
  return Response.json({ ok: true });
}
