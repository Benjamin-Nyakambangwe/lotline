/**
 * How often to read a tracked lot, by how close it is to closing. Further out, the catalogue
 * sync (every 10 minutes) is enough; near the close we read the lot's detail directly, because
 * search lags behind while lots are closing.
 *
 *   cold  more than 60 min to go   catalogue sync only
 *   warm  60 to 20 min             every 2 min
 *   near  20 to 5 min              every 30 s
 *   hot   under 5 min, or past the end and not yet final   every 8 s (slower if many are hot)
 */
export type Tier = "cold" | "warm" | "near" | "hot" | "done";

export const TIER_EVERY_MS: Record<Exclude<Tier, "cold" | "done">, number> = {
  warm: 120_000,
  near: 30_000,
  hot: 8_000,
};
/** More than this many hot lots at once and each is read less often (to stay polite). */
export const HOT_SOFT_LIMIT = 25;

const MIN = 60_000;

export function tierFor(
  l: { endAt: Date | null; final: boolean },
  now: Date,
): Tier {
  if (l.final) return "done";
  if (!l.endAt) return "cold";
  const left = l.endAt.getTime() - now.getTime();
  if (left <= 5 * MIN) return "hot";
  if (left <= 20 * MIN) return "near";
  if (left <= 60 * MIN) return "warm";
  return "cold";
}

/** When to read the lot next. Cold lots wake when they enter the warm window. */
export function nextDue(
  tier: Tier,
  l: { endAt: Date | null },
  now: Date,
  hotCount = 0,
): Date | null {
  if (tier === "done") return null;
  if (tier === "cold")
    return l.endAt ? new Date(l.endAt.getTime() - 60 * MIN) : null;
  const every =
    tier === "hot"
      ? TIER_EVERY_MS.hot * Math.max(1, Math.ceil(hotCount / HOT_SOFT_LIMIT))
      : TIER_EVERY_MS[tier];
  return new Date(now.getTime() + every);
}
