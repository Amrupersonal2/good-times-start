import { getDb } from "./db";
import type { Range } from "./report-logic";
import type { Order } from "./types";

/** Read payment-day and legacy creation-day indexes without loading a hotel's entire history. */
export async function reportOrders(range: Range): Promise<Order[]> {
  const db = getDb();
  const [created, settled] = await Promise.all([
    db.orders.where("createdAt").between(range.from, range.to, true, true).toArray(),
    db.orders.where("settledAt").between(range.from, range.to, true, true).toArray(),
  ]);
  return [...new Map([...created, ...settled].map((o) => [o.uid ?? o.id ?? o.billNo, o])).values()];
}