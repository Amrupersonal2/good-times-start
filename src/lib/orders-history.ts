import type { Order } from "./types";

export type HistoryKind = "kots" | "settled" | "nc" | "cancelled";
/** Payment filter for settled bills. */
export type PaymentFilter = "all" | "cash" | "upi" | "other";

/** Money actually received on a bill. NC (no charge) bills close with none. */
export function paidAmount(o: Order): number {
  return (o.payments ?? []).reduce((sum, p) => sum + (p.amount > 0 ? p.amount : 0), 0);
}

/** A settled bill closed with no payment: complimentary / no charge. */
export function isNcBill(o: Order): boolean {
  return o.status === "settled" && paidAmount(o) === 0;
}

/** Whether a settled bill received money by this mode (split payments match each mode they used). */
export function paidBy(o: Order, filter: PaymentFilter): boolean {
  if (filter === "all") return true;
  const modes = (o.payments ?? []).filter((p) => p.amount > 0).map((p) => p.mode);
  return filter === "other" ? modes.some((m) => m !== "cash" && m !== "upi") : modes.includes(filter);
}
export function dayBounds(date: string): [number, number] {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}
/** When a bill entered history: settled or cancelled time; running bills have not yet. */
export function closedAt(o: Order): number | undefined {
  if (o.status === "settled") return o.settledAt ?? o.createdAt;
  if (o.status === "void") return o.cancelledAt ?? o.createdAt;
  return undefined;
}

/** Closed bills of one kind, in the order they were settled or cancelled. */
export function historyBills(orders: Order[], kind: HistoryKind, bounds?: [number, number]): Order[] {
  return orders.filter((o) => {
    if (kind === "kots") return false;
    if (kind === "settled" && (o.status !== "settled" || isNcBill(o))) return false;
    if (kind === "nc" && !isNcBill(o)) return false;
    if (kind === "cancelled" && o.status !== "void") return false;
    // Each bill is listed on the day it entered history: settled or cancelled.
    const at = closedAt(o) ?? o.createdAt;
    return !bounds || at >= bounds[0] && at < bounds[1];
  }).sort((a, b) => {
    const ca = closedAt(a), cb = closedAt(b);
    if (ca !== undefined && cb !== undefined) return ca - cb;
    if (ca !== undefined) return -1;
    if (cb !== undefined) return 1;
    return a.createdAt - b.createdAt;
  });
}
export function dateLabel(offset = 0): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}