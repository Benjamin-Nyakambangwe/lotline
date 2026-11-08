/**
 * ABC groups lots into auctions it calls campaigns, named like "Harare Goods Auction - HGA#288".
 * Lots in an auction close in a run (usually from 19:00 Harare, ~20 s apart).
 */

export interface AuctionName {
  /** "Harare Goods Auction" */
  title: string;
  /** "HGA#288", or null when the name has no code */
  code: string | null;
}

export function parseAuctionName(name: string): AuctionName {
  const clean = name.replace(/\s+/g, " ").trim();
  const m = /^(.*?)\s*-\s*([A-Z]{2,5}#\d+)$/.exec(clean);
  return m ? { title: m[1].trim(), code: m[2] } : { title: clean, code: null };
}

/** A short, URL-safe key for an auction: its code, else its name. */
export const auctionKey = (a: { code: string | null; name: string }) =>
  a.code ?? a.name;

export type AuctionPhase = "upcoming" | "closing" | "closed";

/**
 * upcoming: before the first lot closes. closing: lots are closing (soft-close extensions can run
 * past the last scheduled end, so allow 15 minutes). closed: after that.
 */
export function auctionPhase(
  firstEnd: Date | null,
  lastEnd: Date | null,
  openLots: number,
  now: Date,
): AuctionPhase {
  if (!firstEnd || now < firstEnd) return "upcoming";
  if (openLots > 0) return "closing";
  if (lastEnd && now.getTime() - lastEnd.getTime() < 15 * 60_000)
    return "closing";
  return "closed";
}
