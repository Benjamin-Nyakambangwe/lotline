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

/** Epoch ms of midnight at the start of a YYYY-MM-DD day in the display timezone. */
export function startOfLocalDay(ymd: string, tz = DISPLAY_TZ): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new TZDate(y, m - 1, d, 0, 0, 0, 0, tz).getTime();
}

/** Add calendar days to a YYYY-MM-DD string. */
export function addDaysToDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return format(
    addDays(new Date(Date.UTC(y, m - 1, d, 12)), days),
    "yyyy-MM-dd",
  );
}

/**
 * Countdown text. Compact (cards): "4d 1h 05m" beyond a day, "1:05:12" above an hour, "9:05"
 * below, "0:00" at zero. With `seconds` (big timers): "4d 01:05:12", so it visibly ticks.
 * Tabular figures in the UI keep this from jittering as it ticks.
 */
export function formatCountdown(
  ms: number,
  opts: { seconds?: boolean } = {},
): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ss = pad(s % 60);
  if (d > 0)
    return opts.seconds
      ? `${d}d ${pad(h)}:${pad(m)}:${ss}`
      : `${d}d ${h}h ${pad(m)}m`;
  return h > 0 ? `${h}:${pad(m)}:${ss}` : `${m}:${ss}`;
}

/** When something happens, relative to today in Harare: "today 19:03", "tomorrow 19:03", "Tue 10 Nov 19:03". */
export function formatWhen(
  d: Date | number,
  now: Date | number = Date.now(),
  tz = DISPLAY_TZ,
): string {
  const day = localDate(d, tz);
  const today = localDate(now, tz);
  const clock = format(inTz(d, tz), "HH:mm");
  if (day === today) return `today ${clock}`;
  if (day === addDaysToDate(today, 1)) return `tomorrow ${clock}`;
  if (day === addDaysToDate(today, -1)) return `yesterday ${clock}`;
  return `${format(inTz(d, tz), "EEE d MMM")} ${clock}`;
}
