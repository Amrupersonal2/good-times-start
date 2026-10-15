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