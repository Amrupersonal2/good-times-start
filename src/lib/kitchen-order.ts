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
/**
 * Items already sent to the kitchen that have since been reduced or removed
 * from the bill. Each needs a cancellation ticket so the station stops cooking.
 * `known` supplies names for lines that were removed entirely.
 */
export function cancelledKitchenLines(lines: CartLine[], submitted: Record<string, number> = {}, known: CartLine[] = []): CartLine[] {
  const reference = new Map<string, CartLine>();
  for (const line of [...known, ...lines]) reference.set(line.itemId, line);
  const cancelled: CartLine[] = [];
  for (const [itemId, sent] of Object.entries(submitted)) {
    const now = lines.find((line) => line.itemId === itemId)?.qty ?? 0;
    const ref = reference.get(itemId);
    if (sent > now && ref) cancelled.push({ ...ref, qty: sent - now });
  }
  return cancelled;
}

/** Take cancelled quantities off the sent counts. */
export function subtractSubmittedQuantities(submitted: Record<string, number>, cancelled: CartLine[]): Record<string, number> {
  const next = { ...submitted };
  for (const line of cancelled) {
    const left = (next[line.itemId] ?? 0) - line.qty;
    if (left > 0) next[line.itemId] = left;
    else delete next[line.itemId];
  }
  return next;
}

/** Take cancelled quantities off the order's lines. */
export function removeCancelled(lines: CartLine[], cancelled: CartLine[]): CartLine[] {
  return lines.flatMap((line) => {
    const cut = cancelled.find((c) => c.itemId === line.itemId)?.qty ?? 0;
    const qty = line.qty - cut;
    return qty > 0 ? [{ ...line, qty }] : [];
  });
}
