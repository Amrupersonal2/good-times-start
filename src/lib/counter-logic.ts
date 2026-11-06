import type { Order } from "./types";
import { seriesOf, type Range } from "./report-logic";

export function closedAt(order: Order): number { return order.settledAt ?? order.createdAt; }

/** Legacy bills fall back to their original series; new payments belong to the device that received them. */
export function counterPayments(orders: Order[], range: Range, deviceId: string, series: string): Order[] {
  return orders.filter((o) => o.status === "settled" && closedAt(o) >= range.from && closedAt(o) <= range.to &&
    (o.settledDeviceId ? o.settledDeviceId === deviceId : seriesOf(o.billNo) === series));
}

export function counterCanClose(businessType: "hotel" | "restaurant", running: number): boolean {
  return businessType === "hotel" || running === 0;
}