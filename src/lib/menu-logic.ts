import type { CartLine, GstRate, InventoryItem, MenuItem, MenuOption, OrderType } from "./types";

export const GST_RATES: GstRate[] = [0, 5, 12, 18, 28];
export const DEFAULT_STATIONS = ["Main Course", "Tandoor", "Chinese", "South Indian", "Beverages", "Desserts"];
export const PRICED_ORDER_TYPES: { v: OrderType; l: string }[] = [
  { v: "takeaway", l: "Takeaway" },
  { v: "delivery", l: "Delivery" },
  { v: "swiggy", l: "Swiggy" },
  { v: "zomato", l: "Zomato" },
];

/** Price for an order type: an override if set, otherwise the base price. */
export function priceFor(item: MenuItem, orderType: OrderType): number {
  const override = item.prices?.[orderType];
  return typeof override === "number" && override >= 0 ? override : item.price;
}

/** True when adding this dish needs a choice (portion) or offers extras (add-ons). */
export function needsOptions(item: MenuItem): boolean {
  return (item.variants?.length ?? 0) > 0 || (item.addons?.length ?? 0) > 0;
}

/**
 * Build the bill line for a dish with an optional portion and add-ons. Each
 * distinct combination is its own line, so "Paneer Tikka (Half)" and
 * "Paneer Tikka (Full)" count and print separately.
 */
export function buildLine(item: MenuItem, orderType: OrderType, variantId?: string, addonIds: string[] = []): CartLine {
  const variant = item.variants?.find((v) => v.id === variantId);
  const chosen = (item.addons ?? []).filter((a) => addonIds.includes(a.id));
  const base = variant ? variant.price : priceFor(item, orderType);
  const price = base + chosen.reduce((sum, a) => sum + a.price, 0);
  const plain = !variant && chosen.length === 0;
  const keyParts = [item.id, variant ? `v:${variant.id}` : "", ...chosen.map((a) => `a:${a.id}`).sort()].filter(Boolean);
  const name = [
    variant ? `${item.name} (${variant.name})` : item.name,
    ...chosen.map((a) => `+ ${a.name}`),
  ].join(" ");
  return {
    itemId: plain ? item.id : keyParts.join("|"),
    ...(plain ? {} : { menuItemId: item.id }),
    ...(variant ? { variant: variant.name } : {}),
    ...(chosen.length ? { addons: chosen.map((a) => ({ name: a.name, price: a.price })) } : {}),
    name,
    price,
    qty: 1,
    veg: item.veg,
    gstRate: item.gstRate,
    station: item.station,
  };
}

/** The menu item a bill line draws stock from. */
export function stockItemId(line: Pick<CartLine, "itemId" | "menuItemId">): string {
  return line.menuItemId ?? line.itemId;
}

/** Portions of stock left for a dish, or null when it isn't tracked. */
export function stockLeft(itemId: string, inventory: InventoryItem[]): number | null {
  const stock = inventory.find((i) => i.menuItemId === itemId && i.tracked);
  return stock ? stock.quantity : null;
}

export interface MenuDraft {
  name: string;
  category: string;
  station: string;
  price: string;
  gstRate: GstRate;
  veg: boolean;
  popular: boolean;
  available: boolean;
  variants: { id: string; name: string; price: string }[];
  addons: { id: string; name: string; price: string }[];
  prices: Partial<Record<OrderType, string>>;
  recipe: { materialId: string; qty: string }[];
}

export function draftFromItem(item?: MenuItem): MenuDraft {
  return {
    name: item?.name ?? "",
    category: item?.category ?? "",
    station: item?.station ?? DEFAULT_STATIONS[0]!,
    price: item ? String(item.price) : "",
    gstRate: item?.gstRate ?? 5,
    veg: item?.veg ?? true,
    popular: item?.popular ?? false,
    available: item?.available ?? true,
    variants: (item?.variants ?? []).map((v) => ({ id: v.id, name: v.name, price: String(v.price) })),
    addons: (item?.addons ?? []).map((a) => ({ id: a.id, name: a.name, price: String(a.price) })),
    prices: Object.fromEntries(Object.entries(item?.prices ?? {}).map(([k, v]) => [k, String(v)])) as Partial<Record<OrderType, string>>,
    recipe: (item?.recipe ?? []).map((r) => ({ materialId: r.materialId, qty: String(r.qty) })),
  };
}

const money = (raw: string) => {
  const value = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
};

/** Validate a draft; returns the item to save or a list of problems in plain language. */
export function itemFromDraft(id: string, draft: MenuDraft): { item: MenuItem } | { errors: string[] } {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Enter the dish name.");
  if (!draft.category.trim()) errors.push("Choose or type a category.");
  if (!draft.station.trim()) errors.push("Choose the kitchen station that makes this dish.");

  const variants: MenuOption[] = [];
  for (const v of draft.variants) {
    if (!v.name.trim() && !v.price.trim()) continue;
    const price = money(v.price);
    if (!v.name.trim() || price === null) { errors.push("Each portion needs a name and a price."); break; }
    variants.push({ id: v.id, name: v.name.trim(), price });
  }
  const addons: MenuOption[] = [];
  for (const a of draft.addons) {
    if (!a.name.trim() && !a.price.trim()) continue;
    const price = money(a.price);
    if (!a.name.trim() || price === null) { errors.push("Each add-on needs a name and a price (0 is fine)."); break; }
    addons.push({ id: a.id, name: a.name.trim(), price });
  }

  const base = variants.length ? variants[0]!.price : money(draft.price);
  if (base === null) errors.push("Enter a price.");

  const prices: Partial<Record<OrderType, number>> = {};
  for (const { v, l } of PRICED_ORDER_TYPES) {
    const raw = draft.prices[v] ?? "";
    if (!raw.trim()) continue;
    const price = money(raw);
    if (price === null) errors.push(`${l} price must be a number.`);
    else prices[v] = price;
  }

  const recipe: { materialId: string; qty: number }[] = [];
  for (const r of draft.recipe) {
    if (!r.materialId && !r.qty.trim()) continue;
    const qty = Number(r.qty.trim());
    if (!r.materialId || !r.qty.trim() || !Number.isFinite(qty) || qty <= 0) { errors.push("Each recipe line needs a material and an amount above 0."); break; }
    const existing = recipe.find((x) => x.materialId === r.materialId);
    if (existing) existing.qty = Math.round((existing.qty + qty) * 1000) / 1000;
    else recipe.push({ materialId: r.materialId, qty });
  }

  if (errors.length || base === null) return { errors };
  const item: MenuItem = {
    id,
    name: draft.name.trim(),
    category: draft.category.trim(),
    station: draft.station.trim(),
    price: base,
    gstRate: draft.gstRate,
    veg: draft.veg,
    popular: draft.popular,
    available: draft.available,
    ...(variants.length ? { variants } : {}),
    ...(addons.length ? { addons } : {}),
    ...(Object.keys(prices).length && !variants.length ? { prices } : {}),
    ...(recipe.length ? { recipe } : {}),
  };
  return { item };
}
