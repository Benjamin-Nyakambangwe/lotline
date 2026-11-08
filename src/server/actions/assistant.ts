"use server";

import { z } from "zod";
import { decideAction } from "@/lib/db/queries/assistant";
import { actionViews } from "../assistant/deps";
import { requireUser } from "../dal";
import { getDb } from "../db";

const Input = z.object({
  id: z.uuid(),
  decision: z.enum(["confirmed", "declined"]),
});

/** Confirm or decline a change the assistant proposed. Only its owner can, and only once. */
export async function decideAssistantAction(input: z.infer<typeof Input>) {
  const user = await requireUser();
  const { id, decision } = Input.parse(input);
  const done = await decideAction(getDb(), id, user.id, decision);
  const view = (await actionViews([id])).get(id) ?? null;
  return { ok: !!done, action: view };
}
