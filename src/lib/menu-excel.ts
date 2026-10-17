import type { GstRate, Material, MenuItem, MenuOption, OrderType, StockUnit } from "./types";
import type { ReadSheet, ReadValue, SheetSpec } from "./xlsx";
import { foodCostShare, recipeCost } from "./stock-logic";

/**
 * The Excel menu format: one workbook that exports and imports the same way.
 *
 * Menu sheet       one row per dish. Portions and add-ons are written
 *                  "Half=399; Full=789". A portion can carry its own mark:
 *                  "Veg=259 (veg); Chicken=299 (non-veg)".
 * Recipes sheet    one row per ingredient: Dish, Applies to (blank for every
 *                  portion, or "Portion: Full" / "Add-on: Extra cheese"),
 *                  Ingredient, Qty per portion.
 * Ingredients      Ingredient, Unit, Cost per unit, Warn at.
 */

const UNITS: StockUnit[] = ["kg", "g", "l", "ml", "pcs", "dozen", "packet"];
const PRICE_TYPES: { v: OrderType; header: string }[] = [
  { v: "takeaway", header: "Takeaway price" },
  { v: "delivery", header: "Delivery price" },
  { v: "swiggy", header: "Swiggy price" },
  { v: "zomato", header: "Zomato price" },
];
const GST: GstRate[] = [0, 5, 12, 18, 28];

export function slugId(text: string): string {
  return text.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}

const yesNo = (v: boolean | undefined) => (v ? "Yes" : "No");
const optionText = (opts: MenuOption[] | undefined, withMark: boolean) =>
  (opts ?? []).map((o) => `${o.name}=${o.price}${withMark && o.veg !== undefined ? ` (${o.veg ? "veg" : "non-veg"})` : ""}`).join("; ");

/* ---------------- export ---------------- */

export function menuWorkbook(menu: MenuItem[], materials: Material[], restaurant = "Menu"): SheetSpec[] {
  const sorted = [...menu].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  const matName = new Map(materials.map((m) => [m.id, m]));

  const menuSheet: SheetSpec = {
    name: "Menu",
    title: `${restaurant} — Menu`,
    subtitle: "Edit prices or add dishes here, then upload this file in Menu → Import from Excel. Portions and add-ons: Name=Price; Name=Price",
    columns: [
      { header: "Dish ID" }, { header: "Dish", width: 34 }, { header: "Category", width: 24 }, { header: "Veg" },
      { header: "Price", format: "inr" }, { header: "Portions", width: 40 }, { header: "Add-ons", width: 46 },
      { header: "Kitchen station" }, { header: "GST %", format: "int" }, { header: "Available" }, { header: "Popular" },
      ...PRICE_TYPES.map((p) => ({ header: p.header, format: "inr" as const })),
      { header: "Serves from" }, { header: "Serves until" }, { header: "Description", width: 50 },
    ],
    rows: sorted.map((m) => [
      m.id, m.name, m.category, yesNo(m.veg), m.price, optionText(m.variants, true), optionText(m.addons, false),
      m.station, m.gstRate, yesNo(m.available), yesNo(m.popular),
      ...PRICE_TYPES.map((p) => m.prices?.[p.v] ?? null),
      m.hours?.from ?? null, m.hours?.to ?? null, m.description ?? null,
    ]),
  };

  const recipeRows: (string | number | null)[][] = [];
  for (const m of sorted) {
    const push = (appliesTo: string, parts: { materialId: string; qty: number }[] | undefined) => {
      for (const p of parts ?? []) {
        const mat = matName.get(p.materialId);
        recipeRows.push([m.name, appliesTo, mat?.name ?? p.materialId, p.qty, mat?.unit ?? null]);
      }
    };
    push("", m.recipe);
    for (const v of m.variants ?? []) push(`Portion: ${v.name}`, v.recipe);
    for (const a of m.addons ?? []) push(`Add-on: ${a.name}`, a.recipe);
  }
  const recipeSheet: SheetSpec = {
    name: "Recipes",
    title: "Recipes, per portion",
    subtitle: "Leave 'Applies to' blank for what every portion uses. 'Portion: Full' or 'Add-on: Extra cheese' add to it.",
    columns: [{ header: "Dish", width: 34 }, { header: "Applies to", width: 26 }, { header: "Ingredient", width: 34 }, { header: "Qty per portion", format: "qty" }, { header: "Unit" }],
    rows: recipeRows,
  };

  const ingredientSheet: SheetSpec = {
    name: "Ingredients",
    title: "Ingredients",
    subtitle: `Units: ${UNITS.join(", ")}`,
    columns: [{ header: "Ingredient", width: 40 }, { header: "Unit" }, { header: "Cost per unit", format: "inr" }, { header: "Warn at", format: "qty" }],
    rows: [...materials].filter((m) => !m.archived).sort((a, b) => a.name.localeCompare(b.name)).map((m) => [m.name, m.unit, m.costPerUnit ?? null, m.lowStockLevel]),
  };

  const costRows: (string | number | null)[][] = [];
  for (const m of sorted) {
    for (const v of m.variants?.length ? m.variants : [undefined]) {
      const price = v?.price ?? m.price;
      const cost = recipeCost(m, materials, v?.id);
      costRows.push([m.name, v?.name ?? "", m.category, price, cost, price - cost, foodCostShare(cost, price)]);
    }
  }
  const costSheet: SheetSpec = {
    name: "Food cost",
    title: "Food cost per portion",
    subtitle: "Ingredient cost from the Ingredients sheet; selling price before GST.",
    columns: [{ header: "Dish", width: 34 }, { header: "Portion" }, { header: "Category", width: 24 }, { header: "Price", format: "inr" }, { header: "Ingredient cost", format: "inr" }, { header: "Gross margin", format: "inr" }, { header: "Food cost %", format: "pct" }],
    rows: costRows,
  };

  return [menuSheet, recipeSheet, ingredientSheet, costSheet];
}

