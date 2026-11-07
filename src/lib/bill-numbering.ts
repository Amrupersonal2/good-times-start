import type { Order } from "./types";
import { getDb, markDirty } from "./db";
import { allocateRestaurantNumber, allocatedNumberRequestId } from "./restaurant-numbering";
import type { RecordKind } from "./sync-core";

/**
 * Official POS numbers are given when a bill is settled or first printed, not
 * when it opens, so settled bills run in settlement order. A running bill
 * without a number has an empty billNo.
 */
export function hasBillNumber(order: Pick<Order, "billNo">): boolean {
  return order.billNo.trim() !== "";
}

/** What to call a bill on screen: its number, or "Running bill" until it has one. */
export function billLabel(order: Pick<Order, "billNo">): string {
  return hasBillNumber(order) ? order.billNo : "Running bill";
}

/** Number to show beside a running bill: the short POS number, else nothing. */
export function shortBillNo(order: Pick<Order, "billNo">): string {
  return hasBillNumber(order) ? order.billNo.split("/").pop() ?? order.billNo : "";
}

/**
 * Give a bill its official number (idempotent: the bill's uid is the allocator
 * request, so a retry after a lost response gets the same number). Offline,
 * the device's spare reserved numbers are used.
 */
export async function withBillNumber<T extends Order>(order: T): Promise<T> {
  if (hasBillNumber(order)) return order;
  if (!order.uid) throw new Error("This bill isn't saved yet. Try again.");
  const billNo = await allocateRestaurantNumber("POS", order.uid);
  const numberRequestId = await allocatedNumberRequestId("POS", order.uid);
  return { ...order, billNo, numberRequestId };
}

/** Copy a newly given bill number onto the bill's kitchen tickets; returns the changed records. */
export async function stampKotsWithBillNo(order: Order): Promise<[RecordKind, string][]> {
  if (!hasBillNumber(order)) return [];
  const db = getDb();
  const tickets = await db.kots.filter((k) => (!!order.uid && k.orderUid === order.uid) || (order.id !== undefined && k.orderId === order.id)).toArray();
  const changed: [RecordKind, string][] = [];
  for (const k of tickets) {
    if (k.id === undefined || k.billNo === order.billNo) continue;
    await db.kots.put({ ...k, billNo: order.billNo });
    if (k.uid) changed.push(["kot", k.uid]);
  }
  return changed;
}

/** Number a running bill before its first print, and save it so every device sees the number. */
export async function numberBillForPrint(order: Order): Promise<Order> {
  if (hasBillNumber(order) || order.status !== "held") return order;
  const numbered = await withBillNumber({ ...order, synced: false });
  const db = getDb();
  if (numbered.id !== undefined) await db.orders.put(numbered);
  await markDirty(["order", numbered.uid ?? ""], ...await stampKotsWithBillNo(numbered));
  return numbered;
}
