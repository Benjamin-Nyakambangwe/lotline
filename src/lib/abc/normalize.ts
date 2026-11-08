import { nextBidAfter } from "../domain/increments";
import { type Cents, toCents } from "../domain/money";
import { quantityOf } from "../domain/titles";
import type { AbcDetail, AbcListItem } from "./schemas";
import { thumbOf } from "./urls";

/** A lot as it appears in search results, in our units (cents, Dates). */
export interface LotListRow {
  id: number;
  type: number;
  title: string;
  photoUrl: string | null;
  thumbUrl: string | null;
  lotNumber: number | null;
  location: string | null;
  currency: string;
  /** the next minimum bid (cents): the opening price until someone bids */
  startingBid: Cents | null;
  /** the opening price (cents), when known */
  openingBid: Cents | null;
  currentBid: Cents | null;
  /** ABC's leader bidder ID. Personal data: callers must drop it unless the lot is tracked. */
  currentBidderId: number | null;
  startAt: Date | null;
  /** EndDate as returned (may be a ~2125 placeholder on sold lots) */
  endAt: Date | null;
  status: number | null;
  saleStatus: number | null;
  stc: boolean;
  auctionLotId: number | null;
}

export interface LotDetailRow extends LotListRow {
  categoryPath: string | null;
  category: string | null;
  subCategory: string | null;
  finalCategory: string | null;
  gallery: { zoom: string; thumb: string | null }[];
  sublocation: string | null;
  size: string | null;
  quantityText: string | null;
  quantityN: number;
  condition: string | null;
  state: string | null;
  /** untrusted HTML from ABC; sanitize before rendering */
  descriptionHtml: string | null;
  offerWindowEndAt: Date | null;
  levy: number | null;
  vat: number | null;
  lotVat: number | null;
  destinations: {
    id: number | null;
    title: string;
    price: Cents | null;
    tax: number | null;
    currency: string | null;
  }[];
  viewing: {
    title: string | null;
    subtitle: string | null;
    descriptionHtml: string | null;
  } | null;
  url: string | null;
}

const date = (s: string | null | undefined): Date | null => {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
};
const cents = (n: number | null | undefined): Cents | null =>
  n === null || n === undefined ? null : toCents(n);

/**
 * A search-listing item. Careful: the listing's StartingBid is the opening price, even after
 * bids (the detail endpoint's StartingBid is the next bid), so the next bid comes from the ladder.
 */
export function normalizeListItem(x: AbcListItem): LotListRow {
  const opening = cents(x.StartingBid);
  const current = cents(x.CurrentBid);
  return {
    id: x.Id,
    type: x.Type ?? 1,
    title: x.Title.trim(),
    photoUrl: x.Photo ?? null,
    thumbUrl: thumbOf(x.Photo),
    lotNumber: x.LotNumber ?? null,
    location: x.Location ?? null,
    currency: x.Currency ?? "USD",
    startingBid: current === null ? opening : nextBidAfter(current),
    openingBid: opening,
    currentBid: current,
    currentBidderId: x.CurrentBidderId ?? null,
    startAt: date(x.StartDate),
    endAt: date(x.EndDate),
    status: x.Status ?? null,
    saleStatus: x.SaleStatus ?? null,
    stc: !!x.STC,
    auctionLotId: x.AuctionLotId ?? null,
  };
}

export function normalizeDetail(x: AbcDetail): LotDetailRow {
  const parts = (x.Category ?? "")
    .split(">")
    .map((p) => p.trim())
    .filter(Boolean);
  const list = normalizeListItem(x);
  return {
    ...list,
    // In detail, StartingBid really is the next minimum bid; the opening price isn't given once
    // there are bids.
    startingBid: cents(x.StartingBid) ?? list.startingBid,
    openingBid: list.currentBid === null ? list.openingBid : null,
    categoryPath: parts.length ? parts.join(" > ") : null,
    category: parts[0] ?? null,
    subCategory: parts[1] ?? null,
    finalCategory: parts[parts.length - 1] ?? null,
    gallery: (x.Gallery ?? [])
      .filter((g) => g.ZoomPath || g.ThumbPath)
      .map((g) => ({
        zoom: (g.ZoomPath ?? g.ThumbPath) as string,
        thumb: g.ThumbPath ?? thumbOf(g.ZoomPath),
      })),
    sublocation: x.Sublocation ?? null,
    size: x.Size ?? null,
    quantityText: x.Quantity ?? null,
    quantityN: quantityOf(x.Quantity),
    condition: x.Condition ?? null,
    state: x.State ?? null,
    descriptionHtml: x.OtherInformation ?? null,
    offerWindowEndAt: date(x.OfferWindowEndDate),
    levy: x.PurchasersLevy ?? null,
    vat: x.VAT ?? null,
    lotVat: x.LotVAT ?? null,
    destinations: (x.Destinations ?? [])
      .filter((d) => d.Title)
      .map((d) => ({
        id: d.Id ?? null,
        title: d.Title as string,
        price: cents(d.Price),
        tax: d.Tax ?? null,
        currency: d.Currency ?? null,
      })),
    viewing: x.ViewingDetails
      ? {
          title: x.ViewingDetails.Title ?? null,
          subtitle: x.ViewingDetails.Subtitle ?? null,
          descriptionHtml: x.ViewingDetails.Description ?? null,
        }
      : null,
    url: x.Url ?? null,
  };
}
