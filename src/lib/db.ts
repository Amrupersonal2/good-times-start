import Dexie, { type Table } from "dexie";
import type { CartDraft, Customer, DayClose, InventoryItem, Kot, Material, MenuItem, Order, RestaurantSettings, RestaurantTable, StockEntry, Supplier } from "./types";
import { SEED_MENU, SEED_TABLES } from "./seed";
import { normalisePhone } from "./customer-logic";
import { stockLevels } from "./stock-logic";
import {
  SETTINGS_RECORD_ID,
  legacyKotUid,
  legacyOrderUid,
  outboxKey,
  randomDeviceCode,
  type RecordKind,
} from "./sync-core";

/** A record changed on this device that still has to reach the restaurant's cloud copy. */
export interface OutboxEntry {
  key: string;
  kind: RecordKind;
  recordId: string;
  at: number;
}

class RestroDB extends Dexie {
  menu!: Table<MenuItem, string>;
  orders!: Table<Order, number>;
  restTables!: Table<RestaurantTable, string>;
  kots!: Table<Kot, number>;
  meta!: Table<{ key: string; value: number | string }, string>;
  inventory!: Table<InventoryItem, string>;
  drafts!: Table<CartDraft, string>;
  outbox!: Table<OutboxEntry, string>;
  materials!: Table<Material, string>;
  suppliers!: Table<Supplier, string>;
  stockEntries!: Table<StockEntry, string>;
  customers!: Table<Customer, string>;
  dayCloses!: Table<DayClose, string>;
  /** Running stock per raw material, kept in step with stockEntries so screens never re-add the whole ledger. */
  materialLevels!: Table<{ materialId: string; qty: number }, string>;

  constructor() {
    super("restro-pos");
    this.version(1).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt",
      meta: "key",
    });
    this.version(2).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
    });
    this.version(3).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
      drafts: "id, tableId, updatedAt",
    });
    // XTSY POS: shared ids for bills and KOTs, per-device bill series and the sync outbox.
    this.version(4).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId, uid",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt, uid",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
      drafts: "id, tableId, updatedAt",
      outbox: "key, kind, at",
    }).upgrade(async (tx) => {
      const orders = tx.table<Order, number>("orders");
      const kots = tx.table<Kot, number>("kots");
      const meta = tx.table<{ key: string; value: number | string }, string>("meta");

      await orders.toCollection().modify((order) => { if (!order.uid) order.uid = legacyOrderUid(order); });
      const uidByOrderId = new Map<number, string>();
      for (const order of await orders.toArray()) if (order.id !== undefined && order.uid) uidByOrderId.set(order.id, order.uid);
      await kots.toCollection().modify((kot) => {
        if (!kot.uid) kot.uid = legacyKotUid(kot);
        if (!kot.orderUid) {
          const orderUid = uidByOrderId.get(kot.orderId);
          if (orderUid) kot.orderUid = orderUid;
        }
      });

      // Devices already billing keep their current series so bill numbers stay continuous.
      if (!(await meta.get("deviceCode"))) {
        await meta.put({ key: "deviceCode", value: (await meta.get("billSeq")) ? "D1" : randomDeviceCode() });
      }

      // Queue this device's existing data once, so it reaches the restaurant on first sync.
      const at = Date.now();
      const entries: OutboxEntry[] = [];
      const queue = (kind: RecordKind, recordId: string) => entries.push({ key: outboxKey(kind, recordId), kind, recordId, at });
      for (const key of await tx.table<MenuItem, string>("menu").toCollection().primaryKeys()) queue("menu", String(key));
      for (const key of await tx.table<RestaurantTable, string>("restTables").toCollection().primaryKeys()) queue("table", String(key));
      for (const item of await tx.table<InventoryItem, string>("inventory").toArray()) if (item.tracked) queue("inventory", item.id);
      for (const order of await orders.toArray()) if (order.uid) queue("order", order.uid);
      const recent = at - 2 * 24 * 60 * 60 * 1000;
      for (const kot of await kots.where("createdAt").aboveOrEqual(recent).toArray()) if (kot.uid) queue("kot", kot.uid);
      await tx.table<OutboxEntry, string>("outbox").bulkPut(entries);
    });
    // XTSY POS: stock ledger and customer directory.
    this.version(5).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId, uid",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt, uid",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
      drafts: "id, tableId, updatedAt",
      outbox: "key, kind, at",
      materials: "id, name",
      suppliers: "id, name",
      stockEntries: "id, type, at",
      customers: "id, phone, name",
    });
    this.version(6).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId, uid",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt, uid",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
      drafts: "id, tableId, updatedAt",
      outbox: "key, kind, at",
      materials: "id, name",
      suppliers: "id, name",
      stockEntries: "id, type, at",
      customers: "id, phone, name",
      dayCloses: "id, day",
    });
    // Speed: running bill per table by index, guest visits by index, cached stock levels.
    this.version(7).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId, uid, customerId, [tableId+status]",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt, uid",
      meta: "key",
      inventory: "id, menuItemId, tracked, synced",
      drafts: "id, tableId, updatedAt",
      outbox: "key, kind, at",
      materials: "id, name",
      suppliers: "id, name",
      stockEntries: "id, type, at",
      customers: "id, phone, name",
      dayCloses: "id, day",
      materialLevels: "materialId",
    }).upgrade(async (tx) => {
      await tx.table<Order, number>("orders").toCollection().modify((order) => {
        const id = normalisePhone(order.customer?.phone);
        if (id) order.customerId = id;
      });
      const levels = stockLevels(await tx.table<StockEntry, string>("stockEntries").toArray());
      await tx.table<{ materialId: string; qty: number }, string>("materialLevels").bulkPut([...levels].map(([materialId, qty]) => ({ materialId, qty })));
    });
  }
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Keep cached stock levels in step with one ledger entry being added,
 * replaced or removed. Call inside a transaction that includes
 * stockEntries and materialLevels, before writing the entry itself.
 */
