/*
 * Offline support for class phones (spec §8.2, §13). Only the roll-call and "My room" pages are kept,
 * so a teacher can reopen them without a connection; the taps themselves wait in IndexedDB
 * (src/lib/offline-queue.ts). Everything else always goes to the network.
 * Signing out deletes these copies (src/app/[locale]/(app)/more/SignOutButton.tsx).
 */
const PAGES = "yanmu-pages-v1";
const STATIC = "yanmu-static-v1";
const OFFLINE_PAGES = /^\/(ar|en)\/(roll-call|my-class)(\/|$)/;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PAGES, STATIC]);
      for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Built JavaScript and CSS never change under the same name: cache first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Roll call and My room: network first, the last copy when offline.
  if (req.mode === "navigate" && OFFLINE_PAGES.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(PAGES);
        try {
          const res = await fetch(req);
          if (res.ok && !res.redirected) cache.put(url.pathname, res.clone());
          return res;
        } catch {
          const hit = await cache.match(url.pathname);
          if (hit) return hit;
          throw new Error("offline");
        }
      })(),
    );
  }
});

/*
 * Alerts (spec §10). The message only names the kind of alert and the branch (rule 9); the details
 * are in the app. Critical alerts stay on screen until tapped.
 */
self.addEventListener("push", (event) => {
  let msg = { title: "Yanmu", body: "", url: "/", critical: false };
  try {
    msg = { ...msg, ...(event.data ? event.data.json() : {}) };
  } catch {
    // Not JSON: show the default.
  }
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      data: { url: msg.url },
      tag: msg.critical ? "critical" : undefined,
      renotify: Boolean(msg.critical),
      requireInteraction: Boolean(msg.critical),
      vibrate: msg.critical ? [300, 150, 300, 150, 300] : undefined,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of wins) {
        if (new URL(w.url).origin === self.location.origin && "focus" in w) {
          await w.navigate(url.href).catch(() => undefined);
          return w.focus();
        }
      }
      return self.clients.openWindow(url.href);
    })(),
  );
});
