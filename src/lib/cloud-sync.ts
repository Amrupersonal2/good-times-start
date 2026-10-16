import { supabase } from "@/integrations/supabase/client";
import { getDb } from "@/lib/db";
import type { InventoryItem, Kot, Order } from "@/lib/types";
import { deductInventory } from "@/lib/inventory";

function isOrder(value: unknown): value is Order {
  if (!value || typeof value !== "object") return false;
  const order = value as Partial<Order>;
  return typeof order.billNo === "string" && Array.isArray(order.lines) &&
    typeof order.total === "number" && (order.status === "settled" || order.status === "held" || order.status === "void");
}

function kotsForOrder(order: Order): Omit<Kot, "id">[] {
  const byStation = new Map<string, Order["lines"]>();
  for (const line of order.lines) {
    const stationLines = byStation.get(line.station) ?? [];
    stationLines.push(line);
    byStation.set(line.station, stationLines);
  }
  return Array.from(byStation, ([station, lines]) => ({
    orderId: order.id ?? 0,
    billNo: order.billNo,
    station,
    lines: lines.map(({ name, qty, note }) => ({ name, qty, note })),
    status: "new" as const,
    createdAt: order.createdAt,
  }));
}

export async function syncCloudData(userId: string): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("No internet connection. Orders remain safely stored on this device.");
  const { data: verified } = await supabase.auth.getUser();
  if (verified.user?.id !== userId) return;

  const db = getDb();
  await db.meta.put({ key: "syncError", value: "" });
  const localOrders = await db.orders.toArray();
  const pendingOrders = localOrders
    .filter((order) => !order.cloudUserId && order.status === "settled" && !order.synced)
    .map((order) => ({ ...order, cloudUserId: userId }));
  if (pendingOrders.length) await db.orders.bulkPut(pendingOrders);
  const ownedPendingOrders = localOrders
    .filter((order) => order.cloudUserId === userId && order.status === "settled" && !order.synced)
    .concat(pendingOrders);
  if (ownedPendingOrders.length) {
    const { error } = await supabase.from("cloud_orders").upsert(
      ownedPendingOrders.map((order) => ({
        user_id: userId,
        bill_no: order.billNo,
        payload: JSON.parse(JSON.stringify(order)),
      })),
      { onConflict: "user_id,bill_no" },
    );
    if (error) throw error;
    await db.orders.bulkPut(ownedPendingOrders.map((order) => ({ ...order, synced: true })));
  }

  const { data: remoteOrders, error: orderError } = await supabase
    .from("cloud_orders").select("bill_no,payload").eq("user_id", userId);
  if (orderError) throw orderError;
  for (const row of remoteOrders ?? []) {
    const payload: unknown = row.payload;
    if (!isOrder(payload) || payload.status !== "settled") continue;
    const existing = await db.orders.where("billNo").equals(row.bill_no).first();
    if (existing) continue;
    const order: Order = { ...payload, synced: true, cloudUserId: userId };
    const id = await db.orders.add(order);
    await db.kots.bulkAdd(kotsForOrder({ ...order, id }));
  }

  const { data: remoteInventory, error: inventoryError } = await supabase
    .from("inventory_items").select("id,menu_item_id,name,unit,quantity,low_stock_threshold").eq("user_id", userId);
  if (inventoryError) throw inventoryError;
  const localInventory = await db.inventory.toArray();
  for (const row of remoteInventory ?? []) {
    if (!row.menu_item_id) continue;
    const existing = localInventory.find((item) => item.menuItemId === row.menu_item_id);
    if (existing && !existing.synced) continue;
    await db.inventory.put({
      id: row.menu_item_id,
      menuItemId: row.menu_item_id,
      name: row.name,
      unit: row.unit,
      quantity: Number(row.quantity),
      lowStockThreshold: Number(row.low_stock_threshold),
      tracked: true,
      synced: true,
    });
  }

  const latestInventory = await db.inventory.toArray();
  for (const item of latestInventory.filter((stock) => !stock.synced)) {
    const { data: existing } = await supabase.from("inventory_items")
      .select("id").eq("user_id", userId).eq("menu_item_id", item.menuItemId).maybeSingle();
    const values = {
      name: item.name,
      unit: item.unit,
      quantity: item.quantity,
      low_stock_threshold: item.lowStockThreshold,
      updated_at: new Date().toISOString(),
    };
    const result = existing
      ? await supabase.from("inventory_items").update(values).eq("id", existing.id).eq("user_id", userId)
      : await supabase.from("inventory_items").insert({ ...values, user_id: userId, menu_item_id: item.menuItemId });
    if (result.error) throw result.error;
    await db.inventory.update(item.id, { synced: true });
  }
  await db.meta.put({ key: "lastSyncAt", value: Date.now() });
  await db.meta.put({ key: "syncError", value: "" });
}

export async function applyLocalStockSale(userId: string | undefined, soldLines: Order["lines"]): Promise<void> {
  const db = getDb();
  const items = await db.inventory.toArray();
  const changed = deductInventory(soldLines, items).filter((item) => item.synced === false);
  if (changed.length) await db.inventory.bulkPut(changed);
  if (userId) await syncCloudData(userId);
}

export async function getSyncSnapshot() {
  const db = getDb();
  const [orders, lastSync, error, inventory] = await Promise.all([
    db.orders.toArray(),
    db.meta.get("lastSyncAt"),
    db.meta.get("syncError"),
    db.inventory.toArray(),
  ]);
  return {
    pendingOrders: orders.filter((order) => order.status === "settled" && !order.synced).length,
    lastSyncAt: typeof lastSync?.value === "number" ? lastSync.value : null,
    error: typeof error?.value === "string" ? error.value : "",
    pendingStock: inventory.filter((item) => !item.synced).length,
  };
}

export async function saveSyncError(error: unknown) {
  const message = error instanceof Error ? error.message : "Sync could not be completed.";
  await getDb().meta.put({ key: "syncError", value: message.slice(0, 500) });
}