import { kotSubmissions } from "./kot-history";
import type { Kot, Order } from "./types";

/** Keep tickets for open hotel bills across days; unlinked tickets remain visible today. */
export function liveKitchenTickets(kots: Kot[], orders: Order[], start: number, end: number, station = "all") {
  const byUid = new Map(orders.filter((o) => o.uid).map((o) => [o.uid, o]));
  const byId = new Map(orders.filter((o) => o.id !== undefined).map((o) => [o.id, o]));
  return kotSubmissions(kots.filter((k) => {
    if (station !== "all" && k.station !== station) return false;
    const order = (k.orderUid ? byUid.get(k.orderUid) : undefined) ?? byId.get(k.orderId);
    return order ? order.status === "held" : k.createdAt >= start && k.createdAt < end;
  }));
}