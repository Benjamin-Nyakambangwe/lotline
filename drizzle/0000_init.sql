-- pg_trgm powers fuzzy title search and market comparables.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"location" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"earliest_end" timestamp with time zone,
	"latest_end" timestamp with time zone,
	CONSTRAINT "campaigns_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "closed_prices" (
	"lot_id" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_norm" text NOT NULL,
	"attrs" jsonb,
	"category_path" text,
	"category" text,
	"sub_category" text,
	"final_category" text,
	"campaign" text,
	"location" text,
	"condition" text,
	"state" text,
	"quantity_n" integer DEFAULT 1 NOT NULL,
	"final_hammer" numeric(12, 2),
	"unit_price" numeric(12, 2),
	"all_in" numeric(12, 2),
	"opening_bid" numeric(12, 2),
	"had_bids" boolean DEFAULT false NOT NULL,
	"stc" boolean DEFAULT false NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_at_approx" boolean DEFAULT false NOT NULL,
	"extensions" integer,
	"confidence" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fetch_requests" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fetch_requests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lot_id" integer NOT NULL,
	"requested_by" text,
	"reason" text NOT NULL,
	"lot_number" bigint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "lot_poll" (
	"lot_id" integer PRIMARY KEY NOT NULL,
	"tier" text DEFAULT 'cold' NOT NULL,
	"next_due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetch_at" timestamp with time zone,
	"stable_after_end" integer DEFAULT 0 NOT NULL,
	"consecutive_errors" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "lot_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lot_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"lot_id" integer NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"current_bid" numeric(12, 2),
	"starting_bid" numeric(12, 2),
	"end_at" timestamp with time zone,
	"leader_changed" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" integer PRIMARY KEY NOT NULL,
	"type" smallint DEFAULT 1 NOT NULL,
	"auction_lot_id" integer,
	"lot_number" bigint,
	"title" text NOT NULL,
	"title_norm" text NOT NULL,
	"photo_url" text,
	"thumb_url" text,
	"location" text,
	"sublocation" text,
	"campaign_id" integer,
	"category_path" text,
	"category" text,
	"sub_category" text,
	"final_category" text,
	"condition" text,
	"state" text,
	"size" text,
	"quantity_text" text,
	"quantity_n" integer DEFAULT 1 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"starting_bid" numeric(12, 2),
	"current_bid" numeric(12, 2),
	"current_bidder_id" integer,
	"status" smallint,
	"sale_status" smallint,
	"stc" boolean DEFAULT false NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"original_end_at" timestamp with time zone,
	"extensions_count" integer DEFAULT 0 NOT NULL,
	"offer_window_end_at" timestamp with time zone,
	"levy_rate" numeric(6, 4),
	"vat_rate" numeric(6, 4),
	"lot_vat_rate" numeric(6, 4),
	"description_html" text,
	"gallery" jsonb,
	"viewing" jsonb,
	"destinations" jsonb,
	"attrs" jsonb,
	"list_seen_at" timestamp with time zone,
	"detail_fetched_at" timestamp with time zone,
	"price_observed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"final_price" numeric(12, 2),
	"final_bidder_id" integer,
	"final_state" text DEFAULT 'open' NOT NULL,
	"final_reason" text,
	"search_tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category_path, '') || ' ' || coalesce(lot_number::text, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "notifications_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"lot_id" integer,
	"project_id" uuid,
	"title" text NOT NULL,
	"body" text,
	"data" jsonb,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"pushed_at" timestamp with time zone,
	CONSTRAINT "notifications_user_dedupe" UNIQUE("user_id","dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "project_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"need_id" uuid NOT NULL,
	"lot_id" integer NOT NULL,
	"rank" integer DEFAULT 1 NOT NULL,
	"max_hammer_override" numeric(12, 2),
	"tag" text,
	"note" text,
	"state" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "project_candidates_need_lot" UNIQUE("need_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "project_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"title" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"slot_max_hammer" numeric(12, 2),
	"required" boolean DEFAULT true NOT NULL,
	"counts_toward_budget" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"budget_all_in" numeric(12, 2),
	"status" text DEFAULT 'planning' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"disabled_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sync_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"pages" integer DEFAULT 0 NOT NULL,
	"upserts" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "user_lots" (
	"user_id" text NOT NULL,
	"lot_id" integer NOT NULL,
	"watching" boolean DEFAULT true NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"note" text,
	"alert_ending_soon" boolean,
	"my_bid" numeric(12, 2),
	"max_bid" numeric(12, 2),
	"used_value_low" numeric(12, 2),
	"used_value_high" numeric(12, 2),
	"ever_led" boolean DEFAULT false NOT NULL,
	"first_led_at" timestamp with time zone,
	"last_led_at" timestamp with time zone,
	"last_status" text,
	"last_confidence" text,
	"status_changed_at" timestamp with time zone,
	"outcome" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_lots_user_id_lot_id_pk" PRIMARY KEY("user_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"abc_bidder_id" integer,
	"bidder_linked_at" timestamp with time zone,
	"bidder_link_lot_id" integer,
	"theme" text DEFAULT 'dark' NOT NULL,
	"tz" text DEFAULT 'Africa/Harare' NOT NULL,
	"price_display" text DEFAULT 'allin' NOT NULL,
	"show_photos" boolean DEFAULT true NOT NULL,
	"density" text DEFAULT 'comfortable' NOT NULL,
	"reduce_motion" boolean DEFAULT false NOT NULL,
	"alert_prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"monthly_budget" numeric(12, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_abc_bidder_id_unique" UNIQUE("abc_bidder_id")
);
--> statement-breakpoint
CREATE TABLE "won_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"lot_id" integer NOT NULL,
	"project_id" uuid,
	"need_id" uuid,
	"hammer" numeric(12, 2) NOT NULL,
	"levy_rate" numeric(6, 4),
	"vat_rate" numeric(6, 4),
	"lot_vat_rate" numeric(6, 4),
	"all_in" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"won_at" timestamp with time zone NOT NULL,
	"stc_pending" boolean DEFAULT false NOT NULL,
	"needs_confirmation" boolean DEFAULT false NOT NULL,
	"pay_by" date,
	"paid_at" timestamp with time zone,
	"paid_amount" numeric(12, 2),
	"pay_method" text,
	"pay_ref" text,
	"fulfilment" text DEFAULT 'collect' NOT NULL,
	"delivery_destination" text,
	"delivery_fee" numeric(12, 2),
	"pickup_location" text,
	"collected_at" timestamp with time zone,
	"checklist" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "won_items_user_lot" UNIQUE("user_id","lot_id")
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"instance_id" text NOT NULL,
	"leader_since" timestamp with time zone,
	"last_tick_at" timestamp with time zone NOT NULL,
	"abc_health" jsonb,
	"breaker" text,
	"req_today" integer DEFAULT 0 NOT NULL,
	"req_per_min" integer DEFAULT 0 NOT NULL,
	"queue_depths" jsonb
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'member',
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp with time zone,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_poll" ADD CONSTRAINT "lot_poll_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_snapshots" ADD CONSTRAINT "lot_snapshots_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_candidates" ADD CONSTRAINT "project_candidates_need_id_project_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."project_needs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_candidates" ADD CONSTRAINT "project_candidates_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_needs" ADD CONSTRAINT "project_needs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lots" ADD CONSTRAINT "user_lots_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_lots" ADD CONSTRAINT "user_lots_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "won_items" ADD CONSTRAINT "won_items_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "won_items" ADD CONSTRAINT "won_items_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "won_items" ADD CONSTRAINT "won_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "won_items" ADD CONSTRAINT "won_items_need_id_project_needs_id_fk" FOREIGN KEY ("need_id") REFERENCES "public"."project_needs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "closed_prices_title_trgm_idx" ON "closed_prices" USING gin ("title_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "closed_prices_category_idx" ON "closed_prices" USING btree ("final_category","closed_at");--> statement-breakpoint
CREATE INDEX "closed_prices_closed_idx" ON "closed_prices" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "fetch_requests_pending_idx" ON "fetch_requests" USING btree ("requested_at") WHERE "fetch_requests"."done_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "invites_pending_email_idx" ON "invites" USING btree (lower("email")) WHERE "invites"."accepted_at" is null and "invites"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "lot_poll_due_idx" ON "lot_poll" USING btree ("next_due_at");--> statement-breakpoint
CREATE INDEX "lot_snapshots_lot_idx" ON "lot_snapshots" USING btree ("lot_id","observed_at");--> statement-breakpoint
CREATE INDEX "lots_status_end_idx" ON "lots" USING btree ("status","end_at");--> statement-breakpoint
CREATE INDEX "lots_end_idx" ON "lots" USING btree ("end_at","id");--> statement-breakpoint
CREATE INDEX "lots_search_idx" ON "lots" USING gin ("search_tsv");--> statement-breakpoint
CREATE INDEX "lots_title_trgm_idx" ON "lots" USING gin ("title_norm" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "lots_final_category_idx" ON "lots" USING btree ("final_category");--> statement-breakpoint
CREATE INDEX "lots_campaign_idx" ON "lots" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "lots_lot_number_idx" ON "lots" USING btree ("lot_number");--> statement-breakpoint
CREATE INDEX "notifications_user_created_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "project_candidates_lot_idx" ON "project_candidates" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "project_needs_project_idx" ON "project_needs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "projects_user_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "push_subscriptions_user_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sync_runs_kind_started_idx" ON "sync_runs" USING btree ("kind","started_at");--> statement-breakpoint
CREATE INDEX "user_lots_lot_idx" ON "user_lots" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "won_items_user_payby_idx" ON "won_items" USING btree ("user_id","pay_by");--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_user_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");