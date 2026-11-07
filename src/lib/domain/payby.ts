import { addDaysToDate, DISPLAY_TZ, localDate } from "./time";

/** ABC asks for payment about four days after close: a Friday close is due on Tuesday. */
export const PAY_WITHIN_DAYS = 4;

/** Default pay-by date (YYYY-MM-DD) for a lot that closed at `closedAt`. Editable per item. */
export function defaultPayBy(closedAt: Date | number, tz = DISPLAY_TZ): string {
  return addDaysToDate(localDate(closedAt, tz), PAY_WITHIN_DAYS);
}
