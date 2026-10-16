import { describe, expect, it } from "vitest";
import { combineOrders, tableIdFor } from "./table-logic";
import type { CartLine, Order } from "./types";

const line = (itemId: string, qty: number): CartLine => ({ itemId, name: itemId, price: 100, qty, veg: true, gstRate: 5, station: "Main Course" });
const order = (lines: CartLine[], sent: Record<string, number>): Order => ({
  billNo: "B", orderType: "dine-in", lines, subtotal: 0, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0,
  total: 0, payments: [], status: "held", createdAt: 1, synced: true, kotSubmittedQty: sent,
});

describe("table actions", () => {
  it("merges items, kitchen-sent counts and totals into the target bill", () => {
    const into = order([line("naan", 2)], { naan: 2 });
    const from = order([line("naan", 1), line("dal", 1)], { naan: 1, dal: 1 });
    const merged = combineOrders(into, from);
    expect(merged.lines).toEqual([line("naan", 3), line("dal", 1)]);
    expect(merged.kotSubmittedQty).toEqual({ naan: 3, dal: 1 });
    expect(merged.subtotal).toBe(400);
    expect(merged.total).toBe(420);
    expect(merged.synced).toBe(false);
  });

  it("makes readable, unique table ids", () => {
    expect(tableIdFor("Garden 1", [])).toBe("GARDEN-1");
    expect(tableIdFor("t4", ["T4"])).toBe("T4-2");
    expect(tableIdFor("  ", [])).toBe("TABLE");
  });
});
