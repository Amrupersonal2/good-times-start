import type { CartLine } from "./types";

export function splitLines(lines: CartLine[], quantities: Record<string, number>) {
  const split: CartLine[] = [];
  const remaining: CartLine[] = [];

  for (const line of lines) {
    const splitQty = Math.max(0, Math.min(line.qty, Math.floor(quantities[line.itemId] ?? 0)));
    if (splitQty > 0) split.push({ ...line, qty: splitQty });
    if (line.qty > splitQty) remaining.push({ ...line, qty: line.qty - splitQty });
  }
  return { split, remaining };
}