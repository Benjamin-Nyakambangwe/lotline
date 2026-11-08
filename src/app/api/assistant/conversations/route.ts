import { allowance, listConversations } from "@/lib/db/queries/assistant";
import { assistantStream } from "@/server/assistant/client";
import { getAuth } from "@/server/auth";
import { getDb } from "@/server/db";

/** This person's recent conversations, their allowance, and whether the assistant is set up. */
export async function GET(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = getDb();
  const [conversations, left] = await Promise.all([
    listConversations(db, session.user.id),
    allowance(db, session.user.id),
  ]);
  return Response.json(
    { ready: !!assistantStream(), allowance: left, conversations },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
