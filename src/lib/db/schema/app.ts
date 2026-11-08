import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

/*
 * Conventions
 * - Money: numeric(12,2) in dollars here; integer cents in domain code (lib/domain/money.ts).
 * - Times: timestamptz (UTC). Display in Africa/Harare.
 * - Every user-owned table has user_id; the data access layer scopes every query by it.
 * - Privacy: ABC bidder IDs live only in lots.current_bidder_id / final_bidder_id, only for
 *   lots someone tracks, and are purged 14 days after close. Never in snapshots or insights.
 */

const ts = (name: string) => timestamp(name, { withTimezone: true });
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });
const rate = (name: string) => numeric(name, { precision: 6, scale: 4 });
const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();
const userRef = () =>
  text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

// ---------------------------------------------------------------- auth extras

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").$type<"member" | "admin">().notNull().default("member"),
    invitedBy: text("invited_by").references(() => user.id, {
      onDelete: "set null",
    }),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    revokedAt: ts("revoked_at"),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("invites_pending_email_idx")
      .on(sql`lower(${t.email})`)
      .where(sql`${t.acceptedAt} is null and ${t.revokedAt} is null`),
  ],
);

export const userSettings = pgTable("user_settings", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  /** the user's own ABC bidder ID; unique so one ABC bidder maps to one app user */
  abcBidderId: integer("abc_bidder_id").unique(),
  bidderLinkedAt: ts("bidder_linked_at"),
  bidderLinkLotId: integer("bidder_link_lot_id"),
  theme: text("theme")
    .$type<"dark" | "light" | "system">()
    .notNull()
    .default("dark"),
  tz: text("tz").notNull().default("Africa/Harare"),
  priceDisplay: text("price_display")
    .$type<"allin" | "hammer">()
    .notNull()
    .default("allin"),
  showPhotos: boolean("show_photos").notNull().default(true),
  density: text("density")
    .$type<"comfortable" | "compact">()
    .notNull()
    .default("comfortable"),
  reduceMotion: boolean("reduce_motion").notNull().default(false),
  /** the assistant's monthly spending cap for this person, in US cents */
  aiCapCents: integer("ai_cap_cents").notNull().default(1000),
  alertPrefs: jsonb("alert_prefs")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  monthlyBudget: money("monthly_budget"),
  updatedAt: updated(),
});

// ---------------------------------------------------------------- catalogue

export const campaigns = pgTable("campaigns", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code"),
  location: text("location"),
  /** from ABC's auction list: its id, cover photo, type ("Goods", "Yard Special"), address */
  abcId: integer("abc_id").unique(),
  photoUrl: text("photo_url"),
  kind: text("kind"),
  address: text("address"),
  startAt: ts("start_at"),
  /** when its lots start closing (ABC's EndDate) */
  closesFrom: ts("closes_from"),
  lotCount: integer("lot_count"),
  firstSeen: ts("first_seen").notNull().defaultNow(),
  lastSeen: ts("last_seen").notNull().defaultNow(),
  earliestEnd: ts("earliest_end"),
  latestEnd: ts("latest_end"),
});

export type GalleryItem = { zoom: string; thumb: string | null };
export type Viewing = {
  title: string | null;
  subtitle: string | null;
  descriptionHtml: string | null;
};
export type Destination = {
  id: number | null;
  title: string;
  price: number | null;
  tax: number | null;
  currency: string | null;
};

