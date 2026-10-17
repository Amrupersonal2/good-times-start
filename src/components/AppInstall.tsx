import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Three installable apps from one codebase:
 *   /            XTSY POS (counter, desktop)
 *   /waiter      XTSY Waiter (tablet)
 *   /insights    XTSY Insights (owner's phone)
 * Each has its own manifest, icon and theme, chosen by the current path.
 */

export type AppKind = "pos" | "waiter" | "insights";

export function appForPath(pathname: string): AppKind {
  if (pathname === "/waiter" || pathname.startsWith("/waiter/")) return "waiter";
  if (pathname === "/insights" || pathname.startsWith("/insights/")) return "insights";
  return "pos";
}

const APP_META: Record<AppKind, { title: string; theme: string }> = {
  pos: { title: "XTSY POS", theme: "#17352E" },
  waiter: { title: "XTSY Waiter", theme: "#17352E" },
  insights: { title: "XTSY Insights", theme: "#0F2420" },
};

/* ---- install prompt (Chrome / Edge / Android) ---- */

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function shouldRegisterServiceWorker(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (window.location.protocol !== "https:") return false;
  // Not inside the Lovable editor preview (an iframe) or preview builds, so editing never serves a stale copy.
  if (window.self !== window.top) return false;
  return !/(^|\.)id-preview--|lovableproject\.com$/.test(window.location.hostname);
}

export function useInstallPrompt() {
  const available = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => deferred !== null,
    () => false,
  );
  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    deferred = null;
    emit();
  };
  return { available, install };
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/** Head tags for the current app, plus service worker registration. Mounted once in the root. */
export function AppInstall() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const app = appForPath(pathname);
  const meta = APP_META[app];

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; emit(); };
    const onInstalled = () => { deferred = null; emit(); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (shouldRegisterServiceWorker()) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* offline support is a bonus, never a blocker */ });
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // React 19 hoists these into <head> and updates them when the app changes.
  return (
    <>
      <link rel="manifest" href={`/manifest-${app}.webmanifest`} />
      <link rel="apple-touch-icon" href={`/icons/${app}-apple-180.png`} />
      <meta name="theme-color" content={meta.theme} />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content={meta.title} />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    </>
  );
}

/** "Install app" button; on iPhone and iPad shows how to add it to the home screen. */
export function InstallButton({ label = "Install app", className = "" }: { label?: string; className?: string }) {
  const { available, install } = useInstallPrompt();
  const [iosHelp, setIosHelp] = useState(false);
  const [standalone, setStandalone] = useState(true);
  useEffect(() => { setStandalone(isStandalone()); }, []);
  if (standalone) return null;
  if (available) return <Button size="sm" variant="outline" className={className} onClick={() => void install()}><Download />{label}</Button>;
  if (!isIos()) return null;
  return (
    <>
      <Button size="sm" variant="outline" className={className} onClick={() => setIosHelp(true)}><Download />{label}</Button>
      {iosHelp ? (
        <div role="dialog" aria-label="Add to Home Screen" className="fixed inset-x-3 bottom-3 z-50 rounded-2xl bg-card p-4 text-card-foreground shadow-2xl ring-1 ring-border">
          <button aria-label="Close" className="absolute right-3 top-3" onClick={() => setIosHelp(false)}><X className="size-4" /></button>
          <p className="font-semibold">Add to your Home Screen</p>
          <p className="mt-1 text-sm text-muted-foreground">In Safari, tap <Share className="inline size-4 align-text-bottom" /> Share, then <strong>Add to Home Screen</strong>. It opens full screen like any app.</p>
        </div>
      ) : null}
    </>
  );
}
