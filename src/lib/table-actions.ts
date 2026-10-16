import { getDb, markDirty } from "./db";
import type { RecordKind } from "./sync-core";
import { combineOrders } from "./table-logic";
import type { Order, RestaurantTable } from "./types";

export { combineOrders, tableIdFor } from "./table-logic";

/** The running (held) order for a table — the newest one if two devices raced. */
export async function latestHeldOrder(tableId: string): Promise<Order | null> {
  const held = await getDb().orders.where("tableId").equals(tableId).filter((o) => o.status === "held").toArray();
  return held.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

async function retargetKots(orderUid: string | undefined, to: RestaurantTable, newOrderUid?: string): Promise<[RecordKind, string][]> {
  if (!orderUid) return [];
  const db = getDb();
  const kots = await db.kots.filter((k) => k.orderUid === orderUid).toArray();
  for (const kot of kots) {
    if (kot.id === undefined) continue;
    await db.kots.update(kot.id, { tableId: to.id, tableLabel: to.label, ...(newOrderUid ? { orderUid: newOrderUid } : {}) });
  }
  return kots.flatMap((k): [RecordKind, string][] => (k.uid ? [["kot", k.uid]] : []));
}

async function moveDraft(fromId: string, toId: string) {
  const db = getDb();
  const draft = await db.drafts.get(fromId);
  if (!draft) return;
  await db.drafts.delete(fromId);
  await db.drafts.put({ ...draft, id: toId, tableId: toId, updatedAt: Date.now() });
}

/** Move a table's running bill to a free table. */
export async function moveTable(fromId: string, toId: string): Promise<void> {
  const db = getDb();
  const [from, to, order, busy] = await Promise.all([
    db.restTables.get(fromId), db.restTables.get(toId), latestHeldOrder(fromId), latestHeldOrder(toId),
  ]);
  if (!from || !to) throw new Error("That table no longer exists.");
  if (busy || to.status === "occupied" || to.status === "billed") throw new Error(`${to.label} already has guests. Use Merge instead.`);
  const changes: [RecordKind, string][] = [["table", fromId], ["table", toId]];

  if (order?.id !== undefined) {
    await db.orders.update(order.id, { tableId: toId, tableLabel: to.label, synced: false });
    if (order.uid) changes.push(["order", order.uid]);
    changes.push(...await retargetKots(order.uid, to));
  }
  await db.restTables.update(toId, { status: "occupied", runningTotal: from.runningTotal, since: from.since ?? Date.now() });
  await db.restTables.update(fromId, { status: "free", runningTotal: 0, since: undefined });
  await moveDraft(fromId, toId);
  await markDirty(...changes);
}

/** Merge a table's running bill into another table's running bill. */
export async function mergeTables(fromId: string, intoId: string): Promise<void> {
  const db = getDb();
  const [from, into, fromOrder, intoOrder] = await Promise.all([
    db.restTables.get(fromId), db.restTables.get(intoId), latestHeldOrder(fromId), latestHeldOrder(intoId),
  ]);
  if (!from || !into) throw new Error("That table no longer exists.");
  if (!fromOrder) throw new Error(`${from.label} has nothing sent to the kitchen yet. Send the KOT first, then merge.`);
  if (!intoOrder) return moveTable(fromId, intoId);

  const combined = combineOrders(intoOrder, fromOrder);
  const changes: [RecordKind, string][] = [["table", fromId], ["table", intoId]];
  await db.transaction("rw", db.orders, async () => {
    await db.orders.put(combined);
    if (fromOrder.id !== undefined) {
      await db.orders.update(fromOrder.id, { status: "void", voidReason: `Merged into ${into.label} (${intoOrder.billNo})`, synced: false });
    }
  });
  if (combined.uid) changes.push(["order", combined.uid]);
  if (fromOrder.uid) changes.push(["order", fromOrder.uid]);
  changes.push(...await retargetKots(fromOrder.uid, into, combined.uid));
  await db.restTables.update(intoId, { status: "occupied", runningTotal: combined.total, since: into.since ?? from.since ?? Date.now() });
  await db.restTables.update(fromId, { status: "free", runningTotal: 0, since: undefined });
  await db.drafts.delete(fromId);
  await markDirty(...changes);
}

/** Free or reserve a table by hand. A table with a running bill can't be freed. */
export async function setTableStatus(tableId: string, status: "free" | "reserved"): Promise<void> {
  if (status === "free" && await latestHeldOrder(tableId)) {
    throw new Error("This table has a running bill. Settle it or move it first.");
  }
  await getDb().restTables.update(tableId, { status, since: status === "free" ? undefined : Date.now(), ...(status === "free" ? { runningTotal: 0 } : {}) });
  await markDirty(["table", tableId]);
}

/** Add or edit a table. New table ids are their first name, so old prints still read naturally. */
export async function saveTable(table: Omit<RestaurantTable, "status" | "runningTotal"> & { status?: RestaurantTable["status"]; runningTotal?: number }): Promise<void> {
  const db = getDb();
  const existing = await db.restTables.get(table.id);
  await db.restTables.put({
    ...table,
    status: existing?.status ?? table.status ?? "free",
    runningTotal: existing?.runningTotal ?? table.runningTotal ?? 0,
    ...(existing?.since !== undefined ? { since: existing.since } : {}),
  });
  await markDirty(["table", table.id]);
}

export async function deleteTable(tableId: string): Promise<void> {
  if (await latestHeldOrder(tableId)) throw new Error("This table has a running bill. Settle or move it before deleting the table.");
  await getDb().restTables.delete(tableId);
  await markDirty(["table", tableId]);
}
