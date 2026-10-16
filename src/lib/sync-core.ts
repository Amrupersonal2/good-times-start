import type { CartLine, Customer, DayClose, InventoryItem, Kot, Material, MenuItem, Order, RestaurantSettings, RestaurantTable, StockEntry, Supplier } from "./types";

/** Kinds of records shared between a restaurant's devices (mirrors restaurant_records.kind). */
export type RecordKind = "settings" | "menu" | "table" | "order" | "kot" | "inventory" | "material" | "supplier" | "stock_entry" | "customer" | "day_close";

export const RECORD_KINDS: readonly RecordKind[] = ["settings", "menu", "table", "order", "kot", "inventory", "material", "supplier", "stock_entry", "customer", "day_close"];

/** The single settings record per restaurant. */
export const SETTINGS_RECORD_ID = "restaurant";

export function outboxKey(kind: RecordKind, recordId: string): string {
  return `${kind}:${recordId}`;
}

export function newUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Bills created before the revamp get a uid derived from their bill number and
 * creation time. The database migration copies cloud bills with the same
 * formula, so a device re-uploading its local copy lands on the same record.
 */
export function legacyOrderUid(order: Pick<Order, "billNo" | "createdAt">): string {
  return `legacy:${order.billNo}:${order.createdAt}`;
}

export function legacyKotUid(kot: Pick<Kot, "billNo" | "station" | "createdAt">): string {
  return `legacy:${kot.billNo}:${kot.station}:${kot.createdAt}`;
}

/** Short, readable code for a device's bill series, e.g. "K7Q". */
export function randomDeviceCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 3; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

/** Device codes print on GST bills, so keep them short, upper-case and unambiguous. */
export function normaliseDeviceCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
}

/**
 * Pull overlaps the previous cursor slightly: a row stamped just before the
 * cursor can commit after a pull has read past it. Re-applying is harmless.
 */
export function pullStartFrom(cursorIso: string | null, overlapMs = 10_000): string | null {
  if (!cursorIso) return null;
  const time = Date.parse(cursorIso);
  if (Number.isNaN(time)) return null;
  return new Date(time - overlapMs).toISOString();
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function isCartLine(value: unknown): value is CartLine {
  return isRecord(value) && isString(value["itemId"]) && isString(value["name"]) && isNumber(value["price"]) && isNumber(value["qty"]);
}

export function isOrderPayload(value: unknown): value is Order {
  if (!isRecord(value)) return false;
  const status = value["status"];
  return isString(value["billNo"]) && Array.isArray(value["lines"]) && value["lines"].every(isCartLine) &&
    isNumber(value["total"]) && isNumber(value["createdAt"]) &&
    (status === "held" || status === "settled" || status === "void");
}

export function isKotPayload(value: unknown): value is Kot {
  if (!isRecord(value)) return false;
  const status = value["status"];
  return isString(value["billNo"]) && isString(value["station"]) && Array.isArray(value["lines"]) &&
    isNumber(value["createdAt"]) && (status === "new" || status === "preparing" || status === "ready" || status === "served");
}

export function isMenuPayload(value: unknown): value is MenuItem {
  return isRecord(value) && isString(value["id"]) && isString(value["name"]) && isString(value["category"]) &&
    isNumber(value["price"]) && typeof value["veg"] === "boolean" && typeof value["available"] === "boolean";
}

export function isTablePayload(value: unknown): value is RestaurantTable {
  return isRecord(value) && isString(value["id"]) && isString(value["label"]) && isString(value["section"]) &&
    isNumber(value["seats"]) && isString(value["status"]);
}

export function isInventoryPayload(value: unknown): value is InventoryItem {
  return isRecord(value) && isString(value["id"]) && isString(value["menuItemId"]) && isNumber(value["quantity"]);
}

export function isMaterialPayload(value: unknown): value is Material {
  return isRecord(value) && isString(value["id"]) && isString(value["name"]) && isString(value["unit"]) && isNumber(value["lowStockLevel"]);
}

export function isSupplierPayload(value: unknown): value is Supplier {
  return isRecord(value) && isString(value["id"]) && isString(value["name"]);
}

export function isStockEntryPayload(value: unknown): value is StockEntry {
  return isRecord(value) && isString(value["id"]) && isString(value["type"]) && isNumber(value["at"]) && Array.isArray(value["items"]) &&
    value["items"].every((item) => isRecord(item) && isString(item["materialId"]) && isNumber(item["qty"]));
}

export function isCustomerPayload(value: unknown): value is Customer {
  return isRecord(value) && isString(value["id"]) && isString(value["phone"]) && isNumber(value["createdAt"]);
}

export function isDayClosePayload(value: unknown): value is DayClose {
  return isRecord(value) && isString(value["id"]) && isString(value["day"]) && isString(value["series"]) && isNumber(value["countedCash"]);
}

export function isSettingsPayload(value: unknown): value is RestaurantSettings {
  return isRecord(value) && isString(value["name"]);
}

/** Strip fields that only make sense on one device before uploading. */
export function toSharedPayload(kind: RecordKind, record: unknown): Record<string, unknown> {
  if (!isRecord(record)) return {};
  const copy: Record<string, unknown> = { ...record };
  if (kind === "order") { delete copy["id"]; delete copy["synced"]; delete copy["cloudUserId"]; }
  if (kind === "kot") { delete copy["id"]; delete copy["orderId"]; }
  if (kind === "inventory") { delete copy["synced"]; }
  // JSON round-trip drops undefined values and anything non-serialisable.
  return JSON.parse(JSON.stringify(copy)) as Record<string, unknown>;
}

/**
 * Add this device's not-yet-sent items to the latest copy of the order, which
 * may already hold items another device sent for the same table.
 */
export function mergeSentLines(latest: CartLine[], pending: CartLine[]): CartLine[] {
  const merged = latest.map((line) => ({ ...line }));
  for (const add of pending) {
    const existing = merged.find((line) => line.itemId === add.itemId);
    if (existing) {
      existing.qty += add.qty;
      if (add.note && add.note !== existing.note) existing.note = existing.note ? `${existing.note}; ${add.note}` : add.note;
    } else {
      merged.push({ ...add });
    }
  }
  return merged;
}

/** True when two line lists hold the same items, quantities and notes. */
export function sameLines(a: CartLine[], b: CartLine[]): boolean {
  if (a.length !== b.length) return false;
  const key = (line: CartLine) => `${line.itemId}|${line.qty}|${line.note ?? ""}|${line.price}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((value, index) => value === right[index]);
}
