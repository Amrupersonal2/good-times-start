import { getDb, getSettings, markDirty, saveSettings } from "./db";
import type { RecordKind } from "./sync-core";
import type { Material, MenuItem } from "./types";

export interface ApplyMenuResult { dishes: number; ingredients: number; removed: number }

/**
 * Save imported dishes and ingredients and share them with every device.
 * Existing dishes with the same id are replaced; with `removeOthers`, dishes
 * not in the import are deleted (past bills keep their copies).
 */
export async function applyMenuImport(items: MenuItem[], materials: Material[], options: { removeOthers?: boolean } = {}): Promise<ApplyMenuResult> {
  const db = getDb();
  const keep = new Set(items.map((i) => i.id));
  const changes: [RecordKind, string][] = [];
  let removed = 0;
  await db.transaction("rw", db.menu, db.materials, async () => {
    if (materials.length) await db.materials.bulkPut(materials);
    if (items.length) await db.menu.bulkPut(items);
    if (options.removeOthers) {
      const stale = (await db.menu.toCollection().primaryKeys()).map(String).filter((id) => !keep.has(id));
      if (stale.length) await db.menu.bulkDelete(stale);
      removed = stale.length;
      changes.push(...stale.map((id): [RecordKind, string] => ["menu", id]));
    }
  });
  changes.push(...materials.map((m): [RecordKind, string] => ["material", m.id]), ...items.map((i): [RecordKind, string] => ["menu", i.id]));
  await markDirty(...changes);
  return { dishes: items.length, ingredients: materials.length, removed };
}

/** Loads the TAB Bistro by XTSY menu, ingredients and recipes (kept in a separate chunk until needed). */
export async function loadTabBistroMenu(removeOthers: boolean): Promise<ApplyMenuResult> {
  const { TAB_MATERIALS, TAB_MENU } = await import("@/data/tab-bistro");
  const db = getDb();
  // Keep any cost or warning level the restaurant has already set for these ingredients.
  const current = new Map((await db.materials.toArray()).map((m) => [m.id, m]));
  const materials = TAB_MATERIALS.map((m) => {
    const mine = current.get(m.id);
    return mine ? { ...m, ...(mine.costPerUnit !== undefined ? { costPerUnit: mine.costPerUnit } : {}), lowStockLevel: mine.lowStockLevel } : m;
  });
  const result = await applyMenuImport(TAB_MENU, materials, { removeOthers });
  const { TAB_CATEGORIES } = await import("@/data/tab-bistro");
  const settings = await getSettings();
  await saveSettings({ ...settings, name: settings.name || "TAB Bistro by XTSY", categoryOrder: TAB_CATEGORIES });
  return result;
}
