import { describe, expect, it } from "vitest";
import { TAB_MATERIALS, TAB_MENU } from "@/data/tab-bistro";
import { menuWorkbook, parseMenuWorkbook } from "./menu-excel";
import { buildXlsx, readXlsx } from "./xlsx";
import type { MenuItem } from "./types";

const roundTrip = async (menu: MenuItem[]) => readXlsx(buildXlsx(menuWorkbook(menu, TAB_MATERIALS, "TAB Bistro")));
const strip = (m: MenuItem) => ({ ...m, popular: Boolean(m.popular) });

describe("Excel menu", () => {
  it("re-imports its own export without changing anything", async () => {
    const result = parseMenuWorkbook(await roundTrip(TAB_MENU), TAB_MENU, TAB_MATERIALS);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.stats).toMatchObject({ newDishes: 0, updatedDishes: 131, newIngredients: 0 });
    const back = new Map(result.items.map((i) => [i.id, i]));
    for (const item of TAB_MENU) expect(strip(back.get(item.id)!), item.name).toEqual(strip(item));
  });

  it("builds a whole menu, ingredients and recipes from an empty restaurant", async () => {
    const result = parseMenuWorkbook(await roundTrip(TAB_MENU), [], []);
    expect(result.errors).toEqual([]);
    expect(result.stats).toMatchObject({ newDishes: 131, updatedDishes: 0, newIngredients: TAB_MATERIALS.length });
    const naan = result.items.find((i) => i.name === "Naan")!;
    expect(naan.variants?.map((v) => [v.name, v.price])).toEqual([["Plain", 59], ["Butter", 69]]);
    const butter = result.materials.find((m) => m.name === "Butter")!;
    expect(naan.variants?.[1]?.recipe).toEqual([{ materialId: butter.id, qty: 0.008 }]);
    const noodles = result.items.find((i) => i.name === "Burned Garlic Hakka Noodles")!;
    expect(noodles.variants?.map((v) => v.veg)).toEqual([true, false, false]);
  });

  it("explains rows it can't read", () => {
    const sheet = { name: "Menu", rows: [
      ["Dish", "Category", "Price", "Portions"],
      ["Masala Dosa", "South Indian", "₹ 120", ""],
      ["Thali", "", 250, ""],
      ["Biryani", "Rice", null, "Half 200"],
      ["Lassi", "Drinks", null, ""],
    ] };
    const r = parseMenuWorkbook([sheet], [], []);
    expect(r.items.map((i) => [i.name, i.price])).toEqual([["Masala Dosa", 120]]);
    expect(r.errors).toEqual([
      "Menu row 3 (Thali): add a category.",
      'Menu row 4 (Biryani): couldn\'t read "Half 200". Write it as Name=Price, e.g. Half=399.',
      "Menu row 5 (Lassi): add a price.",
    ]);
  });

  it("updates prices on matching dishes by name and keeps their ids", () => {
    const sheet = { name: "Menu", rows: [["Dish", "Price", "Portions"], ["naan", null, "Plain=65; Butter=75"]] };
    const r = parseMenuWorkbook([sheet], TAB_MENU, TAB_MATERIALS);
    const naan = TAB_MENU.find((i) => i.name === "Naan")!;
    expect(r.items[0]).toMatchObject({ id: naan.id, name: "naan", price: 65, category: naan.category });
    expect(r.items[0]?.variants?.map((v) => v.id)).toEqual(naan.variants?.map((v) => v.id));
    expect(r.items[0]?.variants?.[1]?.recipe).toEqual(naan.variants?.[1]?.recipe);
  });
});
