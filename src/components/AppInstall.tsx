import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncAppModeFromUrl, useChosenApp } from "@/lib/app-mode";
import type { AppKind } from "@/lib/staff-login-logic";
import { allowAppWorker, installKind, type InstallKind } from "@/lib/app-install-logic";

/**
 * Three installable apps from one codebase:
 *   /manager   POS Business Manager (admin: phone, tablet, computer)
^ *   /tables?app=pos  Restro POS by XTSY (reception counter: Windows or Mac)
 *   /waiter    POS Waiter (waiters: Android phone or tablet)
 * Each has its own manifest, icon and theme, chosen by the window's app.
 */

export function appForPath(pathname: string, chosen: AppKind | null): AppKind {
  if (pathname === "/waiter" || pathname.startsWith("/waiter/")) return "waiter";
  if (pathname === "/manager" || pathname === "/insights" || pathname.startsWith("/insights/")) return "manager";
  return chosen ?? "pos";
}

const APP_META: Record<InstallKind, { title: string; theme: string }> = {
  insights: { title: "XTSY Reports", theme: "#000000" },
  manager: { title: "Business Manager", theme: "#000000" },
  pos: { title: "Restro POS", theme: "#F2F2F7" },
  waiter: { title: "POS Waiter", theme: "#000000" },
};

/* ---- install prompt (Chrome / Edge / Android) ---- */

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };

function shouldRegisterServiceWorker(): boolean {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  if (window.location.protocol !== "https:") return false;
  return allowAppWorker(import.meta.env.PROD, window.location.hostname, window.self !== window.top, window.location.search);
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
  const chosen = useChosenApp();
  useEffect(() => { syncAppModeFromUrl(); }, [pathname]);
  const app = installKind(pathname, chosen);
  const meta = APP_META[app];

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; emit(); };
    const onInstalled = () => { deferred = null; emit(); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (shouldRegisterServiceWorker()) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => { /* offline support is a bonus, never a blocker */ });
    } else if ("serviceWorker" in navigator) {
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations.filter((r) => {
        const worker = r.active ?? r.waiting ?? r.installing;
        return worker && new URL(worker.scriptURL).pathname === "/sw.js";
      }).map((r) => r.unregister()))).catch(() => {});
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Guests ordering from a QR code or link are on the restaurant's page, not a staff app.
  if (pathname.startsWith("/order/")) return null;

  // React 19 hoists these into <head> and updates them when the app changes.
  return (
    <>
      <link rel="manifest" href={`/manifest-${app}.webmanifest`} />
      <link rel="apple-touch-icon" href={`/icons/${app}-apple-180.png`} />
      <meta name="theme-color" content={meta.theme} />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content={meta.title} />
      <meta name="apple-mobile-web-app-status-bar-style" content={app === "pos" ? "default" : "black-translucent"} />
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
          <Button variant="ghost" size="icon" aria-label="Close" className="absolute right-3 top-3" onClick={() => setIosHelp(false)}><X className="size-4" /></Button>
          <p className="font-semibold">Add to your Home Screen</p>
          <p className="mt-1 text-sm text-muted-foreground">In Safari, tap <Share className="inline size-4 align-text-bottom" /> Share, then <strong>Add to Home Screen</strong>. It opens full screen like any app.</p>
        </div>
      ) : null}
    </>
  );
}
