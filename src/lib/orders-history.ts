import type { Order } from "./types";

export type HistoryKind = "bills" | "kots" | "settled" | "cancelled";
export function dayBounds(date: string): [number, number] {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return [start.getTime(), end.getTime()];
}
export function historyBills(orders: Order[], kind: HistoryKind): Order[] {
  return orders.filter((o) => kind === "settled" ? o.status === "settled" : kind === "cancelled" ? o.status === "void" : true);
}
export function dateLabel(offset = 0): string {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}