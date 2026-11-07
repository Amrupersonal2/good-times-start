import type { Order } from "./types";

export type HistoryKind = "bills" | "kots" | "settled" | "cancelled";
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

/** Bills in the order they were closed (settled or cancelled); running bills follow, oldest first. */
export function historyBills(orders: Order[], kind: HistoryKind, bounds?: [number, number]): Order[] {
  return orders.filter((o) => {
    if (kind === "settled" ? o.status !== "settled" : kind === "cancelled" ? o.status !== "void" : false) return false;
    const at = kind === "settled" ? o.settledAt ?? o.createdAt : o.createdAt;
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