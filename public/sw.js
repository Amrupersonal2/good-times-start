/* XTSY POS service worker: makes the installed apps open and keep working offline.
 *
 * - Pages: network first (so every deploy reaches devices on next load), but
 *   the saved copy opens after 3 s on a slow connection or at once offline.
 * - Built assets (/assets/*, content-hashed): cache first.
 * - Icons, manifests, fonts: served from cache, refreshed in the background.
 * - Never touches API calls, server functions, Supabase or non-GET requests.
 */
const VERSION = "xtsy-pos-v13";
const PAGES = `${VERSION}-pages`;
const ASSETS = `${VERSION}-assets`;
const STATIC = `${VERSION}-static`;
const START_PAGES = ["/", "/waiter", "/manager", "/dashboard", "/auth"];

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
    // "Sync now" checks for a newer published app: always ask the server, never a saved copy.
    if (url.searchParams.has("app-update-check")) return true;
    return url.pathname.startsWith("/api") || url.pathname.startsWith("/_serverFn") || url.pathname.startsWith("/_server") || url.pathname === "/sw.js";
  }
  // Cache Google Fonts only; everything else cross-origin (Supabase, analytics) goes straight to the network.
  return !(url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com");
}

// How long an opening page waits for the network when a saved copy exists.
// On weak connections the saved copy opens instead, while the network copy
// keeps downloading in the background and replaces it for the next open.
const FAST_FALLBACK_MS = 3000;
const NETWORK_TIMEOUT_MS = 15000;

async function cachedPageFor(cache, key) {
  const exact = await cache.match(key.toString());
  if (exact) return exact;
  const app = START_PAGES.slice().sort((a, b) => b.length - a.length).find((p) => key.pathname.startsWith(p)) || "/";
  return cache.match(new URL(app, self.location.origin).toString());
}

async function networkFirstPage(event) {
  const request = event.request;
  const cache = await caches.open(PAGES);
  const key = new URL(request.url);
  key.search = "";

  // Always revalidate navigations against the published origin. Hashed assets
  // can safely remain cache-first, but cached HTML can point at chunks from an
  // older deployment and leave the app stuck on its server-rendered shell, so
  // the network copy wins whenever it arrives in time and always refreshes the
  // saved copy.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  const network = fetch(request, { signal: controller.signal, cache: "no-store" })
    .then(async (response) => {
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && response.type === "basic" && contentType.includes("text/html") && !response.redirected) {
        await cache.put(key.toString(), response.clone());
      }
      return response;
    })
    .finally(() => clearTimeout(timer));
  // Keep the worker alive so a slow download still refreshes the saved page.
  event.waitUntil(network.catch(() => undefined));

  const cached = await cachedPageFor(cache, key);
  if (cached) {
    let fallbackTimer;
    const slow = new Promise((resolve) => { fallbackTimer = setTimeout(() => resolve(null), FAST_FALLBACK_MS); });
    try {
      const winner = await Promise.race([network, slow]);
      if (winner) return winner;
    } catch {
      // Network failed outright: fall through to the saved copy.
    } finally {
      clearTimeout(fallbackTimer);
    }
    return cached;
  }

  try {
    return await network;
  } catch {
    return new Response("<h1>You're offline</h1><p>Open this app once while online so it can work offline.</p>", { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
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
  if (request.mode === "navigate") { event.respondWith(networkFirstPage(event)); return; }
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) { event.respondWith(cacheFirst(request, ASSETS)); return; }
  event.respondWith(staleWhileRevalidate(request, STATIC));
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});
