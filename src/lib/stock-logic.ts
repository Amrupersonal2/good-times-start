import { parseLineId, stockItemId } from "./menu-logic";
import type { CartLine, Material, MenuItem, StockEntry, StockUnit } from "./types";

export const STOCK_UNITS: { v: StockUnit; l: string }[] = [
  { v: "kg", l: "kg" },
  { v: "g", l: "grams" },
  { v: "l", l: "litres" },
  { v: "ml", l: "ml" },
  { v: "pcs", l: "pieces" },
  { v: "dozen", l: "dozen" },
  { v: "packet", l: "packets" },
];

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Current stock of each material: the sum of every ledger movement. */
export function stockLevels(entries: StockEntry[]): Map<string, number> {
  const levels = new Map<string, number>();
  for (const entry of entries) {
    for (const item of entry.items) levels.set(item.materialId, r3((levels.get(item.materialId) ?? 0) + item.qty));
  }
  return levels;
}

/** Materials a set of bill lines uses, from each dish's recipe (per portion × portions sold). */
export function consumptionFor(lines: CartLine[], menu: MenuItem[]): { materialId: string; qty: number }[] {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const used = new Map<string, number>();
  for (const line of lines) {
    const { variantId, addonIds } = parseLineId(line.itemId);
    const item = byId.get(stockItemId(line));
    if (!item) continue;
    const parts = [
      ...(item.recipe ?? []),
      ...(item.variants?.find((v) => v.id === variantId)?.recipe ?? []),
      ...(item.addons ?? []).filter((a) => addonIds.includes(a.id)).flatMap((a) => a.recipe ?? []),
    ];
    for (const part of parts) used.set(part.materialId, r3((used.get(part.materialId) ?? 0) + part.qty * line.qty));
  }
  return [...used].filter(([, qty]) => qty > 0).map(([materialId, qty]) => ({ materialId, qty }));
}

/** Ledger items for a sale (negative) or for undoing one (positive). */
export function saleItems(lines: CartLine[], menu: MenuItem[], direction: -1 | 1 = -1) {
  return consumptionFor(lines, menu).map((c) => ({ materialId: c.materialId, qty: r3(c.qty * direction) }));
}

/** The movement that brings the books in line with a physical count. */
export function countAdjustment(onBooks: number, counted: number): number {
  return r3(counted - onBooks);
}

export function isLow(material: Material, level: number): boolean {
  return level <= material.lowStockLevel;
}

export function stockValue(materials: Material[], levels: Map<string, number>): number {
  return Math.round(materials.reduce((sum, m) => sum + Math.max(0, levels.get(m.id) ?? 0) * (m.costPerUnit ?? 0), 0) * 100) / 100;
}

/** Total cost of a purchase. */
export function purchaseTotal(items: StockEntry["items"]): number {
  return Math.round(items.reduce((sum, i) => sum + Math.max(0, i.qty) * (i.unitCost ?? 0), 0) * 100) / 100;
}

/** Show quantities without float noise: 1.5 kg, 250 g, 12 pcs. */
export function formatQty(qty: number, unit: StockUnit): string {
  const value = Number.isInteger(qty) ? String(qty) : String(r3(qty));
  return `${value} ${unit}`;
}

/** Ingredient cost of one portion of a dish (optionally a specific portion and add-ons), from material costs. */
export function recipeCost(item: MenuItem, materials: Material[], variantId?: string, addonIds: string[] = []): number {
  const cost = new Map(materials.map((m) => [m.id, m.costPerUnit ?? 0]));
  const parts = [
    ...(item.recipe ?? []),
    ...(item.variants?.find((v) => v.id === variantId)?.recipe ?? []),
    ...(item.addons ?? []).filter((a) => addonIds.includes(a.id)).flatMap((a) => a.recipe ?? []),
  ];
  return Math.round(parts.reduce((sum, p) => sum + p.qty * (cost.get(p.materialId) ?? 0), 0) * 100) / 100;
}

/** Food cost as a share of the selling price (0.28 = 28%). */
export function foodCostShare(cost: number, price: number): number {
  return price > 0 ? Math.round((cost / price) * 1000) / 1000 : 0;
}
