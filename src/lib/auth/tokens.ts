import { createHash, randomBytes } from "node:crypto";

/** Invite links carry a random token; only its SHA-256 hash is stored. */
export const newInviteToken = () => randomBytes(32).toString("base64url");
export const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const INVITE_TTL_MS = 7 * 24 * 3600_000;
/** An accepted invite still counts for this long, while its sign-in link is being verified. */
export const INVITE_GRACE_MS = 30 * 60_000;
