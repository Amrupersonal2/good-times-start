import { computeTotals } from "./billing";
import { mergeSentLines } from "./sync-core";
import type { Order, RestaurantTable } from "./types";

/**
 * How a place is named to guests and on paper: short codes read as tables ("Table D1", "Table 4"),
 * named places stand on their own ("Room 3A", "Bonfire 1", "Family Table").
 */
export function placeName(label: string): string {
  const name = label.trim();
  return /^[A-Za-z]{0,2}\d/.test(name) ? `Table ${name}` : name;
}

/** A table on the floor, with its QR bill (guests' scanned orders) if one is open. */
export type FloorTable = RestaurantTable & { qrTotal?: number; qrBill?: string };

/**
 * The floor as it really is. A table with a running staff bill is taken, even if its own
 * status record missed an update (a device that went offline mid-change, an old copy);
 * a table with only a QR bill is taken too. The QR bill is shown alongside, never mixed in.
 */
export function withOpenBills(tables: RestaurantTable[], held: Order[], closed: Order[] = [], draftTableIds: string[] = []): FloorTable[] {
  const staff = new Map<string, Order>();
  const qr = new Map<string, Order>();
  const closedTables = new Set(closed.filter((o) => o.status === "settled" || o.status === "void").map((o) => o.tableId));
  const drafts = new Set(draftTableIds);
  for (const o of held) {
    if (o.status !== "held" || !o.tableId || !o.lines.length) continue;
    const into = o.source === "qr" ? qr : staff;
    const seen = into.get(o.tableId);
    if (!seen || o.createdAt > seen.createdAt) into.set(o.tableId, o);
  }
  return tables.map((t): FloorTable => {
    const bill = staff.get(t.id);
    const qrBill = qr.get(t.id);
    let next: FloorTable = t;
    const busy = t.status === "occupied" || t.status === "billed";
    // Old table mirrors can arrive after settlement. Correct only the displayed floor,
    // never financial history, and preserve new unsent orders and open room bills.
    if (busy && !bill && !qrBill && closedTables.has(t.id) && !t.heldDevice && !drafts.has(t.id)) {
      next = { ...t, status: "free", runningTotal: 0, since: undefined };
    }
    if (bill && !busy) next = { ...t, status: "occupied", runningTotal: bill.total, since: bill.createdAt };
    // A table mirror can be reset to ₹0 (for example by closing another bill on it)
    // while a staff bill stays open: show that bill's amount instead of ₹0.
    else if (bill && busy && !t.runningTotal && bill.total > 0) next = { ...t, runningTotal: bill.total, since: t.since ?? bill.createdAt };
    else if (qrBill && !busy) next = { ...t, status: "occupied", runningTotal: 0, since: qrBill.createdAt };
    return qrBill ? { ...next, qrTotal: qrBill.total, ...(qrBill.uid ? { qrBill: qrBill.uid } : {}) } : next;
  });
}

/** Add per-item quantity maps without mutating either input. */
export function addQuantityMaps(
  left: Record<string, number> = {},
  right: Record<string, number> = {},
): Record<string, number> {
  const combined = { ...left };
  for (const [itemId, qty] of Object.entries(right)) combined[itemId] = (combined[itemId] ?? 0) + qty;
  return combined;
}

/** Whether a table can accommodate the known party size on a running order. */
export function tableCanAccommodateOrder(
  table: Pick<RestaurantTable, "seats">,
  order: Pick<Order, "guestCount">,
): boolean {
  return order.guestCount === undefined || order.guestCount <= table.seats;
}

/** Combine one table's running order into another's: items, kitchen-sent counts and totals. */
export function combineOrders(into: Order, from: Order): Order {
  const lines = mergeSentLines(into.lines, from.lines);
  const sent: Record<string, number> = { ...(into.kotSubmittedQty ?? {}) };
  for (const [key, qty] of Object.entries(from.kotSubmittedQty ?? {})) sent[key] = (sent[key] ?? 0) + qty;
  const totals = computeTotals(lines, into.discountPct, into.serviceChargePct ?? 0, into.tax ?? {});
  return {
    ...into,
    lines,
    kotSubmittedQty: sent,
    kotSettledQty: addQuantityMaps(into.kotSettledQty, from.kotSettledQty),
    guestCount: into.guestCount === undefined && from.guestCount === undefined
      ? undefined
      : (into.guestCount ?? 0) + (from.guestCount ?? 0),
    subtotal: totals.subtotal,
    discountAmt: totals.discountAmt,
    serviceCharge: totals.serviceCharge,
    taxable: totals.taxable,
    cgst: totals.cgst,
    sgst: totals.sgst,
    roundOff: totals.roundOff,
    total: totals.total,
    synced: false,
  };
}

/** Turn a typed table name into a stable id, avoiding ids already in use. */
export function tableIdFor(label: string, taken: string[]): string {
  const base = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "TABLE";
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}-${n}`;
  return id;
}
