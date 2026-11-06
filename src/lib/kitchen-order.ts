import type { CartLine, Kot } from "./types";

/**
 * Lines to show when a device reopens a running bill it had a draft for: the shared bill
 * (which may hold items other devices added since), plus only the items this device added
 * and has not sent yet. The draft alone is never trusted for items already in the kitchen.
 */
export function reopenedLines(draftLines: CartLine[], draftSent: Record<string, number> | undefined, shared: CartLine[], sharedSent: Record<string, number> = {}, draftBaseLines?: CartLine[]): CartLine[] {
  // New drafts persist the shared snapshot. Only merge additions made after that
  // snapshot; legacy drafts fall back to the submitted-quantity calculation.
  const pending = draftBaseLines
    ? additionsNotInShared(draftBaseLines, draftLines)
    : unsentKitchenLines(draftLines, draftSent ?? sharedSent);
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

/**
 * Return only positive quantity deltas that are present on this device but not
 * in the latest shared bill. This prevents reopening an unsent held bill from
 * adding its existing unsent lines to itself a second time.
 */
export function additionsNotInShared(shared: CartLine[], current: CartLine[]): CartLine[] {
  const sharedQty = new Map(shared.map((line) => [line.itemId, line.qty]));
  return current.flatMap((line) => {
    const delta = line.qty - (sharedQty.get(line.itemId) ?? 0);
    return delta > 0 ? [{ ...line, qty: delta }] : [];
  });
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


/** Guest identity and party size are required before a bill can be sent to the kitchen or settled. */
export function guestDetailsError(customer: { name?: string; phone?: string }, guestCount?: number, tableCapacity?: number): string | null {
  if (!customer.name?.trim()) return "Enter the guest name.";
  const mobile = (customer.phone ?? "").replace(/\D/g, "");
  if (mobile.length !== 10) return "Enter a valid 10-digit mobile number.";
  if (!Number.isInteger(guestCount) || (guestCount ?? 0) < 1 || (guestCount ?? 0) > 50) {
    return "Select the total number of guests (1–50).";
  }
  if (tableCapacity !== undefined && guestCount! > tableCapacity) {
    return `Guest count exceeds this table's capacity (${tableCapacity}).`;
  }
  return null;
}

/**
 * KOT rows are the durable evidence of what reached the kitchen. Derive net
 * submitted quantities from them so a newly printed ticket immediately clears
 * the unsent section even if an older order snapshot has stale kotSubmittedQty.
 */
export function subtractSettledKitchenQuantities(submitted: Record<string, number>, settled: Record<string, number> = {}): Record<string, number> {
  return Object.fromEntries(Object.entries(submitted).flatMap(([itemId, qty]) => {
    const remaining = Math.max(0, qty - (settled[itemId] ?? 0));
    return remaining > 0 ? [[itemId, remaining]] : [];
  }));
}

export function submittedQuantitiesFromKots(kots: Kot[], settled: Record<string, number> = {}): Record<string, number> {
  const submitted: Record<string, number> = {};
  for (const kot of kots) {
    for (const line of kot.lines) {
      if (!line.itemId) continue;
      const sign = kot.kind === "cancel" ? -1 : 1;
      submitted[line.itemId] = Math.max(0, (submitted[line.itemId] ?? 0) + sign * line.qty);
    }
  }
  return subtractSettledKitchenQuantities(submitted, settled);
}
