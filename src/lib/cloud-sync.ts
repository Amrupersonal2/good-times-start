import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { applyEntryToLevels, getDb, getSettings, markDirty, onLocalChange, type OutboxEntry } from "@/lib/db";
import { deductInventory } from "@/lib/inventory";
import { recordSaleConsumption } from "@/lib/stock-actions";
import {
  RECORD_KINDS,
  isCustomerPayload,
  isDayClosePayload,
  isMaterialPayload,
  isStockEntryPayload,
  isSupplierPayload,
  isInventoryPayload,
  isKotPayload,
  isMenuPayload,
  isOrderPayload,
  isSettingsPayload,
  isTablePayload,
  outboxKey,
  pullStartFrom,
  toSharedPayload,
  type RecordKind,
} from "@/lib/sync-core";
import type { InventoryItem, Kot, Order } from "@/lib/types";

/**
 * Live sync for a restaurant's devices.
 *
 * IndexedDB stays the source of truth for the screen, so billing and the kitchen
 * board keep working offline. Local edits go into the outbox (see markDirty);
 * a sync pushes them to restaurant_records, then pulls everything newer than
 * the last cursor. A realtime ping from Postgres triggers a pull, so a KOT sent
 * from the counter shows on the kitchen screen within seconds.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;

interface RemoteRow {
  kind: string;
  record_id: string;
  payload: Json;
  deleted: boolean;
  updated_at: string;
}

const isKind = (kind: string): kind is RecordKind => (RECORD_KINDS as readonly string[]).includes(kind);

async function readLocal(kind: RecordKind, recordId: string): Promise<unknown> {
  const db = getDb();
  switch (kind) {
    case "settings": {
      const settings = await getSettings();
      return settings.name ? settings : undefined;
    }
    case "menu": return db.menu.get(recordId);
    case "table": return db.restTables.get(recordId);
    case "inventory": return db.inventory.get(recordId);
    case "order": return db.orders.where("uid").equals(recordId).first();
    case "kot": return db.kots.where("uid").equals(recordId).first();
    case "material": return db.materials.get(recordId);
    case "supplier": return db.suppliers.get(recordId);
    case "stock_entry": return db.stockEntries.get(recordId);
    case "customer": return db.customers.get(recordId);
    case "day_close": return db.dayCloses.get(recordId);
  }
}

async function upsert(rows: { restaurant_id: string; kind: string; record_id: string; payload: Json; deleted: boolean }[]) {
  if (!rows.length) return null;
  const { error } = await supabase.from("restaurant_records").upsert(rows, { onConflict: "restaurant_id,kind,record_id" });
  return error;
}

async function push(restaurantId: string): Promise<void> {
  const db = getDb();
  for (;;) {
    const entries: OutboxEntry[] = await db.outbox.orderBy("at").limit(PUSH_BATCH).toArray();
    if (!entries.length) return;

    const rows: { restaurant_id: string; kind: string; record_id: string; payload: Json; deleted: boolean }[] = [];
    for (const entry of entries) {
      const local = await readLocal(entry.kind, entry.recordId);
      if (entry.kind === "settings" && local === undefined) continue;
      rows.push({
        restaurant_id: restaurantId,
        kind: entry.kind,
        record_id: entry.recordId,
        payload: (local === undefined ? {} : toSharedPayload(entry.kind, local)) as Json,
        deleted: local === undefined,
      });
    }

    const error = await upsert(rows.filter((row) => row.kind !== "settings"));
    if (error) throw error;
    // Only owners and managers may change restaurant details; drop a refused change instead of retrying forever.
    const settingsError = await upsert(rows.filter((row) => row.kind === "settings"));

    await db.transaction("rw", db.outbox, async () => {
      for (const entry of entries) {
        const current = await db.outbox.get(entry.key);
        if (current && current.at === entry.at) await db.outbox.delete(entry.key);
      }
    });
    if (settingsError) throw new Error("Only the owner or a manager can change restaurant details. Your change stays on this device only.");
    if (entries.length < PUSH_BATCH) return;
  }
}

async function applyRemote(rows: RemoteRow[]): Promise<void> {
  const db = getDb();
  // The outbox is read inside the same transaction, so a local edit can't slip in between the check and the write.
  await db.transaction("rw", [db.outbox, db.menu, db.restTables, db.inventory, db.orders, db.kots, db.meta, db.materials, db.suppliers, db.stockEntries, db.customers, db.dayCloses, db.materialLevels], async () => {
    const pending = new Set((await db.outbox.toCollection().primaryKeys()).map(String));
    for (const row of rows) {
      if (!isKind(row.kind)) continue;
      // Local edits that haven't been pushed yet win; they'll overwrite the cloud copy next push.
      if (pending.has(outboxKey(row.kind, row.record_id))) continue;
      const payload: unknown = row.payload;
      const id = row.record_id;

      switch (row.kind) {
        case "settings":
          if (!row.deleted && isSettingsPayload(payload)) await db.meta.put({ key: "restaurantSettings", value: JSON.stringify(payload) });
          break;
        case "menu":
          if (row.deleted) await db.menu.delete(id);
          else if (isMenuPayload(payload)) await db.menu.put({ ...payload, id });
          break;
        case "table":
          if (row.deleted) await db.restTables.delete(id);
          else if (isTablePayload(payload)) await db.restTables.put({ ...payload, id });
          break;
        case "inventory":
          if (row.deleted) await db.inventory.delete(id);
          else if (isInventoryPayload(payload)) {
            const item: InventoryItem = { ...payload, id, synced: true };
            await db.inventory.put(item);
          }
          break;
        case "order": {
          const existing = await db.orders.where("uid").equals(id).first();
          if (row.deleted) {
            if (existing?.id !== undefined) await db.orders.delete(existing.id);
            break;
          }
          if (!isOrderPayload(payload)) break;
          const { id: _ignored, ...rest } = payload;
          const order: Order = existing?.id !== undefined
            ? { ...rest, id: existing.id, uid: id, synced: true }
            : { ...rest, uid: id, synced: true };
          await db.orders.put(order);
          break;
        }
        case "kot": {
          const existing = await db.kots.where("uid").equals(id).first();
          if (row.deleted) {
            if (existing?.id !== undefined) await db.kots.delete(existing.id);
            break;
          }
          if (!isKotPayload(payload)) break;
          const parent = payload.orderUid ? await db.orders.where("uid").equals(payload.orderUid).first() : undefined;
          const { id: _ignored, ...rest } = payload;
          const kot: Kot = existing?.id !== undefined
            ? { ...rest, id: existing.id, uid: id, orderId: parent?.id ?? existing.orderId }
            : { ...rest, uid: id, orderId: parent?.id ?? 0 };
          await db.kots.put(kot);
          break;
        }
        case "material":
          if (row.deleted) await db.materials.delete(id);
          else if (isMaterialPayload(payload)) await db.materials.put({ ...payload, id });
          break;
        case "supplier":
          if (row.deleted) await db.suppliers.delete(id);
          else if (isSupplierPayload(payload)) await db.suppliers.put({ ...payload, id });
          break;
        case "stock_entry":
          // Ledger entries also move the cached stock levels; re-applying the same entry is a no-op.
          if (row.deleted) {
            await applyEntryToLevels(db, id, null);
            await db.stockEntries.delete(id);
          } else if (isStockEntryPayload(payload)) {
            const entry = { ...payload, id };
            await applyEntryToLevels(db, id, entry);
            await db.stockEntries.put(entry);
          }
          break;
        case "customer":
          if (row.deleted) await db.customers.delete(id);
          else if (isCustomerPayload(payload)) await db.customers.put({ ...payload, id });
          break;
        case "day_close":
          if (row.deleted) await db.dayCloses.delete(id);
          else if (isDayClosePayload(payload)) await db.dayCloses.put({ ...payload, id });
          break;
      }
    }
  });
}

async function pull(restaurantId: string): Promise<void> {
  const db = getDb();
  const stored = (await db.meta.get("pullCursor"))?.value;
  const cursor = typeof stored === "string" && stored ? stored : null;
  let newest = cursor;
  let from = pullStartFrom(cursor);
  let firstPage = true;

  for (;;) {
    let query = supabase
      .from("restaurant_records")
      .select("kind,record_id,payload,deleted,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: true })
      .limit(PULL_PAGE);
    if (from) query = firstPage ? query.gte("updated_at", from) : query.gt("updated_at", from);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as RemoteRow[];
    if (rows.length) {
      await applyRemote(rows);
      const last = rows[rows.length - 1]!.updated_at;
      if (!newest || last > newest) newest = last;
      from = last;
    }
    firstPage = false;
    if (rows.length < PULL_PAGE) break;
  }
  if (newest) await db.meta.put({ key: "pullCursor", value: newest });
}

async function syncOnce(restaurantId: string): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("No internet connection. Orders remain safely stored on this device.");
  }
  const db = getDb();
  const bound = (await db.meta.get("restaurantId"))?.value;
  if (typeof bound === "string" && bound && bound !== restaurantId) {
    throw new Error("This device holds another restaurant's data. An owner can reset this device in Settings to switch restaurants.");
  }
  if (!bound) await db.meta.put({ key: "restaurantId", value: restaurantId });

  await push(restaurantId);
  await pull(restaurantId);
  await db.meta.put({ key: "lastSyncAt", value: Date.now() });
  await db.meta.put({ key: "syncError", value: "" });
}

let inFlight: Promise<void> | null = null;
let queued = false;

/** Push local changes and pull the latest restaurant data. Concurrent calls share one run. */
export function syncCloudData(restaurantId: string): Promise<void> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        queued = false;
        await syncOnce(restaurantId);
      } while (queued);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Keeps this device in step with the restaurant: syncs on start, shortly after
 * local edits, when the connection returns, on realtime notifications, and
 * every minute as a fallback. Returns a stop function.
 */
