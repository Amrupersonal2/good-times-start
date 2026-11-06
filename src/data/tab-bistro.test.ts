import { describe, expect, it } from "vitest";
import { TAB_CATEGORIES, TAB_MATERIALS, TAB_MENU } from "./tab-bistro";
import { foodCostShare, recipeCost } from "@/lib/stock-logic";
import { buildLine } from "@/lib/menu-logic";
import { consumptionFor } from "@/lib/stock-logic";

const byName = (name: string) => TAB_MENU.find((m) => m.name === name)!;

describe("TAB Bistro menu", () => {
  it("has every dish from the printed menu", () => {
    expect(TAB_MENU).toHaveLength(131);
    expect(TAB_CATEGORIES).toHaveLength(23);
    expect(new Set(TAB_MENU.map((m) => m.id)).size).toBe(TAB_MENU.length);
  });

  it("keeps printed prices, portions and add-ons", () => {
    expect(byName("Tandoori Chicken").variants?.map((v) => [v.name, v.price])).toEqual([["Half", 399], ["Full", 789]]);
    expect(byName("Drums of Heaven").variants?.map((v) => v.price)).toEqual([369, 739]);
    expect(byName("Burned Garlic Hakka Noodles").variants?.map((v) => [v.name, v.price, v.veg])).toEqual([["Veg", 259, true], ["Chicken", 299, false], ["Seafood", 349, false]]);
    expect(byName("XTSY Chicken Mandi Biryani").variants?.map((v) => v.price)).toEqual([639, 1229]);
    expect(byName("Naan").addons?.map((a) => [a.name, a.price])).toEqual([["Extra butter", 20], ["Extra cheese", 25]]);
    expect(byName("Masala Omelette")).toMatchObject({ veg: false, hours: { from: "08:45", to: "10:45" }, price: 139 });
    expect(byName("Drinking Water").variants?.map((v) => v.price)).toEqual([12, 24]);
  });

  it("uses only known ingredients, in positive amounts", () => {
    const known = new Set(TAB_MATERIALS.map((m) => m.id));
    for (const item of TAB_MENU) {
      const parts = [...(item.recipe ?? []), ...(item.variants ?? []).flatMap((v) => v.recipe ?? []), ...(item.addons ?? []).flatMap((a) => a.recipe ?? [])];
      for (const p of parts) {
        expect(known.has(p.materialId), `${item.name}: ${p.materialId}`).toBe(true);
        expect(p.qty, `${item.name}: ${p.materialId}`).toBeGreaterThan(0);
      }
      const hasRecipe = (item.recipe?.length ?? 0) > 0 || (item.variants ?? []).every((v) => (v.recipe?.length ?? 0) > 0);
      expect(hasRecipe, `${item.name} has a recipe`).toBe(true);
    }
  });

  it("keeps food cost in a realistic range for every portion", () => {
    for (const item of TAB_MENU) {
      for (const v of item.variants?.length ? item.variants : [undefined]) {
        const share = foodCostShare(recipeCost(item, TAB_MATERIALS, v?.id), v?.price ?? item.price);
        expect(share, `${item.name} ${v?.name ?? ""}`).toBeGreaterThan(0.03);
        expect(share, `${item.name} ${v?.name ?? ""}`).toBeLessThan(0.6);
      }
    }
  });

  it("deducts the right ingredients for a portion with add-ons", () => {
    const noodles = byName("Burned Garlic Hakka Noodles");
    const line = { ...buildLine(noodles, "dine-in", noodles.variants![1]!.id, [noodles.addons![0]!.id]), qty: 2 };
    const used = new Map(consumptionFor([line], TAB_MENU).map((u) => [u.materialId, u.qty]));
    expect(used.get("tab-m-chicken-boneless")).toBe(0.16);
    expect(used.get("tab-m-eggs")).toBe(2);
    expect(used.get("tab-m-noodles")).toBe(0.2);
    expect(used.has("tab-m-seafood-mix")).toBe(false);
  });
});
