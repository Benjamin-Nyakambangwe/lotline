ALTER TABLE "lots" ADD COLUMN "opening_bid" numeric(12, 2);--> statement-breakpoint
-- ABC's search listing reports the opening price as StartingBid, and it was stored as the next
-- bid. A stored value at or below the current bid can only be that opening price: keep it as
-- such, and recompute the next bid from ABC's ladder (see src/lib/domain/increments.ts).
UPDATE "lots" SET "opening_bid" = "starting_bid"
WHERE "current_bid" IS NULL OR "starting_bid" <= "current_bid";
--> statement-breakpoint
UPDATE "lots" SET "starting_bid" = "current_bid" + CASE
    WHEN "current_bid" < 10 THEN 1 WHEN "current_bid" < 20 THEN 2 WHEN "current_bid" < 50 THEN 5
    WHEN "current_bid" < 200 THEN 10 WHEN "current_bid" < 500 THEN 25
    WHEN "current_bid" < 1000 THEN 50 ELSE 100 END
WHERE "current_bid" IS NOT NULL AND "starting_bid" <= "current_bid";
--> statement-breakpoint
UPDATE "lot_snapshots" SET "starting_bid" = "current_bid" + CASE
    WHEN "current_bid" < 10 THEN 1 WHEN "current_bid" < 20 THEN 2 WHEN "current_bid" < 50 THEN 5
    WHEN "current_bid" < 200 THEN 10 WHEN "current_bid" < 500 THEN 25
    WHEN "current_bid" < 1000 THEN 50 ELSE 100 END
WHERE "current_bid" IS NOT NULL AND "starting_bid" <= "current_bid";
--> statement-breakpoint
UPDATE "closed_prices" cp SET "opening_bid" = l."opening_bid"
FROM "lots" l
WHERE l."id" = cp."lot_id" AND cp."opening_bid" IS NULL AND l."opening_bid" IS NOT NULL;
