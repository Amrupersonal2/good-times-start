import { useEffect } from "react";
import { toast } from "sonner";
import { applyAppUpdate, canUpdateUnattended, checkForAppUpdate, UPDATE_CHECK_EVERY_MS } from "@/lib/app-update";

/**
 * Counters stay open all day, so a published update must reach them without anyone
 * closing the app. Every few minutes (and when the screen comes back or the internet
 * returns) this checks for a newer version. When one is out it updates by itself if the
 * device is idle or hidden; otherwise it asks with an "Update now" bar. Bills and drafts
 * are saved on the device, so updating never loses an order.
 */
export function AppUpdateWatcher() {
  useEffect(() => {
    let lastTouch = Date.now();
    let found = false;
    let checking = false;
    const touched = () => { lastTouch = Date.now(); };
    const tryApply = () => {
      if (!found) return;
      const dialogOpen = !!document.querySelector('[role="dialog"], [role="alertdialog"]');
      if (canUpdateUnattended({ hidden: document.visibilityState === "hidden", idleMs: Date.now() - lastTouch, dialogOpen })) void applyAppUpdate();
    };
    const check = async () => {
      if (checking || found || !navigator.onLine) return;
      checking = true;
      try {
        if (await checkForAppUpdate()) {
          found = true;
          toast("A new version of the app is ready", { id: "app-update", duration: Infinity, description: "Your bills are saved. Updating takes a few seconds.", action: { label: "Update now", onClick: () => { void applyAppUpdate(); } } });
          tryApply();
        }
      } catch { /* try again next round */ } finally { checking = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); else tryApply(); };
    const timer = window.setInterval(() => { void check(); tryApply(); }, UPDATE_CHECK_EVERY_MS);
    const idleTimer = window.setInterval(tryApply, 30_000);
    const first = window.setTimeout(() => { void check(); }, 20_000);
    for (const e of ["pointerdown", "keydown"] as const) window.addEventListener(e, touched, { passive: true });
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer); window.clearInterval(idleTimer); window.clearTimeout(first);
      for (const e of ["pointerdown", "keydown"] as const) window.removeEventListener(e, touched);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
