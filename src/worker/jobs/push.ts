import { sendNotification } from "web-push";
import type { Db } from "@/lib/db/client";
import { deliverPending, type SendPush } from "@/lib/push/deliver";
import type { WorkerConfig } from "../config";
import type { Logger } from "../log";

/** A web-push sender for this worker's VAPID keys, or null when push isn't configured. */
export function webPushSender(cfg: WorkerConfig): SendPush | null {
  if (!cfg.VAPID_PUBLIC_KEY || !cfg.VAPID_PRIVATE_KEY || !cfg.VAPID_SUBJECT)
    return null;
  const vapidDetails = {
    subject: cfg.VAPID_SUBJECT,
    publicKey: cfg.VAPID_PUBLIC_KEY,
    privateKey: cfg.VAPID_PRIVATE_KEY,
  };
  return (target, payload, options) =>
    sendNotification(target, payload, {
      ...options,
      vapidDetails,
      timeout: 10_000,
    });
}

/** Push new alerts to people's phones. Never logs endpoints (they identify a device). */
export async function pushStep(db: Db, send: SendPush, log: Logger) {
  const r = await deliverPending(db, send);
  if (r.alerts) log.info(r, "alerts pushed");
  return 1_500;
}
