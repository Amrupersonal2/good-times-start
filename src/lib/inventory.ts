import type { CartLine, InventoryItem } from "./types";
import { stockItemId } from "./menu-logic";

/** Portions sold per menu item; portions and add-on variations of one dish add up. */
function soldByMenuItem(lines: CartLine[]): Map<string, number> {
  const sold = new Map<string, number>();
  for (const line of lines) {
    const id = stockItemId(line);
    sold.set(id, (sold.get(id) ?? 0) + line.qty);
  }
  return sold;
}

export function canFulfillOrder(lines: CartLine[], inventory: InventoryItem[]): boolean {
  const byMenuItem = new Map(inventory.filter((item) => item.tracked).map((item) => [item.menuItemId, item]));
  for (const [id, qty] of soldByMenuItem(lines)) {
    const stock = byMenuItem.get(id);
    if (stock && stock.quantity < qty) return false;
  }
  return true;
}

export function deductInventory(lines: CartLine[], inventory: InventoryItem[]): InventoryItem[] {
  const quantities = soldByMenuItem(lines);
  return inventory.map((item) => {
    if (!item.tracked) return item;
    const sold = quantities.get(item.menuItemId) ?? 0;
    return sold ? { ...item, quantity: Math.max(0, item.quantity - sold), synced: false } : item;
  });
}

/** Put stock back for a voided bill. */
export function restockInventory(lines: CartLine[], inventory: InventoryItem[]): InventoryItem[] {
  const quantities = soldByMenuItem(lines);
  return inventory.map((item) => {
    if (!item.tracked) return item;
    const returned = quantities.get(item.menuItemId) ?? 0;
    return returned ? { ...item, quantity: item.quantity + returned, synced: false } : item;
  });
}
