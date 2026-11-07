import { useEffect } from "react";
import { toast } from "sonner";
import { applyAppUpdate, canUpdateUnattended, checkForAppUpdate, UPDATE_CHECK_EVERY_MS } from "@/lib/app-update";
import { APP_UPDATE_FOUND_EVENT, CHECK_APP_UPDATE_EVENT } from "@/lib/terminal-signal";

/**
 * Counters stay open all day, so a published update must reach them without anyone
 * closing the app. Every 30 s (and when the screen comes back, gets focus or the internet
 * returns) this checks for a newer version. When one is out it updates by itself if the
 * device is hidden or untouched for 10 s with no dialog open; otherwise it asks with an "Update now" bar. Bills and drafts
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
      // A reload that came back on the old version (slow network served the saved copy) must not loop: wait 2 min before trying unattended again.
      let lastAuto = 0;
      try { lastAuto = Number(sessionStorage.getItem("appAutoUpdateAt") ?? 0); } catch { /* storage unavailable */ }
      if (Date.now() - lastAuto < 120_000) return;
      if (canUpdateUnattended({ hidden: document.visibilityState === "hidden", idleMs: Date.now() - lastTouch, dialogOpen })) {
        try { sessionStorage.setItem("appAutoUpdateAt", String(Date.now())); } catch { /* storage unavailable */ }
        void applyAppUpdate();
      }
    };
    const check = async (remote = false) => {
      if (checking || found || !navigator.onLine) return;
      checking = true;
      try {
        if (await checkForAppUpdate()) {
          found = true;
          // The first terminal to notice tells all the others (they don't repeat it).
          window.dispatchEvent(new CustomEvent(APP_UPDATE_FOUND_EVENT, { detail: { remote } }));
          toast("A new version of the app is ready", { id: "app-update", duration: Infinity, description: "Your bills are saved. Updating takes a few seconds.", action: { label: "Update now", onClick: () => { void applyAppUpdate(); } } });
          tryApply();
        }
      } catch { /* try again next round */ } finally { checking = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void check(); else tryApply(); };
    const timer = window.setInterval(() => { void check(); tryApply(); }, UPDATE_CHECK_EVERY_MS);
    const idleTimer = window.setInterval(tryApply, 2_000);
    const first = window.setTimeout(() => { void check(); }, 3_000);
    const onFocus = () => { void check(); };
    const onAsked = (e: Event) => { void check((e as CustomEvent<{ remote?: boolean }>).detail?.remote === true); };
    for (const e of ["pointerdown", "keydown"] as const) window.addEventListener(e, touched, { passive: true });
    window.addEventListener("online", onFocus);
    window.addEventListener("focus", onFocus);
    window.addEventListener(CHECK_APP_UPDATE_EVENT, onAsked);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer); window.clearInterval(idleTimer); window.clearTimeout(first);
      for (const e of ["pointerdown", "keydown"] as const) window.removeEventListener(e, touched);
      window.removeEventListener("online", onFocus);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(CHECK_APP_UPDATE_EVENT, onAsked);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
