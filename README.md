# Lotline

**Know your line on every lot.** A private, invite-only dashboard for bidders at ABC Auctions (Zimbabwe), built on ABC's public lot API:

- live prices and soft-close-aware countdowns;
- an exact winning/outbid status;
- budgets that include the purchaser's levy and VAT;
- won items and payments;
- what things actually sell for.

Lotline is an independent tool. It is not affiliated with ABC Auctions. It never logs in to ABC, never stores ABC credentials and never places bids: bidding happens on ABC's own site.

## Architecture

```
browser ──▶ web (Next.js 16) ──▶ Postgres ◀── worker (Node) ──▶ ABC public API
```

- **Only the worker talks to ABC.** It runs one polite, shared poller: at most 6 concurrent requests and 3 per second, tiered by how soon each lot closes.
- **The web app reads Postgres.** It asks the worker for fresh data through a queue.
- **Live data:** browsers poll `/api/live`. Web Push reaches locked phones.

See `docs/abc-api.md` for what we know about the API, and `docs/adr/` for decisions.

## Development

Requires Node 22 and Postgres 16.

```bash
npm install
cp .env.example .env.local   # then fill it in
npm run dev                  # web on http://localhost:3000
npm run check                # lint + typecheck + unit tests
npm run discover             # re-probe the ABC API (read-only, ≤1 req/s)
```

### Local database (one-time, in your own terminal)

```bash
sudo -u postgres psql -c "CREATE ROLE lotline LOGIN PASSWORD '<choose>' CREATEDB;"
sudo -u postgres createdb -O lotline lotline
sudo -u postgres psql -d lotline -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
```

### The worker

`npm run dev:worker` runs the background worker (the only part that talks to ABC):

- **Catalogue:** a full sync of open lots every 10 minutes by day and 30 at night. That's about 2,500 lots in 7 requests of 500.
- **Sold sweep:** sold lots go into market insights every 3 hours. The first run backfills about 1,500.
- **Details:** each lot's category, condition, fees and photos are fetched one at a time, every few seconds. Once every open lot has them, the worker completes sold lots for market insights.
- **Requests from the app:** handled as they arrive (LISTEN `lotline_fetch`).

All requests share one limiter (≤ 6 concurrent, ≤ 3/s) and a circuit breaker. `ABC_POLLING_ENABLED=false` stops everything. Only one worker polls at a time: a second instance stands by and takes over within seconds (Postgres advisory lock). Health: `GET http://localhost:8081/healthz`.

### Search

Browse and ⌘K search the whole open catalogue in the browser. `/api/catalogue` sends about 2,500 lots once (with an ETag, so later checks are cheap), and `src/lib/search/engine.ts` indexes them with MiniSearch. Every keystroke returns in about 1–3 ms.

- **Typos:** 1 edit allowed from 4 letters, 2 from 7.
- **Prefix:** the word being typed matches as a prefix.
- **Words:** synonyms, plurals and accents are handled.
- **Field weights:** title ≫ category/specs ≫ condition/location.
- **All words, then any:** every word must match; if nothing does, it falls back to any word.
- **Lot jumps:** an Id, an ABC lot number or a pasted link goes straight to the lot.
- **Facet counts:** each facet ignores its own selection, Algolia-style.
- **Runs:** near-identical lots closing the same day are grouped, and each lot shows its position (#3 of 6). Prices tend to rise toward the end of a run, as people who lost earlier lots move on.

### Signing in locally

Lotline is invite-only. The account named by `OWNER_EMAIL` in `.env.local` can always sign in and becomes the admin:

1. Set `OWNER_EMAIL=you@example.com` in `.env.local`.
2. `npm run dev`, open http://localhost:3000 and enter that email.
3. In development (`AUTH_EMAIL_MODE=console`) the sign-in link is printed in the terminal running the app.

Invite others from **Admin → People**. You get a link to send privately; it signs them in once and lasts 7 days. The same form makes a fresh sign-in link for an existing member.

### The assistant ("Ask Lotline")

`/assistant` is a chat with Claude (Opus 5.5) that answers from Lotline's own data through tools: search open lots, read a lot, list auctions, past prices (including whether lots late in a run fetch more), fees and the bid ladder, and the person's watchlist. It can propose watching or unwatching a lot; nothing changes until the person taps Confirm. It never bids.

- Set `ANTHROPIC_API_KEY` in `.env.local` (and in Railway's variables) and restart `npm run dev`.
- Every model call is priced from its usage and recorded in `ai_usage`; a person's questions stop when they reach their monthly cap (`user_settings.ai_cap_cents`, default $10).
- Conversations are stored append-only (`ai_messages`), exactly as sent and received: Claude's thinking blocks are only valid in the history that produced them.
- The system prompt and tools are frozen and cached; per-question context (time, name, location) goes in a system message after the question.
- Refusals from Claude's safety classifiers are retried on Anthropic's recommended fallback model (`fallbacks: "default"`).
- Tests and the e2e suite use a scripted stand-in (`ASSISTANT_MODE=fake`, set by `scripts/with-test-db.mjs`) and never call Anthropic.

### End-to-end tests

E2E runs against a separate `lotline_test` database (create it once: `createdb -O lotline lotline_test`, then `CREATE EXTENSION pg_trgm` in it) with a throwaway owner, `owner@lotline.test`:

```bash
node scripts/with-test-db.mjs npx tsx scripts/migrate.ts
node scripts/with-test-db.mjs npx next dev -p 3001 > /tmp/lotline-e2e.log 2>&1 &
E2E_SERVER_LOG=/tmp/lotline-e2e.log npm run e2e
```

Playwright uses your installed Chrome. A setup step signs the owner in once through the real form; the tests reuse that session.

Tests never call ABC. They use the scrubbed fixtures in `tests/fixtures/abc/`, which contain no real bidder IDs; a test enforces that.
