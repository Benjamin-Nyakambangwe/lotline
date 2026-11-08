ALTER TABLE "campaigns" ADD COLUMN "abc_id" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "kind" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "closes_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "lot_count" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_abc_id_unique" UNIQUE("abc_id");