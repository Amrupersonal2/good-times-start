import { useEffect } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { useStaff } from "@/lib/auth-context";
import { isFramedPath } from "@/components/AppShell";

/** Staff screens in the order people usually open them. */
const SCREENS = ["/", "/dashboard", "/tables", "/menu", "/reports", "/stock", "/customers", "/settings", "/insights", "/waiter", "/account"] as const;

type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };

/**
 * Once the first screen is up, quietly fetch the code for the other screens
 * (one at a time, while the device is idle). The service worker keeps them,
 * so every later tap opens instantly, online or offline.
 */
export function PreloadScreens() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const signedIn = !!useStaff().user;
  const staffScreen = isFramedPath(pathname) || pathname === "/waiter" || pathname === "/insights";

  useEffect(() => {
    if (!staffScreen || typeof window === "undefined") return;
    const w = window as IdleWindow;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    let cancelled = false;
    let handle: number | undefined;
    const queue = SCREENS.filter((to) => to !== pathname);
    const next = () => {
      if (cancelled) return;
      const to = queue.shift();
      if (!to) return;
      void router.preloadRoute({ to }).catch(() => undefined).finally(() => {
        handle = w.requestIdleCallback ? w.requestIdleCallback(next, { timeout: 2000 }) : window.setTimeout(next, 200);
      });
    };
    const start = window.setTimeout(next, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      if (handle !== undefined) { if (w.cancelIdleCallback) w.cancelIdleCallback(handle); else window.clearTimeout(handle); }
    };
    // Run once per sign-in, not on every page change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedIn, staffScreen]);
  return null;
}
