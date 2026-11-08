/*
 * Lotline service worker: shows push alerts and opens the right page when one is tapped.
 * Deliberately no fetch handler and no caching: prices must never come from a stale cache.
 */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Lotline", body: event.data ? event.data.text() : "" };
  }
  const urgent = data.kind === "outbid";
  event.waitUntil(
    self.registration.showNotification(data.title || "Lotline", {
      body: data.body || "",
      // One notification per lot: a newer alert about the same lot replaces the old one.
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: urgent,
      vibrate: urgent ? [200, 100, 200] : [100],
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      timestamp: data.at ? Date.parse(data.at) : Date.now(),
      data: { url: data.url || "/watchlist" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(
    event.notification.data?.url || "/watchlist",
    self.location.origin,
  ).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        try {
          await w.navigate(url);
        } catch {
          // an uncontrolled window can't be navigated from here: open a fresh one instead
          await self.clients.openWindow(url);
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
