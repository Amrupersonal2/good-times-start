import { readFileSync } from "node:fs";
/** Screen sizes every app is checked at, from a small Android phone to a wide desktop. */
export interface Breakpoint { name: string; width: number; height: number; touch: boolean; device: "android" | "desktop" }

const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export const BREAKPOINTS: Breakpoint[] = [
  { name: "phone-360", width: 360, height: 780, touch: true, device: "android" },
  { name: "phone-412", width: 412, height: 915, touch: true, device: "android" },
  { name: "tablet-768", width: 768, height: 1024, touch: true, device: "android" },
  { name: "tablet-1024-landscape", width: 1024, height: 768, touch: true, device: "android" },
  { name: "laptop-1280", width: 1280, height: 800, touch: false, device: "desktop" },
  { name: "desktop-1440", width: 1440, height: 900, touch: false, device: "desktop" },
  { name: "wide-1920", width: 1920, height: 1080, touch: false, device: "desktop" },
];

export function contextFor(bp: Breakpoint) {
  return {
    viewport: { width: bp.width, height: bp.height },
    hasTouch: bp.touch,
    isMobile: bp.touch && bp.width < 700,
    userAgent: bp.device === "desktop" ? DESKTOP : bp.width < 700 ? ANDROID_PHONE : ANDROID_TABLET,
  };
}

export const LOGINS = {
  admin: { email: "admin@xtsy.pos", password: process.env["XTSY_ADMIN_PASSWORD"] || "Xtsy123$$", entry: "/manager", device: "desktop" as const },
  billdesk: { email: "billdesk@xtsy.pos", password: process.env["XTSY_BILLDESK_PASSWORD"] || "Xtsy123$$", entry: "/?app=pos", device: "desktop" as const },
  waiter: { email: "waiter@xtsy.pos", password: process.env["XTSY_WAITER_PASSWORD"] || "Xtsy123$$", entry: "/waiter?app=waiter", device: "android" as const },
};
export type LoginName = keyof typeof LOGINS;
export const authFile = (login: LoginName) => `e2e/.auth/${login}.json`;

/** Is this login allowed on this kind of device right now (as saved by global setup)? */
export function allowedOn(login: LoginName, device: Breakpoint["device"]): boolean {
  const saved = JSON.parse(readFileSync("e2e/.auth/devices.json", "utf8")) as Record<string, string[]>;
  return (saved[login] ?? []).includes(device);
}
