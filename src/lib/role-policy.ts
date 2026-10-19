/**
 * What Reception (cashier) and Waiter (captain) may do, as the admin sets it in
 * Settings → Roles. Each billing action is Off, On, or On with PIN (the admin's
 * PIN typed on the spot). Owners and managers can always do everything.
 * Pure rules, tested; the policy travels in the restaurant settings, which
 * only the owner or a manager can change (database rule 0008).
 */

export type Mode = "off" | "on" | "pin";
export type PolicyRole = "cashier" | "captain";

export type PolicyAction =
  | "dashboard" | "dailySummary" | "salesSummary" | "configuration"
  | "discount" | "nc" | "charges" | "cancelBill" | "splitBill" | "moveTable" | "settle"
  | "kotPrint" | "kotEdit" | "kotReprint" | "billPrint" | "billReprint" | "oldBillReprint";

export const POLICY_ACTIONS: { id: PolicyAction; label: string; hint: string; roles: PolicyRole[]; group: "Access" | "Bill" | "KOT and printing" }[] = [
  { id: "dashboard", label: "Dashboard", hint: "Sales and live status", roles: ["cashier"], group: "Access" },
  { id: "dailySummary", label: "Daily summary", hint: "Close the day and count the cash", roles: ["cashier"], group: "Access" },
  { id: "salesSummary", label: "Sales Summary report", hint: "Every bill with totals, filters and Excel", roles: ["cashier"], group: "Access" },
  { id: "configuration", label: "Settings screen", hint: "This device's printer and series (restaurant settings stay admin-only)", roles: ["cashier"], group: "Access" },
  { id: "discount", label: "Discount", hint: "Up to the staff discount limit", roles: ["cashier"], group: "Bill" },
  { id: "nc", label: "NC / complimentary", hint: "100% discount on a bill", roles: ["cashier"], group: "Bill" },
  { id: "charges", label: "Service charge", hint: "Add or remove it on a bill", roles: ["cashier"], group: "Bill" },
  { id: "cancelBill", label: "Cancel bill", hint: "A running bill, with a reason", roles: ["cashier"], group: "Bill" },
  { id: "splitBill", label: "Split bill / split payment", hint: "Pay part of a bill, or several modes", roles: ["cashier"], group: "Bill" },
  { id: "moveTable", label: "Change table", hint: "Move a running bill to another table", roles: ["cashier"], group: "Bill" },
  { id: "settle", label: "Settle bill", hint: "Take payment and close the bill", roles: ["cashier"], group: "Bill" },
  { id: "kotPrint", label: "Send KOT", hint: "Send new items to the kitchen", roles: ["cashier", "captain"], group: "KOT and printing" },
  { id: "kotEdit", label: "KOT edit", hint: "Cancel items the kitchen already has", roles: ["cashier", "captain"], group: "KOT and printing" },
  { id: "kotReprint", label: "KOT reprint", hint: "Print a sent KOT again", roles: ["cashier"], group: "KOT and printing" },
  { id: "billPrint", label: "Bill print", hint: "Print the running bill for the table", roles: ["cashier", "captain"], group: "KOT and printing" },
  { id: "billReprint", label: "Bill reprint", hint: "Print the receipt again after settling", roles: ["cashier"], group: "KOT and printing" },
  { id: "oldBillReprint", label: "Old bill reprint", hint: "Reprint past bills from reports", roles: ["cashier"], group: "KOT and printing" },
];

/** Screens Reception can be given besides Billing. */
export type PolicyScreen = "/tables" | "/menu" | "/stock" | "/customers" | "/reports";
export const POLICY_SCREENS: { path: PolicyScreen; label: string; hint: string }[] = [
  { path: "/tables", label: "Tables", hint: "Floor plan and table status" },
  { path: "/menu", label: "Menu (view)", hint: "See dishes and mark sold out; editing stays admin-only" },
  { path: "/stock", label: "Stock (wastage)", hint: "Record wastage; set-up and purchases stay admin-only" },
  { path: "/customers", label: "Guests", hint: "Guest list, dues and WhatsApp consent" },
  { path: "/reports", label: "Reports", hint: "Daily summary, and Sales Summary if allowed below" },
];

/** Never configurable: kept with owners and managers, and enforced by the database. */
export const ALWAYS_ADMIN = [
  "Editing the menu, recipes, prices and tables",
  "Stock set-up, purchases and counts",
  "Restaurant settings, logins, roles and terminals",
  "Voiding or changing a settled bill",
  "Full reports and exports",
  "Marketing and WhatsApp campaigns",
];

