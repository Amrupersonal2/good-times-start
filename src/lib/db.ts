import Dexie, { type Table } from "dexie";
import type { Kot, MenuItem, Order, RestaurantTable } from "./types";
import { SEED_MENU, SEED_TABLES } from "./seed";

class RestroDB extends Dexie {
  menu!: Table<MenuItem, string>;
  orders!: Table<Order, number>;
  restTables!: Table<RestaurantTable, string>;
  kots!: Table<Kot, number>;
  meta!: Table<{ key: string; value: number }, string>;

  constructor() {
    super("restro-pos");
    this.version(1).stores({
      menu: "id, category, name",
      orders: "++id, billNo, status, createdAt, tableId",
      restTables: "id, section, status",
      kots: "++id, orderId, status, createdAt",
      meta: "key",
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
}

export async function nextSeq(): Promise<number> {
  const db = getDb();
  return db.transaction("rw", db.meta, async () => {
    const cur = (await db.meta.get("billSeq"))?.value ?? 0;
    await db.meta.put({ key: "billSeq", value: cur + 1 });
    return cur + 1;
  });
}
