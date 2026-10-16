import { getDb, markDirty } from "./db";
import { saleItems } from "./stock-logic";
import { newUid } from "./sync-core";
import type { CartLine, Material, StockEntry, Supplier } from "./types";

/** Add a stock movement to the ledger and share it. */
export async function recordStockEntry(entry: Omit<StockEntry, "id" | "at"> & { id?: string; at?: number }): Promise<StockEntry> {
  const saved: StockEntry = { ...entry, id: entry.id ?? newUid(), at: entry.at ?? Date.now(), items: entry.items.filter((i) => i.qty !== 0) };
  await getDb().stockEntries.put(saved);
  await markDirty(["stock_entry", saved.id]);
  return saved;
}

/**
 * Deduct recipe ingredients for a settled bill. The entry id is derived from
 * the bill, so recording the same bill twice can't deduct twice.
 */
export async function recordSaleConsumption(lines: CartLine[], ref: { orderUid: string; billNo: string; by?: string | undefined }): Promise<void> {
  const items = saleItems(lines, await getDb().menu.toArray(), -1);
  if (!items.length) return;
  await recordStockEntry({ id: `sale:${ref.orderUid}`, type: "sale", items, reference: ref.billNo, ...(ref.by ? { by: ref.by } : {}) });
}

/** Put recipe ingredients back when a settled bill is voided. */
export async function reverseSaleConsumption(lines: CartLine[], ref: { orderUid: string; billNo: string; by?: string | undefined }): Promise<void> {
  const items = saleItems(lines, await getDb().menu.toArray(), 1);
  if (!items.length) return;
  await recordStockEntry({ id: `return:${ref.orderUid}`, type: "return", items, reference: ref.billNo, note: "Bill voided", ...(ref.by ? { by: ref.by } : {}) });
}

export async function saveMaterial(material: Material): Promise<void> {
  await getDb().materials.put(material);
  await markDirty(["material", material.id]);
}

export async function saveSupplier(supplier: Supplier): Promise<void> {
  await getDb().suppliers.put(supplier);
  await markDirty(["supplier", supplier.id]);
}

export async function deleteSupplier(id: string): Promise<void> {
  await getDb().suppliers.delete(id);
  await markDirty(["supplier", id]);
}
