/*
 * Offline support for class phones (spec §8.2, §13). Only the roll-call and "My room" pages are kept,
 * so a teacher can reopen them without a connection; the taps themselves wait in IndexedDB
 * (src/lib/offline-queue.ts). Everything else always goes to the network.
 * Signing out deletes these copies (src/app/[locale]/(app)/more/SignOutButton.tsx).
 */
const PAGES = "yanmu-pages-v1";
const STATIC = "yanmu-static-v1";
const OFFLINE_PAGES = /^\/(ar|en)\/(roll-call|my-room)(\/|$)/;

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
