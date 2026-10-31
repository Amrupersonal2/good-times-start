import { computeTotals } from "./billing";
import { mergeSentLines } from "./sync-core";
import type { Order, RestaurantTable } from "./types";

/**
 * The floor as it really is: a table with a running bill is taken, even if its own
 * status record missed an update (a device that went offline mid-change, an old copy).
 * Tables are never shown free while a bill is open on them.
 */
export function withOpenBills(tables: RestaurantTable[], held: Order[]): RestaurantTable[] {
  const open = new Map<string, Order>();
  for (const o of held) if (o.status === "held" && o.tableId && o.lines.length && !open.has(o.tableId)) open.set(o.tableId, o);
  return tables.map((t) => {
    const bill = open.get(t.id);
    if (!bill || t.status === "occupied" || t.status === "billed") return t;
    return { ...t, status: "occupied", runningTotal: bill.total, since: bill.createdAt };
  });
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
