import type { Customer, Order } from "./types";

/** Indian mobile numbers keyed by their last 10 digits, so +91 98765 43210 and 09876543210 match. */
export function normalisePhone(raw: string | undefined): string | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

export function earnedPoints(order: Pick<Order, "total" | "payments">, loyaltyPct: number): number {
  if (loyaltyPct <= 0) return 0;
  // Points aren't earned on the part of a bill paid with points.
  const paidWithPoints = order.payments.filter((p) => p.mode === "points").reduce((s, p) => s + p.amount, 0);
  return Math.floor(Math.max(0, order.total - paidWithPoints) * loyaltyPct / 100);
}

export interface CustomerStats {
  visits: number;
  spent: number;
  lastVisit: number | null;
  pointsEarned: number;
  pointsRedeemed: number;
  points: number;
  dueOwed: number;
  duePaid: number;
  due: number;
  averageRating: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Everything about a guest, worked out from their settled bills. Nothing here can drift between devices. */
export function customerStats(customer: Pick<Customer, "id" | "pointsAdjustment" | "duesPaid">, orders: Order[], loyaltyPct: number): CustomerStats {
  const mine = orders.filter((o) => o.status === "settled" && normalisePhone(o.customer?.phone) === customer.id);
  const pointsEarned = mine.reduce((s, o) => s + earnedPoints(o, loyaltyPct), 0);
  const pointsRedeemed = mine.reduce((s, o) => s + o.payments.filter((p) => p.mode === "points").reduce((t, p) => t + p.amount, 0), 0);
  const dueOwed = r2(mine.reduce((s, o) => s + o.payments.filter((p) => p.mode === "credit").reduce((t, p) => t + p.amount, 0), 0));
  const duePaid = r2((customer.duesPaid ?? []).reduce((s, p) => s + p.amount, 0));
  const rated = mine.filter((o) => o.feedback);
  return {
    visits: mine.length,
    spent: r2(mine.reduce((s, o) => s + o.total, 0)),
    lastVisit: mine.length ? Math.max(...mine.map((o) => o.createdAt)) : null,
    pointsEarned,
    pointsRedeemed,
    points: Math.max(0, Math.floor(pointsEarned - pointsRedeemed + (customer.pointsAdjustment ?? 0))),
    dueOwed,
    duePaid,
    due: Math.max(0, r2(dueOwed - duePaid)),
    averageRating: rated.length ? Math.round((rated.reduce((s, o) => s + (o.feedback?.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
  };
}

/** Set the indexed guest id from the bill's phone number (or clear it). */
export function withCustomerId<T extends { customer?: { phone?: string } | undefined; customerId?: string }>(order: T): T {
  const id = normalisePhone(order.customer?.phone);
  const next = { ...order };
  if (id) next.customerId = id; else delete next.customerId;
  return next;
}

/** Bills grouped by guest id, so every guest's stats come from one pass over the bills. */
export function ordersByCustomer(orders: Order[]): Map<string, Order[]> {
  const out = new Map<string, Order[]>();
  for (const o of orders) {
    const id = o.customerId ?? normalisePhone(o.customer?.phone);
    if (!id) continue;
    const list = out.get(id);
    if (list) list.push(o); else out.set(id, [o]);
  }
  return out;
}
