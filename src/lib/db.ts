import Dexie, { type Table } from "dexie";
import type { CartDraft, InventoryItem, Kot, MenuItem, Order, RestaurantTable } from "./types";
import { SEED_MENU, SEED_TABLES } from "./seed";

class RestroDB extends Dexie {
  menu!: Table<MenuItem, string>;
  orders!: Table<Order, number>;
  restTables!: Table<RestaurantTable, string>;
  kots!: Table<Kot, number>;
  meta!: Table<{ key: string; value: number | string }, string>;
  inventory!: Table<InventoryItem, string>;
  drafts!: Table<CartDraft, string>;

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
  }
}

let _db: RestroDB | null = null;
export function getDb(): RestroDB {
  if (!_db) _db = new RestroDB();
  return _db;
}

export async function ensureSeed() {
  const db = getDb();
  if ((await db.menu.count()) === 0) await db.menu.bulkPut(SEED_MENU);
  if ((await db.restTables.count()) === 0) await db.restTables.bulkPut(SEED_TABLES);
  if ((await db.inventory.count()) === 0) {
    const menu = await db.menu.toArray();
    await db.inventory.bulkPut(menu.map((item) => ({
      id: item.id,
      menuItemId: item.id,
      name: item.name,
      unit: "portions",
      quantity: 0,
      lowStockThreshold: 5,
      tracked: false,
      synced: false,
    })));
  }
}

export async function nextSeq(): Promise<number> {
  const db = getDb();
  return db.transaction("rw", db.meta, async () => {
    const cur = (await db.meta.get("billSeq"))?.value ?? 0;
    await db.meta.put({ key: "billSeq", value: cur + 1 });
    return cur + 1;
  });
}
