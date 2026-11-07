/**
 * "Sync now" also brings the device onto the latest published app. Every publish
 * produces new content-hashed /assets files, so comparing the files the live page
 * loads with the ones this page loaded tells us whether a newer version is out.
 */

const ASSET = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)/g;
/** Query flag the service worker passes straight to the network (never cached). */
export const UPDATE_CHECK_PARAM = "app-update-check";

/** Hashed script and style files referenced by a page's HTML. */
export function assetsInHtml(html: string): string[] {
  return [...new Set(html.match(ASSET) ?? [])].sort();
}

/** True when the live page loads files this page never loaded: a newer version is published. */
export function isNewerBuild(liveAssets: string[], loadedAssets: string[]): boolean {
  if (!liveAssets.length || !loadedAssets.length) return false;
  const loaded = new Set(loadedAssets);
  return liveAssets.some((a) => !loaded.has(a));
}

function loadedAssets(): string[] {
  const urls = [
    ...[...document.querySelectorAll<HTMLScriptElement>("script[src]")].map((s) => s.src),
    ...[...document.querySelectorAll<HTMLLinkElement>("link[href]")].map((l) => l.href),
    ...performance.getEntriesByType("resource").map((e) => e.name),
  ];
  return assetsInHtml(urls.join(" "));
}

/** Short id of the version this page runs (hash of its main file), shown so staff can compare counters. */
export function currentBuildId(): string {
  if (typeof document === "undefined") return "";
  const main = loadedAssets().find((a) => /\/assets\/index-/.test(a)) ?? loadedAssets()[0] ?? "";
  return main.replace(/^.*\/assets\/(?:index-)?/, "").replace(/\.(js|css)$/, "").slice(0, 8) || "dev";
}

/** Ask the server for the current page fresh, and say whether a newer app version is live. */
export async function checkForAppUpdate(): Promise<boolean> {
  if (typeof window === "undefined" || !navigator.onLine) return false;
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(UPDATE_CHECK_PARAM, String(Date.now()));
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) return false;
  const newer = isNewerBuild(assetsInHtml(await response.text()), loadedAssets());
  // Fetch the latest offline worker too, so the next open is current even offline.
  try { await (await navigator.serviceWorker?.getRegistration())?.update(); } catch { /* optional */ }
  return newer;
}

/** Switch to the newer version: activate any waiting worker, then reload. Bills and drafts are saved on the device. */
export async function applyAppUpdate(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.waiting?.postMessage("skip-waiting");
  } catch { /* reload still picks up the new pages */ }
  window.location.reload();
}

/** How often an open device looks for a newer published version (one small page fetch), so a publish reaches every terminal within ~30 s. */
export const UPDATE_CHECK_EVERY_MS = 30_000;
/** A device nobody has touched for this long updates on its own (drafts save within 0.15 s, so nothing is lost). */
export const IDLE_BEFORE_AUTO_UPDATE_MS = 10_000;

/**
 * Whether a found update can be applied without asking: the screen is hidden, or
 * nobody has touched it for a while and no dialog (payment, KOT, settings) is open.
 */
export function canUpdateUnattended(state: { hidden: boolean; idleMs: number; dialogOpen: boolean }): boolean {
  if (state.dialogOpen) return false;
  return state.hidden || state.idleMs >= IDLE_BEFORE_AUTO_UPDATE_MS;
}