/* ---------------- import ---------------- */

export interface MenuImport {
  items: MenuItem[];
  materials: Material[];
  /** Problems that stopped a row from importing. */
  errors: string[];
  /** Rows that imported with something left out or guessed. */
  warnings: string[];
  stats: { newDishes: number; updatedDishes: number; newIngredients: number; recipes: number };
}

const norm = (v: ReadValue | undefined) => (v === null || v === undefined ? "" : String(v).trim());
const key = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const num = (v: ReadValue | undefined): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = norm(v).replace(/[₹,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const truthy = (v: ReadValue | undefined, fallback: boolean) => {
  const s = key(norm(v));
  if (!s) return fallback;
  return ["yes", "y", "true", "1", "veg", "v"].includes(s) || v === true;
};
/** Excel stores times as day fractions; text like "8:45" also works. */
const timeText = (v: ReadValue | undefined): string | null => {
  if (typeof v === "number" && v >= 0 && v < 1) {
    const mins = Math.round(v * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = /^(\d{1,2})[:.](\d{2})/.exec(norm(v));
  return m ? `${m[1]!.padStart(2, "0")}:${m[2]}` : null;
};

/** Find the header row (the one naming `required`) and map column names to indexes. */
function table(sheet: ReadSheet | undefined, required: string): { header: Map<string, number>; rows: { row: ReadValue[]; line: number }[] } | null {
  if (!sheet) return null;
  const at = sheet.rows.findIndex((r) => r.some((c) => key(norm(c)) === key(required)));
  if (at < 0) return null;
  const header = new Map<string, number>();
  sheet.rows[at]!.forEach((c, i) => { const k = key(norm(c)); if (k && !header.has(k)) header.set(k, i); });
  const rows = sheet.rows.slice(at + 1).map((row, i) => ({ row, line: at + i + 2 })).filter(({ row }) => row.some((c) => norm(c) !== ""));
  return { header, rows };
}
const cell = (t: { header: Map<string, number> }, row: ReadValue[], name: string) => {
  const i = t.header.get(key(name));
  return i === undefined ? undefined : row[i];
};

function parseOptions(text: string, dishId: string, existing: MenuOption[] | undefined, where: string, errors: string[]): MenuOption[] | null {
  if (!text.trim()) return [];
  const out: MenuOption[] = [];
  for (const raw of text.split(/[;\n]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(.+?)\s*[=:]\s*₹?\s*([\d.]+)\s*(?:\((veg|non-veg|nonveg|non veg)\))?$/i.exec(part);
    if (!m) { errors.push(`${where}: couldn't read "${part}". Write it as Name=Price, e.g. Half=399.`); return null; }
    const name = m[1]!.trim();
    const prior = existing?.find((o) => key(o.name) === key(name));
    const mark = m[3]?.toLowerCase();
    out.push({
      id: prior?.id ?? `${dishId}--${slugId(name)}`,
      name,
      price: Number(m[2]),
      ...(mark ? { veg: mark === "veg" } : prior?.veg !== undefined ? { veg: prior.veg } : {}),
      ...(prior?.recipe ? { recipe: prior.recipe } : {}),
    });
  }
  return out;
}

export function parseMenuWorkbook(sheets: ReadSheet[], existingMenu: MenuItem[], existingMaterials: Material[]): MenuImport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const find = (name: string) => sheets.find((s) => key(s.name) === key(name));
  const menuTable = table(find("Menu") ?? sheets[0], "Dish");
  if (!menuTable) {
    return { items: [], materials: [], errors: ["No 'Dish' column found. Use the Menu sheet from the sample file."], warnings, stats: { newDishes: 0, updatedDishes: 0, newIngredients: 0, recipes: 0 } };
  }

  /* ingredients */
  const materials = new Map(existingMaterials.map((m) => [key(m.name), { ...m }]));
  const touchedMaterials = new Map<string, Material>();
  let newIngredients = 0;
  const ingTable = table(find("Ingredients"), "Ingredient");
  for (const { row, line } of ingTable?.rows ?? []) {
    const name = norm(cell(ingTable!, row, "Ingredient"));
    if (!name) continue;
    const unitRaw = key(norm(cell(ingTable!, row, "Unit")));
    const unit = (UNITS.find((u) => u === unitRaw) ?? null);
    const prior = materials.get(key(name));
    if (!unit && !prior) { errors.push(`Ingredients row ${line}: ${name} needs a unit (${UNITS.join(", ")}).`); continue; }
    const cost = num(cell(ingTable!, row, "Cost per unit"));
    const warn = num(cell(ingTable!, row, "Warn at"));
    const material: Material = {
      ...(prior ?? { id: `m-${slugId(name)}`, name, unit: unit ?? "kg", lowStockLevel: 0 }),
      name,
      unit: unit ?? prior!.unit,
      lowStockLevel: warn ?? prior?.lowStockLevel ?? 0,
      ...(cost !== null ? { costPerUnit: cost } : {}),
    };
    if (!prior) newIngredients += 1;
    materials.set(key(name), material);
    touchedMaterials.set(material.id, material);
  }

  /* dishes */
  const byId = new Map(existingMenu.map((m) => [m.id, m]));
  const byName = new Map(existingMenu.map((m) => [key(m.name), m]));
  const items = new Map<string, MenuItem>();
  let newDishes = 0;
  let updatedDishes = 0;
  for (const { row, line } of menuTable.rows) {
    const name = norm(cell(menuTable, row, "Dish"));
    if (!name) continue;
    const where = `Menu row ${line} (${name})`;
    const givenId = norm(cell(menuTable, row, "Dish ID"));
    const prior = (givenId && byId.get(givenId)) || byName.get(key(name));
    const id = prior?.id ?? (givenId || `dish-${slugId(name)}`);
    const category = norm(cell(menuTable, row, "Category")) || prior?.category || "";
    if (!category) { errors.push(`${where}: add a category.`); continue; }
    const variants = parseOptions(norm(cell(menuTable, row, "Portions")), id, prior?.variants, where, errors);
    const addons = parseOptions(norm(cell(menuTable, row, "Add-ons")), id, prior?.addons, where, errors);
    if (!variants || !addons) continue;
    const price = variants[0]?.price ?? num(cell(menuTable, row, "Price")) ?? prior?.price ?? null;
    if (price === null || price < 0) { errors.push(`${where}: add a price.`); continue; }
    const gstRaw = num(cell(menuTable, row, "GST %"));
    const gstRate = (GST.find((g) => g === gstRaw) ?? prior?.gstRate ?? 5) as GstRate;
    if (gstRaw !== null && !GST.includes(gstRaw as GstRate)) warnings.push(`${where}: GST ${gstRaw}% isn't a GST rate; used ${gstRate}%.`);
    const prices: Partial<Record<OrderType, number>> = {};
    for (const p of PRICE_TYPES) { const v = num(cell(menuTable, row, p.header)); if (v !== null) prices[p.v] = v; }
    const from = timeText(cell(menuTable, row, "Serves from"));
    const to = timeText(cell(menuTable, row, "Serves until"));
    const description = norm(cell(menuTable, row, "Description"));

    const item: MenuItem = {
      ...(prior ?? {}),
      id,
      name,
      category,
      price,
      veg: truthy(cell(menuTable, row, "Veg"), prior?.veg ?? true),
      gstRate,
      station: norm(cell(menuTable, row, "Kitchen station")) || prior?.station || "Kitchen",
      available: truthy(cell(menuTable, row, "Available"), prior?.available ?? true),
      popular: truthy(cell(menuTable, row, "Popular"), prior?.popular ?? false),
    };
    if (variants.length) item.variants = variants; else delete item.variants;
    if (addons.length) item.addons = addons; else delete item.addons;
    if (Object.keys(prices).length && !variants.length) item.prices = prices; else delete item.prices;
    if (from && to) item.hours = { from, to }; else delete item.hours;
    if (description) item.description = description; else delete item.description;
    if (prior) updatedDishes += 1; else newDishes += 1;
    items.set(id, item);
  }

  /* recipes */
  let recipes = 0;
  const recTable = table(find("Recipes"), "Ingredient");
  if (recTable) {
    const fresh = new Map<string, { base: Map<string, number>; options: Map<string, Map<string, number>> }>();
    for (const { row, line } of recTable.rows) {
      const dishName = norm(cell(recTable, row, "Dish"));
      const ingName = norm(cell(recTable, row, "Ingredient"));
      const qty = num(cell(recTable, row, "Qty per portion"));
      if (!dishName && !ingName) continue;
      const dish = [...items.values()].find((i) => key(i.name) === key(dishName)) ?? byName.get(key(dishName));
      if (!dish) { warnings.push(`Recipes row ${line}: no dish called "${dishName}".`); continue; }
      let material = materials.get(key(ingName));
      if (!material) {
        const unitRaw = key(norm(cell(recTable, row, "Unit")));
        const unit = UNITS.find((u) => u === unitRaw);
        if (!unit) { warnings.push(`Recipes row ${line}: add "${ingName}" to the Ingredients sheet (or give it a unit).`); continue; }
        material = { id: `m-${slugId(ingName)}`, name: ingName, unit, lowStockLevel: 0 };
        materials.set(key(ingName), material);
        touchedMaterials.set(material.id, material);
        newIngredients += 1;
      }
      if (qty === null || qty <= 0) { warnings.push(`Recipes row ${line}: ${dishName} / ${ingName} needs an amount above 0.`); continue; }
      const entry = fresh.get(dish.id) ?? { base: new Map(), options: new Map() };
      const applies = norm(cell(recTable, row, "Applies to"));
      const target = applies ? (entry.options.get(key(applies)) ?? new Map<string, number>()) : entry.base;
      target.set(material.id, Math.round(((target.get(material.id) ?? 0) + qty) * 10000) / 10000);
      if (applies) entry.options.set(key(applies), target);
      fresh.set(dish.id, entry);
      recipes += 1;
    }
    for (const [dishId, entry] of fresh) {
      const base = items.get(dishId) ?? byId.get(dishId);
      if (!base) continue;
      const toList = (m: Map<string, number>) => [...m].map(([materialId, qty]) => ({ materialId, qty }));
      const item: MenuItem = { ...base, recipe: toList(entry.base) };
      if (!item.recipe?.length) delete item.recipe;
      const withRecipe = (opts: MenuOption[] | undefined, label: string) => opts?.map((o) => {
        const r = entry.options.get(key(`${label}: ${o.name}`));
        const next: MenuOption = { ...o };
        if (r?.size) next.recipe = toList(r); else delete next.recipe;
        return next;
      });
      const variants = withRecipe(item.variants, "Portion");
      const addons = withRecipe(item.addons, "Add-on");
      if (variants) item.variants = variants;
      if (addons) item.addons = addons;
      for (const label of entry.options.keys()) {
        const [kind, ...rest] = label.split(":");
        const optName = rest.join(":").trim();
        const list = kind === "portion" ? item.variants : kind === "add-on" ? item.addons : undefined;
        if (!list?.some((o) => key(o.name) === optName)) warnings.push(`Recipes for ${item.name}: "${label}" doesn't match a portion or add-on.`);
      }
      items.set(dishId, item);
    }
  }

  return {
    items: [...items.values()],
    materials: [...touchedMaterials.values()],
    errors,
    warnings,
    stats: { newDishes, updatedDishes, newIngredients, recipes },
  };
}
