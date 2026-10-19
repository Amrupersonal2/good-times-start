/**
 * Who may do what — the one list the whole app checks. Owners and managers
 * run the restaurant; cashiers, captains and kitchen staff work a shift.
 * The database enforces the same rules (drizzle/migrations/0008), so a
 * changed screen can't get around them.
 */
import type { StaffRole } from "./auth-context";

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
  | "bill.create" | "bill.settle" | "kot.send" | "stock.wastage" | "guests.collectDue" | "counter.close" | "tables.status" | "guestOrders.handle" | "guests.consent";

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
};

/** May this person do this? Nobody signed in may do nothing. */
export function can(user: { role: Role } | null | undefined, action: Action): boolean {
  return !!user && RULES[action].includes(user.role);
}

export function isAdminRole(role: Role | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Plain-language line for a control someone's role doesn't allow. */
export const ADMIN_ONLY = "Only the owner or a manager can do this.";
