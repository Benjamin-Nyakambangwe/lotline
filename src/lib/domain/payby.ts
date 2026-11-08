import { addDaysToDate, DISPLAY_TZ, localDate } from "./time";

/** ABC asks for payment about four days after close: a Friday close is due on Tuesday. */
export const PAY_WITHIN_DAYS = 4;

/** Default pay-by date (YYYY-MM-DD) for a lot that closed at `closedAt`. Editable per item. */
export function defaultPayBy(closedAt: Date | number, tz = DISPLAY_TZ): string {
  return addDaysToDate(localDate(closedAt, tz), PAY_WITHIN_DAYS);
}

/** "Tue 10 Nov" for a YYYY-MM-DD pay-by date. */
export function formatPayBy(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(Date.UTC(y, m - 1, d, 12)))
    .replace(",", "");
}
