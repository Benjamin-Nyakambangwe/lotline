import type { Phase } from "./domain/closing";
import type { Confidence, MyStatus } from "./domain/status";

/** A watched lot as the board shows it (cents, ISO times). No bidder IDs, ever. */
export interface LiveLot {
  id: number;
  type: number;
  title: string;
  thumbUrl: string | null;
  location: string | null;
  phase: Phase;
  status: MyStatus;
  confidence: Confidence;
  /** while closing: what it will most likely become */
  provisional: "winning" | "outbid" | null;
  needsConfirmation: boolean;
  stc: boolean;
  currentBid: number | null;
  nextBid: number | null;
  allInNext: number | null;
  myBid: number | null;
  maxBid: number | null;
  /** the next bid is above the person's own max */
  overMax: boolean;
  note: string | null;
  endAt: string | null;
  originalEndAt: string | null;
  extended: boolean;
  closedAt: string | null;
  finalPrice: number | null;
}

export interface LiveAlert {
  id: number;
  kind: string;
  lotId: number | null;
  title: string;
  body: string | null;
  createdAt: string;
  read: boolean;
}

export interface LiveResponse {
  now: string;
  bidder: { linked: boolean; masked: string | null };
  lots: LiveLot[];
  alerts: LiveAlert[];
  unread: number;
}
