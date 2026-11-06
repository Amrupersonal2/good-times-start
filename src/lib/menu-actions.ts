import { getDb, getSettings, markDirty, saveSettings } from "./db";
import type { RecordKind } from "./sync-core";
import { computeTotals } from "./billing";
import { buildLine, parseLineId } from "./menu-logic";
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
  await db.transaction("rw", db.menu, db.materials, db.orders, async () => {
    if (materials.length) await db.materials.bulkPut(materials);
    if (items.length) await db.menu.bulkPut(items);
    // Running bills retain their original printed item names, but follow the
    // current menu price when the imported menu changes that item/variant.
    const byId = new Map(items.map((item) => [item.id, item]));
    const held = await db.orders.where("status").equals("held").toArray();
    for (const order of held) {
      let changed = false;
      const lines = order.lines.map((line) => {
        const parsed = parseLineId(line.menuItemId ?? line.itemId);
        const item = byId.get(parsed.menuItemId);
        if (!item) return line;
        const repriced = buildLine(item, order.orderType, parsed.variantId, parsed.addonIds);
        if (repriced.price === line.price) return line;
        changed = true;
        return { ...line, price: repriced.price };
      });
      if (!changed) continue;
      const totals = computeTotals(lines, order.discountPct, order.serviceChargePct ?? 0, order.tax);
      const updated = { ...order, lines, ...totals, synced: false };
      await db.orders.put(updated);
      if (updated.uid) changes.push(["order", updated.uid]);
    }
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

/**
 * Apply only the printed TAB Bistro prices to matching menu IDs. Preserve
 * restaurant-specific names, availability, recipes, tax settings and custom
 * dishes. applyMenuImport also reprices every held bill; settled bills are
 * intentionally immutable.
 */
export async function syncPrintedTabMenuPrices(): Promise<{ dishesUpdated: number }> {
  const { TAB_CATEGORIES, TAB_MENU } = await import("@/data/tab-bistro");
  const current = await getDb().menu.toArray();
  const printedById = new Map(TAB_MENU.map((item) => [item.id, item]));
  let dishesUpdated = 0;

  const updated = current.map((item) => {
    const printed = printedById.get(item.id);
    if (!printed) return item;

    const variants = item.variants?.map((variant) => {
      const printedVariant = printed.variants?.find((candidate) => candidate.id === variant.id);
      return printedVariant ? { ...variant, price: printedVariant.price } : variant;
    });
    const addons = item.addons?.map((addon) => {
      const printedAddon = printed.addons?.find((candidate) => candidate.id === addon.id);
      return printedAddon ? { ...addon, price: printedAddon.price } : addon;
    });
    const changed = item.price !== printed.price || item.category !== printed.category || item.station !== printed.station ||
      (variants ?? []).some((variant, index) => variant.price !== item.variants?.[index]?.price) ||
      (addons ?? []).some((addon, index) => addon.price !== item.addons?.[index]?.price);
    if (!changed) return item;
    dishesUpdated += 1;
    return { ...item, price: printed.price, category: printed.category, station: printed.station,
      ...(variants ? { variants } : {}), ...(addons ? { addons } : {}) };
  });

  if (dishesUpdated) await applyMenuImport(updated, [], { removeOthers: false });
  const settings = await getSettings();
  if (JSON.stringify(settings.categoryOrder ?? []) !== JSON.stringify(TAB_CATEGORIES)) {
    await saveSettings({ ...settings, categoryOrder: TAB_CATEGORIES });
  }
  return { dishesUpdated };
}
