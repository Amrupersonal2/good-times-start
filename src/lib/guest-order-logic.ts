/** Guest ordering (QR at the table, online pickup): shapes and pure helpers shared by the guest page and the POS. */
import type { CartLine, MenuItem, Order, OrderType } from "./types";
import { buildLine } from "./menu-logic";
import { computeTotals } from "./billing";
import { mergeSentLines } from "./sync-core";
import { accumulateSubmittedQuantities } from "./kitchen-order";

export type GuestChannel = "table" | "online";
export type GuestStatus = "new" | "accepted" | "ready" | "completed" | "rejected" | "cancelled";

/** One dish as the guest chose it; price and name are set by the database from the menu. */
export interface GuestLine {
  itemId: string;
  variantId?: string;
  addonIds?: string[];
  qty: number;
  note?: string;
  name: string;
  price: number;
  veg?: boolean;
}

/** A guest_orders row as the POS reads it. */
export interface GuestOrder {
  id: string;
  restaurant_id: string;
  code: string;
  channel: GuestChannel;
  table_id: string | null;
  table_label: string | null;
  customer_name: string;
  customer_phone: string;
  note: string;
  pickup_at: string | null;
  lines: GuestLine[];
  subtotal: number;
  payment: "counter" | "upi";
  upi_ref: string;
  status: GuestStatus;
  reason: string;
  order_uid: string | null;
  bill_no: string | null;
  handled_by: string;
  created_at: string;
  updated_at: string;
}

/** A dish on the public menu (recipes and costs removed by the database). */
export interface StorefrontItem extends Omit<MenuItem, "prices" | "recipe" | "stockTracked"> {
  takeawayPrice?: number | null;
}

export interface Storefront {
  id: string;
  slug: string;
  name: string;
  address: string;
  phone: string;
  fssai: string;
  upiVpa: string;
  gstMode: "regular" | "composition" | "unregistered";
  pricesIncludeGst: boolean;
  categoryOrder: string[];
  qr: boolean;
  online: boolean;
  paused: boolean;
  prepMinutes: number;
  minOrder: number;
  message: string;
  live: boolean;
  menu: StorefrontItem[];
  tables: { id: string; label: string; section: string }[];
}

export const GUEST_STATUS_LABEL: Record<GuestStatus, string> = {
  new: "Sent to the restaurant",
  accepted: "Accepted, being prepared",
  ready: "Ready",
  completed: "Done",
  rejected: "Not accepted",
  cancelled: "Cancelled",
};

export function orderTypeFor(channel: GuestChannel): OrderType {
  return channel === "table" ? "dine-in" : "takeaway";
}

/** Turn a public dish back into a menu item so the POS's own pricing and option screens work on it. */
export function asMenuItem(item: StorefrontItem): MenuItem {
  const { takeawayPrice, ...rest } = item;
  return {
    ...rest,
    gstRate: rest.gstRate ?? 5,
    station: rest.station ?? "Kitchen",
    available: rest.available ?? true,
    ...(typeof takeawayPrice === "number" ? { prices: { takeaway: takeawayPrice } } : {}),
  };
}

/** The guest's cart, keyed like bill lines so the same dish with the same options adds up. */
export interface GuestCartLine extends GuestLine { key: string }

export function guestLineFor(item: MenuItem, channel: GuestChannel, variantId?: string, addonIds: string[] = []): GuestCartLine {
  const line = buildLine(item, orderTypeFor(channel), variantId, addonIds);
  return {
    key: line.itemId,
    itemId: item.id,
    ...(variantId ? { variantId } : {}),
    ...(addonIds.length ? { addonIds: [...addonIds].sort() } : {}),
    qty: 1,
    name: line.name,
    price: line.price,
    veg: line.veg,
  };
}

export function addToGuestCart(cart: GuestCartLine[], line: GuestCartLine): GuestCartLine[] {
  const found = cart.find((l) => l.key === line.key);
  if (found) return cart.map((l) => (l.key === line.key ? { ...l, qty: Math.min(30, l.qty + line.qty) } : l));
  return [...cart, line];
}

export function setGuestQty(cart: GuestCartLine[], key: string, qty: number): GuestCartLine[] {
  return qty <= 0 ? cart.filter((l) => l.key !== key) : cart.map((l) => (l.key === key ? { ...l, qty: Math.min(30, qty) } : l));
}

export function guestSubtotal(lines: { price: number; qty: number }[]): number {
  return lines.reduce((sum, l) => sum + l.price * l.qty, 0);
}