export function startLiveSync(restaurantId: string): () => void {
  let stopped = false;
  let timer: number | undefined;

  const run = () => {
    if (stopped) return;
    void syncCloudData(restaurantId).catch((error: unknown) => saveSyncError(error));
  };
  const schedule = (delay: number) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, delay);
  };

  const stopLocal = onLocalChange(() => schedule(800));
  const onOnline = () => schedule(0);
  window.addEventListener("online", onOnline);
  const interval = window.setInterval(() => schedule(0), 60_000);
  const channel = supabase
    .channel(`restaurant-records-${restaurantId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "restaurant_records", filter: `restaurant_id=eq.${restaurantId}` },
      () => schedule(250),
    )
    .subscribe();

  schedule(0);
  return () => {
    stopped = true;
    window.clearTimeout(timer);
    window.clearInterval(interval);
    window.removeEventListener("online", onOnline);
    stopLocal();
    void supabase.removeChannel(channel);
  };
}

/**
 * Deduct stock for a settled bill: portions of dishes counted directly, and
 * raw materials from each dish's recipe (as a ledger entry tied to the bill).
 */
export async function applyLocalStockSale(soldLines: Order["lines"], ref?: { orderUid: string; billNo: string; by?: string | undefined }): Promise<void> {
  const db = getDb();
  const items = await db.inventory.toArray();
  const changed = deductInventory(soldLines, items).filter((item) => item.synced === false);
  if (changed.length) {
    await db.inventory.bulkPut(changed);
    await markDirty(...changed.map((item): [RecordKind, string] => ["inventory", item.id]));
  }
  if (ref) await recordSaleConsumption(soldLines, ref);
}

export async function getSyncSnapshot() {
  const db = getDb();
  const [total, pendingOrders, lastSync, error] = await Promise.all([
    db.outbox.count(),
    db.outbox.where("kind").equals("order").count(),
    db.meta.get("lastSyncAt"),
    db.meta.get("syncError"),
  ]);
  return {
    pendingOrders,
    pendingStock: total - pendingOrders,
    lastSyncAt: typeof lastSync?.value === "number" ? lastSync.value : null,
    error: typeof error?.value === "string" ? error.value : "",
  };
}

export async function saveSyncError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Sync could not be completed.";
  await getDb().meta.put({ key: "syncError", value: message.slice(0, 500) });
}
