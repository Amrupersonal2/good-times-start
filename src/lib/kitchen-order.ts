import type { CartLine } from "./types";

/**
 * Lines to show when a device reopens a running bill it had a draft for: the shared bill
 * (which may hold items other devices added since), plus only the items this device added
 * and has not sent yet. The draft alone is never trusted for items already in the kitchen.
 */
export function reopenedLines(draftLines: CartLine[], draftSent: Record<string, number> | undefined, shared: CartLine[], sharedSent: Record<string, number> = {}): CartLine[] {
  const pending = unsentKitchenLines(draftLines, draftSent ?? sharedSent);
  const merged = shared.map((line) => ({ ...line }));
  for (const add of pending) {
    const existing = merged.find((line) => line.itemId === add.itemId);
    if (existing) existing.qty += add.qty;
    else merged.push({ ...add });
  }
  // Cancellations this device started but hasn't sent: only when the draft knows what it had sent.
  if (draftSent) {
    for (const [itemId, sent] of Object.entries(draftSent)) {
      const kept = draftLines.filter((line) => line.itemId === itemId).reduce((t, line) => t + line.qty, 0);
      const line = merged.find((l) => l.itemId === itemId);
      if (line && kept < sent) line.qty = Math.max(0, line.qty - (sent - kept));
    }
  }
  return merged.filter((line) => line.qty > 0);
}

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
