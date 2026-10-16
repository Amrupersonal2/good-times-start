import { describe, expect, it } from "vitest";
import { consumptionFor, countAdjustment, formatQty, purchaseTotal, saleItems, stockLevels, stockValue } from "./stock-logic";
import type { CartLine, MenuItem, StockEntry } from "./types";

const menu: MenuItem[] = [
  { id: "tikka", name: "Paneer Tikka", category: "Starters", price: 280, veg: true, gstRate: 5, station: "Tandoor", available: true,
    recipe: [{ materialId: "paneer", qty: 0.2 }, { materialId: "curd", qty: 0.05 }] },
  { id: "naan", name: "Naan", category: "Breads", price: 60, veg: true, gstRate: 5, station: "Tandoor", available: true,
    recipe: [{ materialId: "flour", qty: 0.1 }] },
];
const line = (itemId: string, qty: number, menuItemId?: string): CartLine =>
  ({ itemId, name: itemId, price: 1, qty, veg: true, gstRate: 5, station: "x", ...(menuItemId ? { menuItemId } : {}) });

describe("stock ledger", () => {
  it("adds up purchases, sales, wastage and counts", () => {
    const entries: StockEntry[] = [
      { id: "1", type: "purchase", at: 1, items: [{ materialId: "paneer", qty: 5, unitCost: 300 }] },
      { id: "2", type: "sale", at: 2, items: [{ materialId: "paneer", qty: -0.4 }] },
      { id: "3", type: "wastage", at: 3, items: [{ materialId: "paneer", qty: -0.1 }] },
    ];
    expect(stockLevels(entries).get("paneer")).toBe(4.5);
    expect(countAdjustment(4.5, 4.2)).toBe(-0.3);
  });

  it("works out what a bill uses from recipes, including portions", () => {
    const used = consumptionFor([line("tikka", 2), line("tikka|v:f", 1, "tikka"), line("naan", 3), line("lassi", 1)], menu);
    expect(used).toEqual([{ materialId: "paneer", qty: 0.6 }, { materialId: "curd", qty: 0.15 }, { materialId: "flour", qty: 0.3 }]);
    expect(saleItems([line("naan", 2)], menu)).toEqual([{ materialId: "flour", qty: -0.2 }]);
    expect(saleItems([line("naan", 2)], menu, 1)).toEqual([{ materialId: "flour", qty: 0.2 }]);
  });

  it("values stock and purchases", () => {
    const levels = new Map([["paneer", 2], ["flour", -1]]);
    const materials = [
      { id: "paneer", name: "Paneer", unit: "kg" as const, lowStockLevel: 1, costPerUnit: 300 },
      { id: "flour", name: "Flour", unit: "kg" as const, lowStockLevel: 5, costPerUnit: 40 },
    ];
    expect(stockValue(materials, levels)).toBe(600);
    expect(purchaseTotal([{ materialId: "a", qty: 2, unitCost: 45.5 }, { materialId: "b", qty: 1 }])).toBe(91);
    expect(formatQty(0.30000000000000004, "kg")).toBe("0.3 kg");
  });
});
