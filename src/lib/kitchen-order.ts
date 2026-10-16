import type { CartLine } from "./types";

export function unsentKitchenLines(lines: CartLine[], submitted: Record<string, number> = {}): CartLine[] {
  return lines.flatMap((line) => {
    const sent = submitted[line.itemId] ?? 0;
    const remaining = Math.max(0, line.qty - sent);
    return remaining > 0 ? [{ ...line, qty: remaining }] : [];
  });
}

export function accumulateSubmittedQuantities(
  submitted: Record<string, number> = {},
  sentLines: CartLine[],
): Record<string, number> {
  return sentLines.reduce<Record<string, number>>((next, line) => {
    next[line.itemId] = (next[line.itemId] ?? submitted[line.itemId] ?? 0) + line.qty;
    return next;
  }, { ...submitted });
}