/** What the guest sends: ids and quantities only. The database prices it. */
export function guestOrderPayload(cart: GuestCartLine[]) {
  return cart.map((l) => ({ itemId: l.itemId, variantId: l.variantId ?? null, addonIds: l.addonIds ?? [], qty: l.qty, note: l.note ?? "" }));
}

/**
 * Bill lines for an accepted guest order, priced from this device's menu (the
 * restaurant's source of truth). A dish no longer on the menu keeps the
 * guest's line so nothing they ordered is lost; it is reported back.
 */
export function cartLinesFromGuest(lines: GuestLine[], menu: MenuItem[], channel: GuestChannel): { lines: CartLine[]; missing: string[] } {
  const byId = new Map(menu.map((m) => [m.id, m]));
  const out: CartLine[] = [];
  const missing: string[] = [];
  const fallbackStation = menu[0]?.station ?? "Kitchen";
  for (const g of lines) {
    const item = byId.get(g.itemId);
    const variantOk = !item?.variants?.length || item.variants.some((v) => v.id === g.variantId);
    let line: CartLine;
    if (item && variantOk) {
      line = { ...buildLine(item, orderTypeFor(channel), g.variantId, g.addonIds ?? []), qty: g.qty };
    } else {
      missing.push(g.name);
      line = { itemId: `guest:${g.itemId}:${g.variantId ?? ""}:${(g.addonIds ?? []).join(",")}`, menuItemId: g.itemId, name: g.name, price: g.price, qty: g.qty, veg: g.veg ?? false, gstRate: 5, station: fallbackStation };
    }
    if (g.note) line.note = g.note;
    // One line per dish and options, as at the counter; notes for the same dish are joined.
    const same = out.find((l) => l.itemId === line.itemId);
    if (same) {
      same.qty += line.qty;
      if (line.note && line.note !== same.note) same.note = same.note ? `${same.note}; ${line.note}` : line.note;
    } else out.push(line);
  }
  return { lines: out, missing };
}

export function orderPageUrl(origin: string, slug: string, tableId?: string): string {
  const base = `${origin.replace(/\/$/, "")}/order/${encodeURIComponent(slug)}`;
  return tableId ? `${base}?table=${encodeURIComponent(tableId)}` : base;
}

/** Pickup times offered to the guest, from the kitchen's usual preparation time. */
export function pickupChoices(now: Date, prepMinutes: number): { label: string; at: string | null }[] {
  const choices: { label: string; at: string | null }[] = [{ label: `As soon as possible (about ${prepMinutes} min)`, at: null }];
  const first = new Date(now.getTime() + Math.max(prepMinutes, 15) * 60_000);
  first.setMinutes(Math.ceil(first.getMinutes() / 15) * 15, 0, 0);
  for (let i = 0; i < 8; i += 1) {
    const at = new Date(first.getTime() + i * 15 * 60_000);
    choices.push({ label: at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), at: at.toISOString() });
  }
  return choices;
}

/** Guest orders newest first, with waiting ones on top. */
export function sortGuestOrders(orders: GuestOrder[]): GuestOrder[] {
  const rank: Record<GuestStatus, number> = { new: 0, accepted: 1, ready: 2, completed: 3, rejected: 4, cancelled: 5 };
  return [...orders].sort((a, b) => rank[a.status] - rank[b.status] || b.created_at.localeCompare(a.created_at));
}

/**
 * The running bill after an accepted guest order: added to the table's open
 * bill when there is one, otherwise a new bill. Every guest line goes to the
 * kitchen at once, so it counts as sent.
 */
export function billWithGuestLines(
  base: Order | null,
  added: CartLine[],
  fresh: Omit<Order, "lines" | "subtotal" | "discountAmt" | "cgst" | "sgst" | "roundOff" | "total" | "taxable" | "serviceCharge" | "kotSubmittedQty">,
  code: string,
): Order {
  const lines = base ? mergeSentLines(base.lines, added) : added.map((l) => ({ ...l }));
  const order: Order = base ? { ...base } : { ...fresh, lines: [], subtotal: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 0 };
  const t = computeTotals(lines, order.discountPct, order.serviceChargePct ?? 0, order.tax ?? {});
  return {
    ...order,
    lines,
    subtotal: t.subtotal, discountAmt: t.discountAmt, serviceCharge: t.serviceCharge, taxable: t.taxable,
    cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total,
    kotSubmittedQty: accumulateSubmittedQuantities(base?.kotSubmittedQty ?? {}, added),
    guestCodes: [...(base?.guestCodes ?? []), code],
    status: "held",
    synced: false,
  };
}
