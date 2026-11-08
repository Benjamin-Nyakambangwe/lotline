# Runbook

## Production (Railway)

One Railway project, `lotline`, environment `production`, everything in **EU West (Amsterdam, `europe-west4-drams3a`)**, the region closest to Zimbabwe. Pushing to `main` on GitHub redeploys both app services.

| Service | Source | Build | Start | Notes |
|---|---|---|---|---|
| `web` | GitHub `main` | `npm run build:all` | `npm run start` | Pre-deploy: `npm run start:migrate` (applies `drizzle/` migrations). Health check: `/api/health`. Public URL: https://web-production-a9571.up.railway.app |
| `worker` | GitHub `main` | `npm run build:worker` | `npm run start:worker` | Restart policy: always. 15 s draining, so it shuts down cleanly. No public URL. |
| `Postgres` | Railway template (Postgres 18) | | | Private network only: no public TCP proxy. |

Variables (values live in Railway, never in the repo):

- `web`: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `APP_URL` and `BETTER_AUTH_URL` = `https://${{RAILWAY_PUBLIC_DOMAIN}}`, `BETTER_AUTH_SECRET` (random, 48 bytes), `OWNER_EMAIL`, `AUTH_EMAIL_MODE=link-copy`, and optionally `ANTHROPIC_API_KEY` for the assistant.
- `worker`: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `LOG_LEVEL=info`. Everything else uses the defaults in `src/worker/config.ts` (the polite ABC limits, the history backfill).

Only one worker may poll ABC with history on: production. Local development keeps `HISTORY_ENABLED=false` in `.env.local`.

### Signing in

There's no email service yet (`AUTH_EMAIL_MODE=link-copy`):

- **Owner:** on the sign-in page, enter the owner email. The one-time link (15 minutes) appears in the web service's logs: Railway → `web` → Logs, or `railway logs --service web`. Look for `owner sign-in link`.
- **Everyone else:** the owner creates an invite in Admin → Invites and sends them the link. Sessions last 30 days.

To use email instead, set `RESEND_API_KEY`, `EMAIL_FROM` and `AUTH_EMAIL_MODE=resend` on `web`.

### Checking on it

- `GET /api/health`: database reachable (Railway's deploy check). `GET /api/health?strict`: also fails when the worker's heartbeat is older than 2 minutes. Point an uptime monitor at the strict one.
- `railway logs --service worker`: look for `catalogue synced`, `auctions synced`, `history backfill progress`, and `loop run failed` (a few right after a deploy are normal: the worker can start before the web service has migrated).
- `railway logs --service web`: request errors, sign-in links.

### Common jobs

- **Stop all ABC traffic now:** set `ABC_POLLING_ENABLED=false` on `worker`. Links to ABC keep working.
- **Redeploy without a code change:** `railway service redeploy --service web --from-source --yes`.
- **Change a setting:** `railway variable set KEY=value --service worker` (redeploys that service).
- **Deploy freeze:** avoid deploying between 16:00 and 22:00 Harare on close days; a restart mid-close delays live status by a minute or two.

## Auction-night checklist

Before the first real night (and after big changes):

1. `/api/health?strict` is green; the worker log shows a recent `catalogue synced`.
2. Your ABC bidder number is linked (Watchlist says "Exact status").
3. Watch a lot closing tonight: its countdown matches ABC's site within a couple of seconds, and the Watchlist shows it.
4. Turn on Sound and Keep awake on the Watchlist.
5. After the close: won/lost appear within about a minute; next morning, compare with ABC's "my bids" page.
