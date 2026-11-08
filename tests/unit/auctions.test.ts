import { describe, expect, it } from "vitest";
import {
  auctionKey,
  auctionPhase,
  parseAuctionName,
} from "@/lib/domain/auctions";

describe("auction names", () => {
  it("splits ABC campaign names into a title and a code", () => {
    expect(parseAuctionName("Harare Goods Auction - HGA#288")).toEqual({
      title: "Harare Goods Auction",
      code: "HGA#288",
    });
    expect(
      parseAuctionName("Vehicles Spares & Auto Parts  Auction - TVS#011"),
    ).toEqual({
      title: "Vehicles Spares & Auto Parts Auction",
      code: "TVS#011",
    });
    expect(
      parseAuctionName(
        "Zimra Disposal Auction - Plumtree, Maitengwe & Mphoengs  - ZDA#014",
      ),
    ).toEqual({
      title: "Zimra Disposal Auction - Plumtree, Maitengwe & Mphoengs",
      code: "ZDA#014",
    });
    expect(parseAuctionName("Special Sale")).toEqual({
      title: "Special Sale",
      code: null,
    });
    expect(auctionKey({ code: null, name: "Special Sale" })).toBe(
      "Special Sale",
    );
  });

  it("knows whether an auction is upcoming, closing or closed", () => {
    const first = new Date("2026-11-10T17:00:00Z");
    const last = new Date("2026-11-10T18:10:00Z");
    const at = (iso: string) => new Date(iso);
    expect(auctionPhase(first, last, 210, at("2026-11-10T16:59:00Z"))).toBe(
      "upcoming",
    );
    expect(auctionPhase(first, last, 120, at("2026-11-10T17:30:00Z"))).toBe(
      "closing",
    );
    expect(auctionPhase(first, last, 0, at("2026-11-10T18:15:00Z"))).toBe(
      "closing",
    );
    expect(auctionPhase(first, last, 0, at("2026-11-10T19:00:00Z"))).toBe(
      "closed",
    );
  });
});
