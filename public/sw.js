/* XTSY POS service worker: makes the installed apps open and keep working offline.
 *
 * - Pages: network first (so every deploy reaches devices on next load), the
 *   last good copy of that page when offline.
 * - Built assets (/assets/*, content-hashed): cache first.
 * - Icons, manifests, fonts: served from cache, refreshed in the background.
 * - Never touches API calls, server functions, Supabase or non-GET requests.
 */
const VERSION = "xtsy-pos-v2";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const STATIC = `${VERSION}-static`;
const START_PAGES = ["/", "/waiter", "/insights"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES).then((cache) => Promise.allSettled(START_PAGES.map((url) => cache.add(new Request(url, { cache: "reload" }))))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isBypassed(url, request) {
  if (request.method !== "GET") return true;
  if (url.origin === self.location.origin) {
    return url.pathname.startsWith("/api") || url.pathname.startsWith("/_serverFn") || url.pathname.startsWith("/_server") || url.pathname === "/sw.js";
  }
  // Cache Google Fonts only; everything else cross-origin (Supabase, analytics) goes straight to the network.
  return !(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com");
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES);
  const key = new URL(request.url);
  key.search = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(request, { signal: controller.signal });
    clearTimeout(timer);
    if (response.ok && response.type === "basic") cache.put(key.toString(), response.clone());
    return response;
  } catch {
    const exact = await cache.match(key.toString());
    if (exact) return exact;
    const app = START_PAGES.slice().sort((a, b) => b.length - a.length).find((p) => key.pathname.startsWith(p)) || "/";
    const fallback = await cache.match(new URL(app, self.location.origin).toString());
    return fallback || new Response("<h1>You're offline</h1><p>Open this app once while online so it can work offline.</p>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((response) => { if (response.ok) cache.put(request, response.clone()); return response; }).catch(() => hit);
  return hit || refresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isBypassed(url, request)) return;
  if (request.mode === "navigate") { event.respondWith(networkFirstPage(request)); return; }
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) { event.respondWith(cacheFirst(request, ASSETS)); return; }
  event.respondWith(staleWhileRevalidate(request, STATIC));
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
