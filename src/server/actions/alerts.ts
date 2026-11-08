"use server";

import { notifications } from "@/lib/db/schema";
import { requireUser } from "../dal";
import { getDb } from "../db";

/** A test alert through the real pipeline: the worker pushes it to every device you've enabled. */
export async function sendTestAlert() {
  const user = await requireUser();
  await getDb()
    .insert(notifications)
    .values({
      userId: user.id,
      kind: "system",
      title: "Test alert from Lotline",
      body: "Alerts work on this device. Outbid alerts arrive like this, even with Lotline closed.",
      dedupeKey: `test:${Date.now()}`,
    });
  return { ok: true as const };
}
