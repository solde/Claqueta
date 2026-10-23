// Service worker: offline support for the shell (static files) and read-only fallback for the API GETs the field work needs (rundowns, schedules, tasks...).
// Writes while offline are queued by the page itself (js/offline.js). Network first everywhere: the cache is only used when the network fails.
const V = "collado-v1"; const STATIC = `${V}-static`, API = `${V}-api`;
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(STATIC).then((c) => c.addAll(["./", "index.html", "app.css", "nb.css", "icon.svg", "manifest.webmanifest", "js/main.js"]).catch(() => {}))); });
self.addEventListener("activate", (e) => { e.waitUntil((async () => { for (const k of await caches.keys()) if (!k.startsWith(V)) await caches.delete(k); await self.clients.claim(); })()); });
const cacheableApi = (u) => /\/api\/(e\/|schema|i18n\/|me$|dashboard|reports\/(rundown|conflicts|gantt)|notifications|search|users)/.test(u.pathname);
self.addEventListener("fetch", (e) => {
  const req = e.request; if (req.method !== "GET") return; const url = new URL(req.url); if (url.origin !== location.origin) return;
  if (url.pathname.includes("/api/")) {
    if (!cacheableApi(url) || url.pathname.includes("/api/files/") || url.pathname.includes("/export/")) return;
    e.respondWith((async () => {
      try {
        const res = await fetch(req); const copy = res.clone();
        if (res.ok) { if (url.pathname.endsWith("/api/me")) { const j = await copy.clone().json().catch(() => null); const meta = await caches.open(`${V}-meta`); const id = j ? `${j.user}@${j.org || ""}` : ""; const prev = await meta.match("user").then((r) => r && r.text()); if (j && prev && prev !== id) await caches.delete(API); if (j) await meta.put("user", new Response(id));   // another person OR another organization: never show cached data of the previous one } const c = await caches.open(API); c.put(req, copy); }
        return res;
      } catch (err) { const hit = await caches.match(req, { cacheName: API }); if (hit) return hit; return new Response(JSON.stringify({ error: "offline" }), { status: 503, headers: { "content-type": "application/json" } }); }
    })()); return;
  }
  e.respondWith((async () => { try { const res = await fetch(req); if (res.ok) { const c = await caches.open(STATIC); c.put(req, res.clone()); } return res; } catch { return (await caches.match(req)) || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); } })());
});
