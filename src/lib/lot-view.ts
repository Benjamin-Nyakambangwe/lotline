import type { Destination, GalleryItem, Viewing } from "./db/schema";

/**
 * A lot as the web app shows it (shared by server and client). Money in cents, times as ISO
 * strings. Deliberately has no bidder fields: those never leave the server.
 */
export interface LotView {
  id: number;
  type: number;
  lotNumber: number | null;
  title: string;
  photoUrl: string | null;
  location: string | null;
  sublocation: string | null;
  auction: AuctionInfo | null;
  categoryPath: string | null;
  category: string | null;
  condition: string | null;
  state: string | null;
  size: string | null;
  quantityText: string | null;
  quantityN: number;
  currency: string;
  currentBid: number | null;
  startingBid: number | null;
  status: number | null;
  stc: boolean;
  startAt: string | null;
  endAt: string | null;
  originalEndAt: string | null;
  extensionsCount: number;
  offerWindowEndAt: string | null;
  rates: { levy: number; vat: number; lotVat: number; estimated: boolean };
  descriptionHtml: string | null;
  gallery: GalleryItem[];
  viewing: Viewing | null;
  destinations: Destination[];
  cpu: string | null;
  detailFetchedAt: string | null;
  priceObservedAt: string | null;
  finalState: string;
  finalPrice: number | null;
  closedAt: string | null;
}

export interface LotResponse {
  now: string;
  lot: LotView | null;
  /** the worker has been asked for fresh data; poll again shortly */
  refreshing: boolean;
}

/** An auction (ABC "campaign") as the app shows it. */
export interface AuctionInfo {
  /** URL-safe key: the code ("HGA#288"), else the name */
  key: string;
  /** "Harare Goods Auction" */
  title: string;
  code: string | null;
  location: string | null;
}

export interface CatalogueResponse {
  now: string;
  syncedAt: string | null;
  count: number;
  /** auctions with lots in this catalogue, for labels */
  auctions: AuctionInfo[];
  lots: import("./search/engine").CatalogueDoc[];
}
