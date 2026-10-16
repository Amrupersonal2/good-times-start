import { getDb, markDirty } from "./db";
import { restockInventory } from "./inventory";
import type { RecordKind } from "./sync-core";
import type { Order } from "./types";

/** Void a settled bill: keeps it for the records with the reason, and returns tracked stock. */
export async function voidSettledBill(order: Order, reason: string, by?: string): Promise<void> {
  const db = getDb();
  const latest = order.uid ? await db.orders.where("uid").equals(order.uid).first() : undefined;
  if (!latest?.id) throw new Error("This bill isn't on this device yet. Sync and try again.");
  if (latest.status === "void") throw new Error(`Bill ${latest.billNo} is already void.`);
  if (latest.status !== "settled") throw new Error("Only settled bills can be voided here. Cancel running bills from Billing.");

  await db.orders.update(latest.id, { status: "void", voidReason: reason, synced: false, ...(by ? { closedBy: by } : {}) });
  const changes: [RecordKind, string][] = [["order", latest.uid ?? ""]];
  const inventory = await db.inventory.toArray();
  const restocked = restockInventory(latest.lines, inventory).filter((item) => item.synced === false);
  if (restocked.length) {
    await db.inventory.bulkPut(restocked);
    changes.push(...restocked.map((item): [RecordKind, string] => ["inventory", item.id]));
  }
  await markDirty(...changes);
}
