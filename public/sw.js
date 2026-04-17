// Kill-switch SW: unregisters itself and wipes all caches for existing clients.
// Served at /sw.js so any previously-registered worker that checks for updates
// replaces itself with this, then disappears on next load.

self.addEventListener("install", () => { self.skipWaiting(); });

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    } catch {}
    try {
      await self.registration.unregister();
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((c) => c.navigate(c.url));
    } catch {}
  })());
});
