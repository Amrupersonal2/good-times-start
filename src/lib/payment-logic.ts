import type { PaymentMode } from "./types";

export const PAYMENT_MODES: { v: PaymentMode; l: string }[] = [
  { v: "cash", l: "Cash" },
  { v: "upi", l: "UPI" },
  { v: "card", l: "Card" },
  { v: "wallet", l: "Wallet" },
  { v: "credit", l: "Due (pay later)" },
  { v: "points", l: "Loyalty points" },
];

export interface Payment { mode: PaymentMode; amount: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** How a set of tendered amounts covers a bill. Only cash can be over-tendered (change is given). */
export function paymentSummary(entries: Payment[], total: number) {
  const tendered = r2(entries.reduce((sum, p) => sum + (p.amount > 0 ? p.amount : 0), 0));
  const nonCash = r2(entries.filter((p) => p.mode !== "cash").reduce((sum, p) => sum + Math.max(0, p.amount), 0));
  const change = tendered > total ? r2(tendered - total) : 0;
  const remaining = tendered < total ? r2(total - tendered) : 0;
  const nonCashOver = nonCash > total;
  const cashTendered = r2(tendered - nonCash);
  return {
    tendered,
    remaining,
    change,
    /** Card, UPI and other non-cash amounts can't exceed the bill. */
    error: nonCashOver ? "Card, UPI and other payments add up to more than the bill." : change > cashTendered ? "Change can only be given from cash." : "",
    complete: remaining === 0 && !nonCashOver && change <= cashTendered,
  };
}

/** The payments to record on the bill: what was actually kept, after change. Merges repeated modes. */
export function settledPayments(entries: Payment[], total: number): Payment[] {
  const { change } = paymentSummary(entries, total);
  const byMode = new Map<PaymentMode, number>();
  for (const p of entries) if (p.amount > 0) byMode.set(p.mode, r2((byMode.get(p.mode) ?? 0) + p.amount));
  if (change > 0) byMode.set("cash", r2((byMode.get("cash") ?? 0) - change));
  return [...byMode].filter(([, amount]) => amount > 0).map(([mode, amount]) => ({ mode, amount }));
}

/** Highest discount a role may give without an owner or manager. */
export function maxDiscountFor(role: string, staffLimit: number): number {
  return role === "owner" || role === "manager" || role === "unknown" ? 100 : Math.max(0, staffLimit);
}
