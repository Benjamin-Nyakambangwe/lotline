export const ABC_SITE = "https://app.abcauctions.co.zw";

/** Link to bid on a lot on ABC's own site. Vehicles are Type 2. */
export const lotUrl = (id: number, type: number | null | undefined = 1) =>
  `${ABC_SITE}/home(dialog:lot/${type || 1}/${id})`;

/** Thumbnail URL for a "-Zoom.jpg" CDN photo. */
export const thumbOf = (zoomUrl: string | null | undefined): string | null =>
  zoomUrl ? zoomUrl.replace(/-Zoom\.(jpe?g|png|webp)$/i, "-Thumb.$1") : null;

export type LotRef =
  | { kind: "id"; id: number; type?: number }
  | { kind: "lotNumber"; lotNumber: number };

/**
 * Understands what people paste: an ABC link (either form), a lot Id (≤ 8 digits), or an
 * ABC lot number (9+ digits, e.g. 261008571, as shown on invoices). Lot numbers are resolved
 * to Ids with a search Query.
 */
export function parseLotRef(input: string): LotRef | null {
  const s = input.trim();
  const dialog =
    /dialog:lot\/(\d+)\/(\d+)/i.exec(s) ?? /\/lot\/(\d+)\/(\d+)/i.exec(s);
  if (dialog)
    return { kind: "id", type: Number(dialog[1]), id: Number(dialog[2]) };
  const digits = /^#?\s*(\d{3,12})$/.exec(s);
  if (!digits) return null;
  const n = Number(digits[1]);
  return digits[1].length >= 9
    ? { kind: "lotNumber", lotNumber: n }
    : { kind: "id", id: n };
}
