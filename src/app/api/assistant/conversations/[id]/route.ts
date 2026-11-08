import { transcript } from "@/lib/assistant/transcript";
import {
  getConversation,
  listActions,
  loadMessages,
} from "@/lib/db/queries/assistant";
import { actionViews } from "@/server/assistant/deps";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

/** One conversation, rebuilt as chat items (only its owner can read it). */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/assistant/conversations/[id]">,
) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const db = getDb();
  if (
    !/^[0-9a-f-]{36}$/.test(id) ||
    !(await getConversation(db, id, session.user.id))
  )
    return Response.json({ error: "not found" }, { status: 404 });
  const [messages, actions] = await Promise.all([
    loadMessages(db, id),
    listActions(db, id),
  ]);
  const views = await actionViews(actions.map((a) => a.id));
  return Response.json(
    { id, items: transcript(messages, views) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
