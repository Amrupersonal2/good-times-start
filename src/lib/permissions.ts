/**
 * Who may do what — the one list the whole app checks. Owners and managers
 * run the restaurant; cashiers, captains and kitchen staff work a shift.
 * The database enforces the same rules (drizzle/migrations/0008), so a
 * changed screen can't get around them.
 */
import type { StaffRole } from "./auth-context";
import { DEFAULT_POLICY, modeFor, resolvePolicy, screenAllowed, type PinHash, type PolicyAction, type PolicyScreen, type RolePolicy, type SavedRolePolicy } from "./role-policy";

export type Action =
  // Menu, floor and stock set-up
  | "menu.edit" | "menu.import" | "tables.edit" | "stock.setup" | "stock.purchase" | "stock.count"
  // Money
  | "bill.void" | "bill.cancel" | "bill.bigDiscount" | "guests.points" | "guests.export"
  // Restaurant settings
  | "settings.restaurant" | "settings.billing" | "settings.ordering" | "settings.series" | "staff.manage" | "device.reset"
  // Seeing the numbers
  | "reports.view" | "reports.export" | "dashboard.view" | "outlets.manage"
  // Branding, QR codes and WhatsApp campaigns
  | "marketing.manage"
  // Everyday shift work
  | "bill.create" | "bill.settle" | "kot.send" | "stock.wastage" | "guests.collectDue" | "counter.close" | "tables.status" | "guestOrders.handle" | "guests.consent"
  // Billing actions the admin sets per role in Settings → Roles (Off / On / On with PIN)
  | "settings.open" | "bill.discount" | "bill.nc" | "bill.charges" | "bill.split" | "tables.move"
  | "kot.edit" | "kot.reprint" | "bill.print" | "bill.reprint" | "bill.reprintOld" | "terminals.manage" | "roles.manage" | "reports.summary";

type Role = StaffRole | "unknown";

const ADMIN: Role[] = ["owner", "manager"];
const OWNER: Role[] = ["owner"];
const FLOOR: Role[] = ["owner", "manager", "cashier", "captain"];
const COUNTER: Role[] = ["owner", "manager", "cashier"];

const RULES: Record<Action, Role[]> = {
  "menu.edit": ADMIN, "menu.import": ADMIN, "tables.edit": ADMIN, "stock.setup": ADMIN, "stock.purchase": ADMIN, "stock.count": ADMIN,
  "bill.void": ADMIN, "bill.cancel": ADMIN, "bill.bigDiscount": ADMIN, "guests.points": ADMIN, "guests.export": ADMIN,
  "settings.restaurant": ADMIN, "settings.billing": ADMIN, "settings.ordering": ADMIN, "settings.series": ADMIN, "staff.manage": ADMIN, "device.reset": OWNER,
  "reports.view": ADMIN, "reports.export": ADMIN, "dashboard.view": ADMIN, "outlets.manage": OWNER, "marketing.manage": ADMIN,
  "bill.create": FLOOR, "bill.settle": COUNTER, "kot.send": FLOOR, "stock.wastage": ["owner", "manager", "cashier", "kitchen"],
  "guests.collectDue": COUNTER, "counter.close": COUNTER, "tables.status": FLOOR, "guestOrders.handle": FLOOR, "guests.consent": COUNTER,
  "settings.open": ["owner", "manager", "cashier", "captain", "kitchen"], "bill.discount": COUNTER, "bill.nc": ADMIN, "bill.charges": COUNTER, "bill.split": COUNTER,
  "tables.move": FLOOR, "kot.edit": FLOOR, "kot.reprint": FLOOR, "bill.print": FLOOR, "bill.reprint": COUNTER, "bill.reprintOld": ADMIN,
  "terminals.manage": ADMIN, "roles.manage": ADMIN, "reports.summary": ADMIN,
};

/** Actions the admin can switch per role, and their names in the role editor. */
const CONFIGURABLE: Partial<Record<Action, PolicyAction>> = {
  "dashboard.view": "dashboard", "counter.close": "dailySummary", "reports.summary": "salesSummary", "settings.open": "configuration",
  "bill.discount": "discount", "bill.nc": "nc", "bill.charges": "charges", "bill.cancel": "cancelBill", "bill.split": "splitBill",
  "tables.move": "moveTable", "bill.settle": "settle", "kot.send": "kotPrint", "kot.edit": "kotEdit", "kot.reprint": "kotReprint",
  "bill.print": "billPrint", "bill.reprint": "billReprint", "bill.reprintOld": "oldBillReprint",
};

/* The current policy and PIN, from the restaurant settings (set by PolicySync). */
let policy: RolePolicy = DEFAULT_POLICY;
let pinHash: PinHash | null = null;
let savedRef: unknown = undefined;
const policyListeners = new Set<() => void>();
export function setRolePolicy(saved: SavedRolePolicy | undefined, pin: PinHash | undefined): void {
  const key = JSON.stringify(saved ?? null);
  pinHash = pin ?? null;
  if (key === savedRef) return;
  savedRef = key;
  policy = resolvePolicy(saved);
  for (const l of policyListeners) l();
}
export function subscribePolicy(l: () => void) { policyListeners.add(l); return () => { policyListeners.delete(l); }; }
export function currentPolicy(): RolePolicy { return policy; }
export function currentPinHash(): PinHash | null { return pinHash; }

/** May this person do this? Nobody signed in may do nothing. */
export function can(user: { role: Role } | null | undefined, action: Action): boolean {
  if (!user) return false;
  const configurable = CONFIGURABLE[action];
  if (configurable && (user.role === "cashier" || user.role === "captain")) return modeFor(policy, user.role, configurable) !== "off";
  return RULES[action].includes(user.role);
}

/** Allowed, but only after the admin types their PIN on this device. */
export function needsPin(user: { role: Role } | null | undefined, action: Action): boolean {
  const configurable = CONFIGURABLE[action];
  if (!user || !configurable || (user.role !== "cashier" && user.role !== "captain")) return false;
  return modeFor(policy, user.role, configurable) === "pin";
}

/** Reception's extra screens, as the admin allowed them. */
export function screenPermitted(role: Role | undefined, path: PolicyScreen): boolean {
  return screenAllowed(policy, role, path);
}

export function isAdminRole(role: Role | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Plain-language line for a control someone's role doesn't allow. */
export const ADMIN_ONLY = "Only the owner or a manager can do this.";
