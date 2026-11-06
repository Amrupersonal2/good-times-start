import { getDb, getSettings, markDirty, saveSettings } from "./db";
import type { RecordKind } from "./sync-core";
import { computeTotals } from "./billing";
import { taxOptionsFor } from "./billing-config";
import { buildLine, parseLineId } from "./menu-logic";
import type { Material, MenuItem } from "./types";

export interface ApplyMenuResult { dishes: number; ingredients: number; removed: number }

/**
 * Save imported dishes and ingredients and share them with every device.
 * Existing dishes with the same id are replaced; with `removeOthers`, dishes
 * not in the import are deleted (past bills keep their copies).
 */
export async function applyMenuImport(items: MenuItem[], materials: Material[], options: { removeOthers?: boolean; refreshHeldBillTax?: boolean } = {}): Promise<ApplyMenuResult> {
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
    const settings = options.refreshHeldBillTax ? await getSettings() : undefined;
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
      const tax = settings ? taxOptionsFor(settings, order.orderType) : order.tax;
      const taxChanged = JSON.stringify(tax ?? {}) !== JSON.stringify(order.tax ?? {});
      if (!changed && !taxChanged) continue;
      const totals = computeTotals(lines, order.discountPct, order.serviceChargePct ?? 0, tax);
      const updated = { ...order, lines, tax, ...totals, synced: false };
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
  const { TAB_CATEGORIES, TAB_MATERIALS, TAB_MENU } = await import("@/data/tab-bistro");
  const [current, currentMaterials] = await Promise.all([getDb().menu.toArray(), getDb().materials.toArray()]);
  const printedById = new Map(TAB_MENU.map((item) => [item.id, item]));
  const currentIds = new Set(current.map((item) => item.id));
  const existingMaterials = new Map(currentMaterials.map((material) => [material.id, material]));
  const materials = TAB_MATERIALS.map((material) => {
    const existing = existingMaterials.get(material.id);
    return existing ? { ...material, ...(existing.costPerUnit !== undefined ? { costPerUnit: existing.costPerUnit } : {}), lowStockLevel: existing.lowStockLevel } : material;
  });
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

  for (const item of TAB_MENU) {
    if (!currentIds.has(item.id)) {
      updated.push(item);
      dishesUpdated += 1;
    }
  }

  const settings = await getSettings();
  const nextSettings = { ...settings, pricesIncludeGst: false, categoryOrder: TAB_CATEGORIES };
  const settingsChanged = settings.pricesIncludeGst !== false ||
    JSON.stringify(settings.categoryOrder ?? []) !== JSON.stringify(TAB_CATEGORIES);
  if (settingsChanged) await saveSettings(nextSettings);
  if (dishesUpdated || settingsChanged) {
    await applyMenuImport(updated, materials, { removeOthers: false, refreshHeldBillTax: true });
  }
  return { dishesUpdated };
}
