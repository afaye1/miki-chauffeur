const CACHE = "miki-shell-v7";
const SHELL = [
  "/",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") return;
  if (req.method !== "GET") return;

  if (url.origin === location.origin) {
    // Network-first for shell docs so copy/style updates land immediately.
    const isHtmlOrScript =
      req.destination === "document" ||
      req.destination === "script" ||
      req.destination === "style" ||
      url.pathname.endsWith(".html") ||
      url.pathname.endsWith(".js") ||
      url.pathname.endsWith(".css") ||
      url.pathname === "/";
    if (isHtmlOrScript) {
      event.respondWith(
        fetch(req)
          .then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
          .catch(() => caches.match(req).then((hit) => hit || caches.match("/")))
      );
      return;
    }
    // Cache-first for images/fonts
    event.respondWith(
      caches.match(req).then((hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        }).catch(() => caches.match("/"))
      )
    );
  }
});
