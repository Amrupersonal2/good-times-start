import type { CartLine, InventoryItem } from "./types";

export function canFulfillOrder(lines: CartLine[], inventory: InventoryItem[]): boolean {
  const byMenuItem = new Map(inventory.filter((item) => item.tracked).map((item) => [item.menuItemId, item]));
  return lines.every((line) => {
    const stock = byMenuItem.get(line.itemId);
    return !stock || stock.quantity >= line.qty;
  });
}

export function deductInventory(lines: CartLine[], inventory: InventoryItem[]): InventoryItem[] {
  const quantities = new Map(lines.map((line) => [line.itemId, line.qty]));
  return inventory.map((item) => {
    if (!item.tracked) return item;
    const sold = quantities.get(item.menuItemId) ?? 0;
    return sold ? { ...item, quantity: Math.max(0, item.quantity - sold), synced: false } : item;
  });
}