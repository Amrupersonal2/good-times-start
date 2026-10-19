import { useSyncExternalStore } from "react";
import { appFromLocation, appsFor, deviceKind, type AppKind, type DeviceKind } from "./staff-login-logic";
import type { SignedInStaff } from "./auth-context";

/*
 * Which of the three apps this window is. An installed app opens with ?app=…
 * (or on /manager or /waiter); the choice is kept for the life of the window,
 * so Restro POS and Business Manager can be open side by side on one computer.
 */

const KEY = "xtsy-app";
const listeners = new Set<() => void>();
let mode: AppKind | null = null;

function read(): AppKind | null {
  if (mode) return mode;
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v === "manager" || v === "pos" || v === "waiter") mode = v;
  } catch { /* storage unavailable */ }
  return mode;
}

export function setAppMode(app: AppKind): void {
  if (mode === app) return;
  mode = app;
  try { window.sessionStorage.setItem(KEY, app); } catch { /* storage unavailable */ }
  for (const l of listeners) l();
}

/** Call on every page change: picks up ?app= from install links and /manager or /waiter. */
export function syncAppModeFromUrl(): void {
  if (typeof window === "undefined") return;
  const found = appFromLocation(window.location.pathname, window.location.search);
  if (found) setAppMode(found);
}

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** The app chosen for this window, or null before anything chose one. */
export function useChosenApp(): AppKind | null {
  return useSyncExternalStore(subscribe, () => (typeof window === "undefined" ? null : read()), () => null);
}

/** The app this window shows: as chosen, else the signed-in person's own app. */
export function useAppMode(user: SignedInStaff | null): AppKind {
  const chosen = useChosenApp();
  if (chosen) return chosen;
  return appsFor(user?.login ?? null, user?.role)[0] ?? "pos";
}

let device: DeviceKind | null = null;
export function currentDevice(): DeviceKind {
  if (typeof navigator === "undefined") return "desktop";
  device ??= deviceKind(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  return device;
}
