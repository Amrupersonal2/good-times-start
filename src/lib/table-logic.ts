import { computeTotals } from "./billing";
import { mergeSentLines } from "./sync-core";
import type { Order } from "./types";

/** Combine one table's running order into another's: items, kitchen-sent counts and totals. */
export function combineOrders(into: Order, from: Order): Order {
  const lines = mergeSentLines(into.lines, from.lines);
  const sent: Record<string, number> = { ...(into.kotSubmittedQty ?? {}) };
  for (const [key, qty] of Object.entries(from.kotSubmittedQty ?? {})) sent[key] = (sent[key] ?? 0) + qty;
  const totals = computeTotals(lines, into.discountPct);
  return {
    ...into,
    lines,
    kotSubmittedQty: sent,
    subtotal: totals.subtotal,
    discountAmt: totals.discountAmt,
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
