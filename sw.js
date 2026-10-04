// Service worker for Ledgerly.
//
// Caching strategy is deliberately split, because a blanket cache-first would
// freeze people on an old build forever - the exact failure the ?v= build stamp
// exists to prevent:
//
//   version.json   -> network ONLY. It is how a running tab learns a new build
//                     shipped, so a cached copy would defeat the update check.
//   navigations    -> network first, cache as fallback. index.html carries the
//                     import map naming the current build, so it must be fresh
//                     when online, but still work on the tube.
//   ?v= assets     -> cache first, safely. A new build changes the URL, so a
//                     cached entry can never be stale - it just stops being asked for.
//   everything else-> straight to network, untouched (Firebase, the Worker API,
//                     Yahoo quotes - never cache live money data).
const BUILD = "20261004-004316";
const CACHE = `ledgerly-${BUILD}`;
const SHELL = ["./", "./index.html", "./manifest.json", "./icons/apple-touch-icon.png", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  // Take over as soon as installed rather than waiting for every tab to close.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  // One cache per build, so shipping a build evicts the previous one wholesale.
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin !== self.location.origin) return;        // Firebase, Worker, quotes
  if (url.pathname.endsWith("version.json")) return;      // must always hit network

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  if (url.searchParams.has("v")) {
    e.respondWith(
      caches.match(req).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
          return res;
        })
      )
    );
  }
});
