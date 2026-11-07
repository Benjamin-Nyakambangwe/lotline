import { TZDate } from "@date-fns/tz";
import { addDays, format } from "date-fns";

export const DISPLAY_TZ = "Africa/Harare";

/** A date in Africa/Harare (CAT, UTC+2, no DST). */
export const inTz = (d: Date | number, tz = DISPLAY_TZ) => new TZDate(+d, tz);

/** "Fri 19:36" in the display timezone. */
export const formatClock = (d: Date | number, tz = DISPLAY_TZ) =>
  format(inTz(d, tz), "EEE HH:mm");

/** "19:36:40" in the display timezone. */
export const formatTime = (d: Date | number, tz = DISPLAY_TZ) =>
  format(inTz(d, tz), "HH:mm:ss");

/** Calendar date in the display timezone as YYYY-MM-DD. */
export const localDate = (d: Date | number, tz = DISPLAY_TZ) =>
  format(inTz(d, tz), "yyyy-MM-dd");

/** Add calendar days to a YYYY-MM-DD string. */
export function addDaysToDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return format(
    addDays(new Date(Date.UTC(y, m - 1, d, 12)), days),
    "yyyy-MM-dd",
  );
}

/**
 * Countdown text: "1:05:12" above an hour, "9:05" below, "0:00" at zero.
 * Tabular figures in the UI keep this from jittering as it ticks.
 */
export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
