import { describe, expect, it } from "vitest";
import { canFulfillOrder, deductInventory } from "./inventory";
import type { CartLine, InventoryItem } from "./types";

const orderLine: CartLine = { itemId: "dish-1", name: "Paneer Tikka", price: 280, qty: 2, veg: true, gstRate: 5, station: "Tandoor" };
const stock: InventoryItem = { id: "dish-1", menuItemId: "dish-1", name: "Paneer Tikka", unit: "portions", quantity: 3, lowStockThreshold: 2, tracked: true, synced: true };

describe("inventory rules", () => {
  it("blocks a sale when tracked stock is below the requested quantity", () => {
    expect(canFulfillOrder([orderLine], [{ ...stock, quantity: 1 }])).toBe(false);
  });
  it("deducts the exact sold quantity and marks the stock for cloud sync", () => {
    expect(deductInventory([orderLine], [stock])[0]).toMatchObject({ quantity: 1, synced: false });
  });
  it("does not restrict dishes whose stock tracking is disabled", () => {
    expect(canFulfillOrder([orderLine], [{ ...stock, quantity: 0, tracked: false }])).toBe(true);
  });
});
describe("inventory with portions", () => {
  it("deducts every portion of a dish from the same stock", () => {
    const stock = [{ id: "i1", menuItemId: "i1", name: "Tikka", unit: "portions", quantity: 5, lowStockThreshold: 1, tracked: true, synced: true }];
    const lines = [
      { itemId: "i1|v:h", menuItemId: "i1", name: "Tikka (Half)", price: 180, qty: 2, veg: true, gstRate: 5, station: "Tandoor" },
      { itemId: "i1|v:f", menuItemId: "i1", name: "Tikka (Full)", price: 320, qty: 1, veg: true, gstRate: 5, station: "Tandoor" },
    ];
    expect(deductInventory(lines, stock)[0]?.quantity).toBe(2);
    expect(canFulfillOrder([{ ...lines[0]!, qty: 6 }], stock)).toBe(false);
  });
});
