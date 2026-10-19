/**
 * The three internal logins and the three apps. Pure rules, tested.
 *
 *   admin@xtsy.pos     Admin       POS Business Manager (and every app)
 *   billdesk@xtsy.pos  Reception   Restro POS by XTSY (counter computer)
 *   waiter@xtsy.pos    Waiter      POS Waiter (Android phone or tablet)
 */

export type LoginId = "admin" | "billdesk" | "waiter";
export type AppKind = "manager" | "pos" | "waiter";
export type DeviceKind = "android" | "ios" | "desktop";

export const LOGIN_DOMAIN = "xtsy.pos";

export const LOGINS: Record<LoginId, { email: string; label: string; app: AppKind }> = {
  admin: { email: `admin@${LOGIN_DOMAIN}`, label: "Admin", app: "manager" },
  billdesk: { email: `billdesk@${LOGIN_DOMAIN}`, label: "Reception", app: "pos" },
  waiter: { email: `waiter@${LOGIN_DOMAIN}`, label: "Waiter", app: "waiter" },
};

export const APPS: Record<AppKind, { name: string; short: string; home: "/dashboard" | "/" | "/waiter"; for: string; login: LoginId }> = {
  manager: { name: "POS Business Manager", short: "Business Manager", home: "/dashboard", for: "Owner and admin · phone, tablet and computer", login: "admin" },
  pos: { name: "Restro POS by XTSY", short: "Restro POS", home: "/", for: "Reception counter · Windows or Mac computer", login: "billdesk" },
  waiter: { name: "POS Waiter", short: "POS Waiter", home: "/waiter", for: "Waiters · Android phone or tablet", login: "waiter" },
};

/** Where each app opens; the install links. */
export const APP_LINKS: Record<AppKind, string> = { manager: "/manager", pos: "/?app=pos", waiter: "/waiter?app=waiter" };

export const DEVICE_LABELS: Record<DeviceKind, string> = { android: "Android phone or tablet", ios: "iPhone or iPad", desktop: "Windows or Mac computer" };

/** "admin", "Admin", "admin@xtsy.pos" all mean the admin login; any other email passes through. */
export function emailFromInput(text: string): string {
  const t = text.trim().toLowerCase();
  if (!t) return "";
  if ((Object.keys(LOGINS) as LoginId[]).includes(t as LoginId)) return LOGINS[t as LoginId].email;
  return t;
}

export function loginForEmail(email: string | null | undefined): LoginId | null {
  const e = (email ?? "").trim().toLowerCase();
  return (Object.keys(LOGINS) as LoginId[]).find((id) => LOGINS[id].email === e) ?? null;
}

/** Which apps a person may open: by their internal login, or by role for any other account. */
export function appsFor(login: LoginId | null, role: string | null | undefined): AppKind[] {
  if (login === "admin") return ["manager", "pos", "waiter"];
  if (login === "billdesk") return ["pos"];
  if (login === "waiter") return ["waiter"];
  if (role === "owner" || role === "manager") return ["manager", "pos", "waiter"];
  if (role === "cashier") return ["pos"];
  if (role === "captain") return ["waiter"];
  return [];
}

/** Rough device class from the browser. iPadOS reports itself as a Mac, so touch is checked too. */
export function deviceKind(userAgent: string, platform = "", maxTouchPoints = 0): DeviceKind {
  if (/android/i.test(userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(userAgent) || (/mac/i.test(platform) && maxTouchPoints > 1)) return "ios";
  return "desktop";
}

export interface LoginRow { login: LoginId; active: boolean; devices: DeviceKind[]; whatsapp: string; display_name: string }

/**
 * Why this person can't use this app on this device, in plain words; null when they can.
 * Admin is never locked out of a device, so the restaurant can always be fixed.
 */
export function accessProblem(input: { login: LoginId | null; role: string | null | undefined; row: LoginRow | null; app: AppKind; device: DeviceKind }): string | null {
  const { login, role, row, app, device } = input;
  if (row && !row.active) return `The ${LOGINS[row.login].label} login is switched off. Ask the admin to switch it on in Settings → Logins.`;
  const apps = appsFor(login, role);
  if (!apps.length) return "This login has no access to the restaurant yet.";
  if (!apps.includes(app)) {
    const own = apps[0] as AppKind;
    return `${login ? LOGINS[login].label : "This login"} uses ${APPS[own].name}, not ${APPS[app].name}.`;
  }
  if (login !== "admin" && row && !row.devices.includes(device)) {
    return `The ${LOGINS[row.login].label} login is set up for ${row.devices.map((d) => DEVICE_LABELS[d]).join(" or ")} only. The admin can change this in Settings → Logins.`;
  }
  return null;
}

/** Which app this window is: from the install link (?app=) or the page, else the person's own app. */
export function appFromLocation(pathname: string, search: string): AppKind | null {
  const param = new URLSearchParams(search).get("app");
  if (param === "manager" || param === "pos" || param === "waiter") return param;
  if (pathname === "/manager" || pathname.startsWith("/manager/")) return "manager";
  return null;
}

export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password.length > 72) return "Use at most 72 characters.";
  if (!/[a-z]/i.test(password) || !/[^a-z]/i.test(password)) return "Mix letters with numbers or symbols.";
  return null;
}

/** "+91 ••••• •7070": enough to recognise the number, not enough to read it off a screen. */
export function maskPhone(digits: string): string {
  const d = digits.replace(/\D/g, "");
  if (d.length < 10) return "";
  const country = d.slice(0, d.length - 10);
  return `${country ? `+${country} ` : ""}••••• •${d.slice(-4)}`;
}
