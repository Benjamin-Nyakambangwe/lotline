import { z } from "zod";

/**
 * Lenient schemas for ABC's public API. Unknown fields pass through; odd values degrade to
 * null instead of failing the whole page. Each list item is validated on its own, so one
 * malformed lot never drops a page (see client.ts).
 */

const numOrNull = z.preprocess((v) => {
  if (v === "" || v === undefined || v === null) return null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return v;
}, z.number().nullable());

const strOrNull = z.preprocess(
  (v) => (v === undefined ? null : typeof v === "number" ? String(v) : v),
  z.string().nullable(),
);

export const listItemSchema = z.looseObject({
  Id: z.number().int(),
  Type: numOrNull.optional(),
  Title: z.string().catch(""),
  Photo: strOrNull.optional(),
  LotNumber: numOrNull.optional(),
  Location: strOrNull.optional(),
  Currency: strOrNull.optional(),
  StartingBid: numOrNull.optional(),
  CurrentBid: numOrNull.optional(),
  CurrentBidderId: numOrNull.optional(),
  StartDate: strOrNull.optional(),
  EndDate: strOrNull.optional(),
  Status: numOrNull.optional(),
  SaleStatus: numOrNull.optional(),
  STC: z.boolean().nullable().optional().catch(null),
  AuctionLotId: numOrNull.optional(),
});
export type AbcListItem = z.infer<typeof listItemSchema>;

export const galleryItemSchema = z.looseObject({
  ZoomPath: strOrNull.optional(),
  ThumbPath: strOrNull.optional(),
});

export const destinationSchema = z.looseObject({
  Id: numOrNull.optional(),
  Title: strOrNull.optional(),
  Currency: strOrNull.optional(),
  Price: numOrNull.optional(),
  Tax: numOrNull.optional(),
});

export const viewingSchema = z.looseObject({
  Title: strOrNull.optional(),
  Subtitle: strOrNull.optional(),
  Description: strOrNull.optional(),
});

export const detailSchema = listItemSchema.extend({
  Category: strOrNull.optional(),
  Gallery: z.array(galleryItemSchema).nullable().optional().catch(null),
  Sublocation: strOrNull.optional(),
  Size: strOrNull.optional(),
  Quantity: strOrNull.optional(),
  Condition: strOrNull.optional(),
  State: strOrNull.optional(),
  OtherInformation: strOrNull.optional(),
  OfferWindowEndDate: strOrNull.optional(),
  PurchasersLevy: numOrNull.optional(),
  VAT: numOrNull.optional(),
  LotVAT: numOrNull.optional(),
  Destinations: z.array(destinationSchema).nullable().optional().catch(null),
  ViewingDetails: viewingSchema.nullable().optional().catch(null),
  Url: strOrNull.optional(),
});
export type AbcDetail = z.infer<typeof detailSchema>;

export const facetSchema = z.looseObject({
  Name: z.string(),
  Title: strOrNull.optional(),
  Buckets: z
    .array(
      z.looseObject({
        Value: z.string(),
        Count: z.number().catch(0),
        Checked: z.boolean().optional().catch(false),
      }),
    )
    .catch([]),
});
export type AbcFacet = z.infer<typeof facetSchema>;

export const searchEnvelopeSchema = z.looseObject({
  List: z.array(z.unknown()).catch([]),
  Meta: z.looseObject({
    Count: z.number().catch(0),
    Cursor: strOrNull.optional(),
    Facets: z.array(facetSchema).nullable().optional().catch([]),
  }),
});

/** ABC sometimes wraps payloads in { Data: ... }; accept both shapes. */
export function unwrap(payload: unknown): unknown {
  if (payload && typeof payload === "object" && "Data" in payload) {
    const data = (payload as { Data: unknown }).Data;
    if (data && typeof data === "object") return data;
  }
  return payload;
}

/** An auction in ABC's auction list (GET /campaigns at the API root). */
export const campaignItemSchema = z.looseObject({
  Id: z.number(),
  Title: z.string(),
  Photo: z.string().nullish(),
  Description: z.string().nullish(),
  Location: z.string().nullish(),
  StartDate: z.string().nullish(),
  EndDate: z.string().nullish(),
  LotCount: z.number().nullish(),
  Query: z.looseObject({ facets: z.string().nullish() }).nullish(),
});
export type AbcCampaign = z.infer<typeof campaignItemSchema>;
export const campaignListSchema = z.looseObject({ List: z.array(z.unknown()) });
