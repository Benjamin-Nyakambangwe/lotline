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

### Signing in locally

Lotline is invite-only. The account named by `OWNER_EMAIL` in `.env.local` can always sign in and becomes the admin:

1. Set `OWNER_EMAIL=you@example.com` in `.env.local`.
2. `npm run dev`, open http://localhost:3000 and enter that email.
3. In development (`AUTH_EMAIL_MODE=console`) the sign-in link is printed in the terminal running the app.

Invite others from **Admin → People**. You get a link to send privately; it signs them in once and lasts 7 days. The same form makes a fresh sign-in link for an existing member.

### End-to-end tests

E2E runs against a separate `lotline_test` database (create it once: `createdb -O lotline lotline_test`, then `CREATE EXTENSION pg_trgm` in it) with a throwaway owner, `owner@lotline.test`:

```bash
node scripts/with-test-db.mjs npx tsx scripts/migrate.ts
node scripts/with-test-db.mjs npx next dev -p 3001 > /tmp/lotline-e2e.log 2>&1 &
E2E_SERVER_LOG=/tmp/lotline-e2e.log npm run e2e
```

Playwright uses your installed Chrome. A setup step signs the owner in once through the real form; the tests reuse that session.

Tests never call ABC. They use the scrubbed fixtures in `tests/fixtures/abc/`, which contain no real bidder IDs; a test enforces that.