export async function applyEntryToLevels(db: RestroDB, entryId: string, next: StockEntry | null): Promise<void> {
  const previous = await db.stockEntries.get(entryId);
  const deltas = new Map<string, number>();
  for (const item of previous?.items ?? []) deltas.set(item.materialId, (deltas.get(item.materialId) ?? 0) - item.qty);
  for (const item of next?.items ?? []) deltas.set(item.materialId, (deltas.get(item.materialId) ?? 0) + item.qty);
  for (const [materialId, delta] of deltas) {
    if (!delta) continue;
    const current = (await db.materialLevels.get(materialId))?.qty ?? 0;
    await db.materialLevels.put({ materialId, qty: r3(current + delta) });
  }
}

/** Current stock of every raw material, from the cache. */
export async function getMaterialLevels(): Promise<Map<string, number>> {
  return new Map((await getDb().materialLevels.toArray()).map((l) => [l.materialId, l.qty]));
}

let _db: RestroDB | null = null;
export function getDb(): RestroDB {
  if (!_db) _db = new RestroDB();
  return _db;
}

/* ---------- change tracking ---------- */

const listeners = new Set<() => void>();
let tick = 0;

/** Subscribe to local edits that need syncing. Returns an unsubscribe function. */
export function onLocalChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Record that these shared records changed on this device. */
export async function markDirty(...changes: [RecordKind, string][]): Promise<void> {
  if (!changes.length) return;
  const base = Date.now() * 1000;
  const entries = changes.map(([kind, recordId]): OutboxEntry => {
    tick = (tick + 1) % 1000;
    return { key: outboxKey(kind, recordId), kind, recordId, at: base + tick };
  });
  await getDb().outbox.bulkPut(entries);
  for (const listener of listeners) listener();
}

/* ---------- device bill series ---------- */

export async function getDeviceCode(): Promise<string> {
  const db = getDb();
  const stored = (await db.meta.get("deviceCode"))?.value;
  if (typeof stored === "string" && stored) return stored;
  const code = randomDeviceCode();
  await db.meta.put({ key: "deviceCode", value: code });
  return code;
}

/**
 * A new device code starts a new bill series. The counter restarts so the new
 * series reads INV/26-27/C1/0001, and the old series is never reused.
 */
export async function setDeviceCode(code: string): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.meta, async () => {
    const current = (await db.meta.get("deviceCode"))?.value;
    if (current === code) return;
    await db.meta.put({ key: "deviceCode", value: code });
    await db.meta.put({ key: "billSeq", value: 0 });
  });
}

export async function nextSeq(): Promise<number> {
  const db = getDb();
  return db.transaction("rw", db.meta, async () => {
    const stored = (await db.meta.get("billSeq"))?.value;
    const cur = typeof stored === "number" ? stored : 0;
    await db.meta.put({ key: "billSeq", value: cur + 1 });
    return cur + 1;
  });
}

/* ---------- restaurant settings ---------- */

export const EMPTY_SETTINGS: RestaurantSettings = { name: "" };

export async function getSettings(): Promise<RestaurantSettings> {
  const raw = (await getDb().meta.get("restaurantSettings"))?.value;
  if (typeof raw !== "string" || !raw) return EMPTY_SETTINGS;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && typeof (parsed as RestaurantSettings).name === "string"
      ? (parsed as RestaurantSettings)
      : EMPTY_SETTINGS;
  } catch {
    return EMPTY_SETTINGS;
  }
}

/** Save locally; `share` queues the change for the other devices (owners and managers). */
export async function saveSettings(settings: RestaurantSettings, share = true): Promise<void> {
  await getDb().meta.put({ key: "restaurantSettings", value: JSON.stringify({ ...settings, updatedAt: Date.now() }) });
  if (share) await markDirty(["settings", SETTINGS_RECORD_ID]);
}

/* ---------- sample data and device reset ---------- */

/** Loads the sample menu and floor plan into an empty restaurant and shares it. */
export async function loadSampleData(): Promise<void> {
  const db = getDb();
  const changes: [RecordKind, string][] = [];
  if ((await db.menu.count()) === 0) {
    await db.menu.bulkPut(SEED_MENU);
    changes.push(...SEED_MENU.map((item): [RecordKind, string] => ["menu", item.id]));
  }
  if ((await db.restTables.count()) === 0) {
    await db.restTables.bulkPut(SEED_TABLES);
    changes.push(...SEED_TABLES.map((table): [RecordKind, string] => ["table", table.id]));
  }
  await markDirty(...changes);
}

/**
 * Clears this device so it can join a different restaurant. Keeps the bill
 * series counter so this device never prints a bill number twice.
 */
export async function resetDevice(): Promise<void> {
  const db = getDb();
  await db.transaction("rw", [db.menu, db.orders, db.restTables, db.kots, db.inventory, db.drafts, db.outbox, db.meta, db.materials, db.suppliers, db.stockEntries, db.customers, db.dayCloses, db.materialLevels], async () => {
    await Promise.all([db.materialLevels.clear(), db.menu.clear(), db.orders.clear(), db.restTables.clear(), db.kots.clear(), db.inventory.clear(), db.drafts.clear(), db.outbox.clear(),
      db.materials.clear(), db.suppliers.clear(), db.stockEntries.clear(), db.customers.clear(), db.dayCloses.clear()]);
    for (const key of ["restaurantId", "pullCursor", "restaurantSettings", "lastSyncAt", "syncError"]) await db.meta.delete(key);
  });
}
