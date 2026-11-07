/** Money is handled as integer cents in domain code. The DB stores numeric(12,2). */
export type Cents = number;

export const toCents = (dollars: number): Cents => Math.round(dollars * 100);
export const fromCents = (cents: Cents): number => cents / 100;

/** Parse a DB numeric string or an API number into cents. */
export function parseCents(
  v: string | number | null | undefined,
): Cents | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? toCents(n) : null;
}

/** Cents → numeric(12,2) string for the DB. */
export const centsToNumeric = (c: Cents | null): string | null =>
  c === null ? null : (c / 100).toFixed(2);

/**
 * Format cents for display. Whole dollars drop the ".00" unless `forceCents`;
 * anything with cents shows them, so all-in prices like $72.13 stay exact.
 */
export function formatMoney(
  cents: Cents | null | undefined,
  {
    currency = "USD",
    forceCents = false,
  }: { currency?: string; forceCents?: boolean } = {},
): string {
  if (cents === null || cents === undefined) return "–";
  const whole = cents % 100 === 0 && !forceCents;
  const symbol = currency === "USD" ? "$" : `${currency} `;
  const abs = Math.abs(cents) / 100;
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  });
  return `${cents < 0 ? "−" : ""}${symbol}${body}`;
}
