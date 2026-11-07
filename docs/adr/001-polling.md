# ADR 001: Adaptive polling for live data, Web Push for locked phones

**Status:** accepted, 7 Nov 2026

## Context

Auction night needs prices, countdowns and winning/outbid status within seconds, mostly on phones.

- ABC's API has no push channel and no CORS.
- Our own worker refreshes the hottest lots about every 8 s, so the source data can't change faster than that.

## Decision

Browsers poll `GET /api/live` adaptively:

- **2 s** while a lot you track closes within 10 minutes;
- **5 s** when something closes within the hour;
- **15 s** otherwise;
- **paused** while the tab is hidden, with a refetch on focus.

Responses carry an ETag, so unchanged data returns 304. The worker sends Web Push notifications (VAPID) for outbid, won and ending-soon events, which reach phones that are locked or have the app closed.

## Why not Server-Sent Events or WebSockets

- Mobile browsers kill background streams.
- Railway deploys cut long-lived connections.
- The data only changes every ~8 s at best, so a stream would save 1–2 s at most, at the cost of reconnect logic and server connection state.
- Push already covers the backgrounded case.

## Revisit if

We need sub-second updates, or the user count grows enough that polling load matters. Postgres LISTEN/NOTIFY → SSE would then be the natural upgrade.