export interface RoleSettings { screens: Record<PolicyScreen, boolean>; actions: Record<PolicyAction, Mode> }
export type RolePolicy = Record<PolicyRole, RoleSettings>;
/** What's stored: anything missing falls back to the defaults. */
export type SavedRolePolicy = Partial<Record<PolicyRole, { screens?: Partial<Record<PolicyScreen, boolean>>; actions?: Partial<Record<PolicyAction, Mode>> }>>;

const allScreens = (on: boolean): Record<PolicyScreen, boolean> => ({ "/tables": on, "/menu": on, "/stock": on, "/customers": on, "/reports": on });

/** The defaults match how the app worked before roles were editable. */
export const DEFAULT_POLICY: RolePolicy = {
  cashier: {
    screens: allScreens(true),
    actions: {
      dashboard: "off", dailySummary: "on", salesSummary: "off", configuration: "on",
      discount: "on", nc: "off", charges: "on", cancelBill: "off", splitBill: "on", moveTable: "on", settle: "on",
      kotPrint: "on", kotEdit: "on", kotReprint: "on", billPrint: "on", billReprint: "on", oldBillReprint: "off",
    },
  },
  captain: {
    screens: allScreens(false),
    actions: {
      dashboard: "off", dailySummary: "off", salesSummary: "off", configuration: "off",
      discount: "off", nc: "off", charges: "off", cancelBill: "off", splitBill: "off", moveTable: "off", settle: "off",
      kotPrint: "on", kotEdit: "on", kotReprint: "off", billPrint: "on", billReprint: "off", oldBillReprint: "off",
    },
  },
};

const MODES: Mode[] = ["off", "on", "pin"];

/** Saved policy merged over the defaults; junk values are ignored. Actions not meant for a role stay off. */
export function resolvePolicy(saved: SavedRolePolicy | undefined | null): RolePolicy {
  const out = structuredClone(DEFAULT_POLICY);
  for (const role of ["cashier", "captain"] as PolicyRole[]) {
    const s = saved?.[role];
    if (!s) continue;
    for (const a of POLICY_ACTIONS) {
      const v = s.actions?.[a.id];
      if (a.roles.includes(role) && v && MODES.includes(v)) out[role].actions[a.id] = v;
    }
    if (role === "cashier") for (const sc of POLICY_SCREENS) {
      const v = s.screens?.[sc.path];
      if (typeof v === "boolean") out[role].screens[sc.path] = v;
    }
  }
  return out;
}

export function modeFor(policy: RolePolicy, role: string | null | undefined, action: PolicyAction): Mode {
  if (role === "owner" || role === "manager") return "on";
  if (role !== "cashier" && role !== "captain") return "off";
  return policy[role].actions[action];
}

export function screenAllowed(policy: RolePolicy, role: string | null | undefined, path: PolicyScreen): boolean {
  if (role === "owner" || role === "manager") return true;
  return role === "cashier" ? policy.cashier.screens[path] : false;
}

/* ------------------------------------------------------------- admin PIN */

export interface PinHash { salt: string; hash: string; iterations: number }

/** 4 to 6 digits, and not something guessed at a glance. */
export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return "Use 4 to 6 digits.";
  if (/^(\d)\1+$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) return "Too easy to guess. Avoid repeats and runs like 1234.";
  return null;
}

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** The PIN is never stored, only a slow salted hash (PBKDF2), so it can't be read off a device. */
export async function hashPin(pin: string, salt?: string, iterations = 150_000): Promise<PinHash> {
  const s = salt ?? hex(crypto.getRandomValues(new Uint8Array(16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(s), iterations }, key, 256);
  return { salt: s, hash: hex(bits), iterations };
}

export async function checkPin(pin: string, stored: PinHash | undefined | null): Promise<boolean> {
  if (!stored || !/^\d{4,6}$/.test(pin)) return false;
  const { hash } = await hashPin(pin, stored.salt, stored.iterations);
  let diff = hash.length === stored.hash.length ? 0 : 1;
  for (let i = 0; i < Math.min(hash.length, stored.hash.length); i += 1) diff |= hash.charCodeAt(i) ^ stored.hash.charCodeAt(i);
  return diff === 0;
}
