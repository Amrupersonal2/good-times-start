import { describe, expect, it } from "vitest";
import { orderCategories, buildLine, draftFromItem, itemFromDraft, needsOptions, outsideHours, parseLineId, priceFor, stockItemId, stockLeft } from "./menu-logic";
import type { MenuItem } from "./types";

const tikka: MenuItem = {
  id: "i1", name: "Paneer Tikka", category: "Starters", price: 180, veg: true, gstRate: 5, station: "Tandoor", available: true,
  variants: [{ id: "h", name: "Half", price: 180 }, { id: "f", name: "Full", price: 320 }],
  addons: [{ id: "c", name: "Extra cheese", price: 40 }, { id: "m", name: "Mint dip", price: 0 }],
};
const lassi: MenuItem = {
  id: "i2", name: "Sweet Lassi", category: "Beverages", price: 90, veg: true, gstRate: 5, station: "Beverages", available: true,
  prices: { swiggy: 110 },
};

describe("menu logic", () => {
  it("uses order-type price overrides", () => {
    expect(priceFor(lassi, "dine-in")).toBe(90);
    expect(priceFor(lassi, "swiggy")).toBe(110);
    expect(buildLine(lassi, "swiggy").price).toBe(110);
  });

  it("keeps plain dishes on the menu item id", () => {
    const line = buildLine(lassi, "dine-in");
    expect(line.itemId).toBe("i2");
    expect(line.menuItemId).toBeUndefined();
    expect(needsOptions(lassi)).toBe(false);
  });

  it("makes a separate line per portion and add-on combination", () => {
    const half = buildLine(tikka, "dine-in", "h");
    const full = buildLine(tikka, "dine-in", "f", ["m", "c"]);
    expect(half).toMatchObject({ itemId: "i1|v:h", menuItemId: "i1", name: "Paneer Tikka (Half)", price: 180 });
    expect(full).toMatchObject({ itemId: "i1|v:f|a:c|a:m", name: "Paneer Tikka (Full) + Extra cheese + Mint dip", price: 360 });
    expect(buildLine(tikka, "dine-in", "f", ["c", "m"]).itemId).toBe(full.itemId);
    expect(stockItemId(full)).toBe("i1");
    expect(needsOptions(tikka)).toBe(true);
  });

  it("reports stock only for tracked dishes", () => {
    const inventory = [{ id: "i1", menuItemId: "i1", name: "x", unit: "portions", quantity: 3, lowStockThreshold: 5, tracked: true, synced: true }];
    expect(stockLeft("i1", inventory)).toBe(3);
    expect(stockLeft("i2", inventory)).toBeNull();
  });

  it("round-trips a dish through the editor draft", () => {
    const result = itemFromDraft("i1", draftFromItem(tikka));
    expect(result).toEqual({ item: { ...tikka, popular: false } });
  });

  it("explains what's missing in a draft", () => {
    const draft = { ...draftFromItem(), name: " ", price: "abc" };
    const result = itemFromDraft("new", draft);
    expect("errors" in result && result.errors).toEqual(["Enter the dish name.", "Choose or type a category.", "Enter a price."]);
  });

  it("keeps recipes and merges repeated materials", () => {
    const draft = { ...draftFromItem(tikka), recipe: [{ materialId: "paneer", qty: "0.15" }, { materialId: "paneer", qty: "0.05" }, { materialId: "", qty: "" }] };
    const result = itemFromDraft("i1", draft);
    expect("item" in result && result.item.recipe).toEqual([{ materialId: "paneer", qty: 0.2 }]);
    const bad = itemFromDraft("i1", { ...draft, recipe: [{ materialId: "paneer", qty: "0" }] });
    expect("errors" in bad).toBe(true);
  });

  it("takes the first portion's price as the base price", () => {
    const draft = { ...draftFromItem(), name: "Biryani", category: "Rice", price: "", variants: [{ id: "a", name: "Half", price: "200" }, { id: "b", name: "Full", price: "350" }] };
    const result = itemFromDraft("x", draft);
    expect("item" in result && result.item.price).toBe(200);
  });

  it("reads ids back out of a bill line and knows serving hours", () => {
    expect(parseLineId("i1|v:f|a:c|a:m")).toEqual({ menuItemId: "i1", variantId: "f", addonIds: ["c", "m"] });
    expect(parseLineId("i2")).toEqual({ menuItemId: "i2", addonIds: [] });
    const breakfast = { hours: { from: "08:45", to: "10:45" } };
    expect(outsideHours(breakfast, new Date(2026, 9, 16, 9, 30))).toBe(false);
    expect(outsideHours(breakfast, new Date(2026, 9, 16, 13, 0))).toBe(true);
    expect(outsideHours({}, new Date())).toBe(false);
  });

  it("uses a portion's own veg mark", () => {
    const pasta: MenuItem = { ...lassi, id: "p", veg: true, variants: [{ id: "c", name: "Chicken", price: 349, veg: false }] };
    expect(buildLine(pasta, "dine-in", "c").veg).toBe(false);
  });

  it("keeps portion recipes, veg marks, hours and descriptions when a dish is edited", () => {
    const full: MenuItem = {
      ...tikka, popular: false, description: "Comes with mint dip", hours: { from: "08:45", to: "10:45" },
      variants: [{ id: "h", name: "Half", price: 180, veg: true, recipe: [{ materialId: "paneer", qty: 0.1 }] }, { id: "f", name: "Full", price: 320 }],
      addons: [{ id: "c", name: "Extra cheese", price: 40, recipe: [{ materialId: "cheese", qty: 0.02 }] }],
    };
    expect(itemFromDraft("i1", draftFromItem(full))).toEqual({ item: full });
  });
  it("orders menu sections like the printed menu", () => {
    expect(orderCategories(["Desserts", "Zebra", "Tea", "Apple"], ["Tea", "Desserts"], ["Apple"])).toEqual(["Tea", "Desserts", "Apple", "Zebra"]);
  });
});
