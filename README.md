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

Tests never call ABC. They use the scrubbed fixtures in `tests/fixtures/abc/`, which contain no real bidder IDs; a test enforces that.