export const lots = pgTable(
  "lots",
  {
    /** ABC lot Id */
    id: integer("id").primaryKey(),
    type: smallint("type").notNull().default(1),
    auctionLotId: integer("auction_lot_id"),
    lotNumber: bigint("lot_number", { mode: "number" }),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    photoUrl: text("photo_url"),
    thumbUrl: text("thumb_url"),
    location: text("location"),
    sublocation: text("sublocation"),
    campaignId: integer("campaign_id").references(() => campaigns.id, {
      onDelete: "set null",
    }),
    categoryPath: text("category_path"),
    category: text("category"),
    subCategory: text("sub_category"),
    finalCategory: text("final_category"),
    condition: text("condition"),
    state: text("state"),
    size: text("size"),
    quantityText: text("quantity_text"),
    quantityN: integer("quantity_n").notNull().default(1),
    currency: text("currency").notNull().default("USD"),
    /** ABC StartingBid: the next minimum bid */
    startingBid: money("starting_bid"),
    /** the opening price (ABC search listings report it as StartingBid) */
    openingBid: money("opening_bid"),
    currentBid: money("current_bid"),
    /** stored only while some user tracks this lot */
    currentBidderId: integer("current_bidder_id"),
    status: smallint("status"),
    saleStatus: smallint("sale_status"),
    stc: boolean("stc").notNull().default(false),
    startAt: ts("start_at"),
    /** last real end time (placeholders ignored); may only move later */
    endAt: ts("end_at"),
    originalEndAt: ts("original_end_at"),
    extensionsCount: integer("extensions_count").notNull().default(0),
    offerWindowEndAt: ts("offer_window_end_at"),
    levyRate: rate("levy_rate"),
    vatRate: rate("vat_rate"),
    lotVatRate: rate("lot_vat_rate"),
    descriptionHtml: text("description_html"),
    gallery: jsonb("gallery").$type<GalleryItem[]>(),
    viewing: jsonb("viewing").$type<Viewing>(),
    destinations: jsonb("destinations").$type<Destination[]>(),
    attrs: jsonb("attrs").$type<Record<string, unknown>>(),
    listSeenAt: ts("list_seen_at"),
    detailFetchedAt: ts("detail_fetched_at"),
    priceObservedAt: ts("price_observed_at"),
    closedAt: ts("closed_at"),
    finalPrice: money("final_price"),
    finalBidderId: integer("final_bidder_id"),
    finalState: text("final_state")
      .$type<"open" | "closing" | "final" | "final_assumed">()
      .notNull()
      .default("open"),
    finalReason: text("final_reason").$type<
      "sold" | "passed" | "time" | "assumed"
    >(),
    searchTsv: tsvector("search_tsv").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(category_path, '') || ' ' || coalesce(lot_number::text, ''))`,
    ),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("lots_status_end_idx").on(t.status, t.endAt),
    index("lots_end_idx").on(t.endAt, t.id),
    index("lots_search_idx").using("gin", t.searchTsv),
    index("lots_title_trgm_idx").using("gin", t.titleNorm.op("gin_trgm_ops")),
    index("lots_final_category_idx").on(t.finalCategory),
    index("lots_campaign_idx").on(t.campaignId),
    index("lots_lot_number_idx").on(t.lotNumber),
  ],
);

/** Worker scheduling state per lot, kept apart so `lots` isn't churned by bookkeeping. */
export const lotPoll = pgTable(
  "lot_poll",
  {
    lotId: integer("lot_id")
      .primaryKey()
      .references(() => lots.id, { onDelete: "cascade" }),
    tier: text("tier")
      .$type<"cold" | "warm" | "near" | "hot" | "done">()
      .notNull()
      .default("cold"),
    nextDueAt: ts("next_due_at").notNull().defaultNow(),
    lastFetchAt: ts("last_fetch_at"),
    stableAfterEnd: integer("stable_after_end").notNull().default(0),
    consecutiveErrors: integer("consecutive_errors").notNull().default(0),
    lastError: text("last_error"),
  },
  (t) => [index("lot_poll_due_idx").on(t.nextDueAt)],
);

/** Price history, written only when something changes (plus an hourly heartbeat). No bidder IDs. */
export const lotSnapshots = pgTable(
  "lot_snapshots",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    observedAt: ts("observed_at").notNull(),
    currentBid: money("current_bid"),
    startingBid: money("starting_bid"),
    endAt: ts("end_at"),
    leaderChanged: boolean("leader_changed").notNull().default(false),
    source: text("source").$type<"detail" | "search">().notNull(),
  },
  (t) => [index("lot_snapshots_lot_idx").on(t.lotId, t.observedAt)],
);

// ---------------------------------------------------------------- tracking

/** One row per user per lot: watching, my bid, my max, and status bookkeeping. */
export const userLots = pgTable(
  "user_lots",
  {
    userId: userRef(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    watching: boolean("watching").notNull().default(true),
    pinned: boolean("pinned").notNull().default(false),
    note: text("note"),
    alertEndingSoon: boolean("alert_ending_soon"),
    /** highest amount the user bid (or set as a proxy max) on ABC: the manual fallback */
    myBid: money("my_bid"),
    /** the user's planned line (hammer) */
    maxBid: money("max_bid"),
    usedValueLow: money("used_value_low"),
    usedValueHigh: money("used_value_high"),
    everLed: boolean("ever_led").notNull().default(false),
    firstLedAt: ts("first_led_at"),
    lastLedAt: ts("last_led_at"),
    lastStatus: text("last_status"),
    lastConfidence: text("last_confidence"),
    statusChangedAt: ts("status_changed_at"),
    outcome: text("outcome").$type<"won" | "won_est" | "lost">(),
    archivedAt: ts("archived_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.lotId] }),
    index("user_lots_lot_idx").on(t.lotId),
  ],
);

// ---------------------------------------------------------------- projects

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    name: text("name").notNull(),
    color: text("color"),
    budgetAllIn: money("budget_all_in"),
    status: text("status")
      .$type<"planning" | "live" | "done" | "archived">()
      .notNull()
      .default("planning"),
    notes: text("notes"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("projects_user_idx").on(t.userId)],
);

export const projectNeeds = pgTable(
  "project_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    quantity: integer("quantity").notNull().default(1),
    slotMaxHammer: money("slot_max_hammer"),
    required: boolean("required").notNull().default(true),
    countsTowardBudget: boolean("counts_toward_budget").notNull().default(true),
    sort: integer("sort").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("project_needs_project_idx").on(t.projectId)],
);

export const projectCandidates = pgTable(
  "project_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    needId: uuid("need_id")
      .notNull()
      .references(() => projectNeeds.id, { onDelete: "cascade" }),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    /** 1 = primary; higher = ordered backups */
    rank: integer("rank").notNull().default(1),
    maxHammerOverride: money("max_hammer_override"),
    tag: text("tag"),
    note: text("note"),
    state: text("state")
      .$type<"active" | "skipped" | "won" | "lost" | "ended">()
      .notNull()
      .default("active"),
  },
  (t) => [
    unique("project_candidates_need_lot").on(t.needId, t.lotId),
    index("project_candidates_lot_idx").on(t.lotId),
  ],
);

// ---------------------------------------------------------------- won & payments

export type ChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  at?: string;
};

export const wonItems = pgTable(
  "won_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "restrict" }),
    projectId: uuid("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    needId: uuid("need_id").references(() => projectNeeds.id, {
      onDelete: "set null",
    }),
    hammer: money("hammer").notNull(),
    levyRate: rate("levy_rate"),
    vatRate: rate("vat_rate"),
    lotVatRate: rate("lot_vat_rate"),
    allIn: money("all_in").notNull(),
    currency: text("currency").notNull().default("USD"),
    wonAt: ts("won_at").notNull(),
    stcPending: boolean("stc_pending").notNull().default(false),
    needsConfirmation: boolean("needs_confirmation").notNull().default(false),
    payBy: date("pay_by"),
    paidAt: ts("paid_at"),
    paidAmount: money("paid_amount"),
    payMethod: text("pay_method"),
    payRef: text("pay_ref"),
    fulfilment: text("fulfilment")
      .$type<"collect" | "delivery">()
      .notNull()
      .default("collect"),
    deliveryDestination: text("delivery_destination"),
    deliveryFee: money("delivery_fee"),
    pickupLocation: text("pickup_location"),
    collectedAt: ts("collected_at"),
    checklist: jsonb("checklist")
      .$type<ChecklistItem[]>()
      .notNull()
      .default([]),
    notes: text("notes"),
    source: text("source")
      .$type<"bidder_id" | "manual_estimate" | "user_marked">()
      .notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    unique("won_items_user_lot").on(t.userId, t.lotId),
    index("won_items_user_payby_idx").on(t.userId, t.payBy),
  ],
);

// ---------------------------------------------------------------- market insights (shared, no bidder data)

export const closedPrices = pgTable(
  "closed_prices",
  {
    lotId: integer("lot_id").primaryKey(),
    title: text("title").notNull(),
    titleNorm: text("title_norm").notNull(),
    attrs: jsonb("attrs").$type<Record<string, unknown>>(),
    categoryPath: text("category_path"),
    category: text("category"),
    subCategory: text("sub_category"),
    finalCategory: text("final_category"),
    campaign: text("campaign"),
    location: text("location"),
    condition: text("condition"),
    state: text("state"),
    quantityN: integer("quantity_n").notNull().default(1),
    /** null = passed unsold */
    finalHammer: money("final_hammer"),
    unitPrice: money("unit_price"),
    allIn: money("all_in"),
    openingBid: money("opening_bid"),
    hadBids: boolean("had_bids").notNull().default(false),
    stc: boolean("stc").notNull().default(false),
    closedAt: ts("closed_at"),
    closedAtApprox: boolean("closed_at_approx").notNull().default(false),
    extensions: integer("extensions"),
    confidence: text("confidence")
      .$type<"observed" | "sweep" | "backfill">()
      .notNull(),
    /** when we last read this lot's detail for categories, fees and the real close time */
    detailFetchedAt: ts("detail_fetched_at"),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    index("closed_prices_title_trgm_idx").using(
      "gin",
      t.titleNorm.op("gin_trgm_ops"),
    ),
    index("closed_prices_category_idx").on(t.finalCategory, t.closedAt),
    index("closed_prices_closed_idx").on(t.closedAt),
  ],
);

// ---------------------------------------------------------------- notifications & push

export const notifications = pgTable(
  "notifications",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: userRef(),
    kind: text("kind")
      .$type<
        | "outbid"
        | "winning"
        | "ending_soon"
        | "extended"
        | "won"
        | "lost"
        | "backup_next"
        | "pay_due"
        | "system"
      >()
      .notNull(),
    lotId: integer("lot_id"),
    projectId: uuid("project_id"),
    title: text("title").notNull(),
    body: text("body"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: created(),
    readAt: ts("read_at"),
    pushedAt: ts("pushed_at"),
  },
  (t) => [
    unique("notifications_user_dedupe").on(t.userId, t.dedupeKey),
    index("notifications_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    label: text("label"),
    createdAt: created(),
    lastSuccessAt: ts("last_success_at"),
    failureCount: integer("failure_count").notNull().default(0),
    disabledAt: ts("disabled_at"),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- worker plumbing

/** The web app asks the worker for fresh data here (plus NOTIFY lotline_fetch). */
export const fetchRequests = pgTable(
  "fetch_requests",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    lotId: integer("lot_id").notNull(),
    requestedBy: text("requested_by"),
    reason: text("reason")
      .$type<"view" | "capture" | "add" | "lookup">()
      .notNull(),
    lotNumber: bigint("lot_number", { mode: "number" }),
    requestedAt: ts("requested_at").notNull().defaultNow(),
    doneAt: ts("done_at"),
    error: text("error"),
  },
  (t) => [
    index("fetch_requests_pending_idx")
      .on(t.requestedAt)
      .where(sql`${t.doneAt} is null`),
  ],
);

export const workerHeartbeat = pgTable("worker_heartbeat", {
  id: smallint("id").primaryKey().default(1),
  instanceId: text("instance_id").notNull(),
  leaderSince: ts("leader_since"),
  lastTickAt: ts("last_tick_at").notNull(),
  abcHealth: jsonb("abc_health").$type<Record<string, unknown>>(),
  breaker: text("breaker"),
  reqToday: integer("req_today").notNull().default(0),
  reqPerMin: integer("req_per_min").notNull().default(0),
  queueDepths: jsonb("queue_depths").$type<Record<string, number>>(),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    kind: text("kind")
      .$type<"catalogue" | "sold" | "pending" | "enrich">()
      .notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    pages: integer("pages").notNull().default(0),
    upserts: integer("upserts").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    notes: text("notes"),
  },
  (t) => [index("sync_runs_kind_started_idx").on(t.kind, t.startedAt)],
);

/**
 * The historical backfill: ABC's search only lists recent sold lots, but lot detail still
 * serves old ones by ID, so the worker walks IDs downward (one crawl per lot type). All
 * progress lives here, so a restart resumes from next_id.
 */
export const historyCrawls = pgTable("history_crawls", {
  key: text("key").$type<"goods" | "vehicles">().primaryKey(),
  /** ABC lot type: 1 goods, 2 vehicles (separate ID ranges) */
  type: smallint("type").notNull(),
  startId: integer("start_id").notNull(),
  /** the next ID to fetch, walking down */
  nextId: integer("next_id").notNull(),
  /** stop once lots are consistently older than this */
  cutoff: ts("cutoff").notNull(),
  /** moving share of recent (after cutoff) lots among the last few hundred dated ones */
  recentEma: real("recent_ema").notNull().default(1),
  dated: integer("dated").notNull().default(0),
  /** latest close (or start) date seen near the cursor, for progress */
  reachedAt: ts("reached_at"),
  missingStreak: integer("missing_streak").notNull().default(0),
  fetched: integer("fetched").notNull().default(0),
  sold: integer("sold").notNull().default(0),
  passed: integer("passed").notNull().default(0),
  other: integer("other").notNull().default(0),
  missing: integer("missing").notNull().default(0),
  skipped: integer("skipped").notNull().default(0),
  errors: integer("errors").notNull().default(0),
  /** requests made on `day` (UTC, matching the client's daily cap) */
  day: date("day", { mode: "string" }),
  dayCount: integer("day_count").notNull().default(0),
  startedAt: ts("started_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  doneAt: ts("done_at"),
  doneReason: text("done_reason"),
});

/*
 * The assistant. Conversations are append-only: Claude's thinking blocks are only valid in the
 * exact history that produced them, so messages are stored as the API returned them and never
 * edited. Every model call is priced and recorded in ai_usage for the per-person monthly cap.
 */
export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    title: text("title").notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    role: text("role").$type<"user" | "assistant" | "system">().notNull(),
    /** the message content exactly as sent to or returned by the API */
    content: jsonb("content").$type<unknown>().notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex("ai_messages_seq_idx").on(t.conversationId, t.seq)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedAlwaysAsIdentity(),
    userId: userRef(),
    conversationId: uuid("conversation_id").references(
      () => aiConversations.id,
      { onDelete: "set null" },
    ),
    at: ts("at").notNull().defaultNow(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    /** cost in millionths of a US dollar */
    costMicros: bigint("cost_micros", { mode: "number" }).notNull(),
  },
  (t) => [index("ai_usage_user_at_idx").on(t.userId, t.at)],
);

/** Changes the assistant proposes; nothing happens until the person confirms. */
export const aiActions = pgTable(
  "ai_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: userRef(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversations.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"watch" | "unwatch">().notNull(),
    lotId: integer("lot_id")
      .notNull()
      .references(() => lots.id, { onDelete: "cascade" }),
    /** watch: { maxBid?: cents, note?: string } */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status")
      .$type<"pending" | "confirmed" | "declined">()
      .notNull()
      .default("pending"),
    createdAt: created(),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("ai_actions_conversation_idx").on(t.conversationId)],
);
