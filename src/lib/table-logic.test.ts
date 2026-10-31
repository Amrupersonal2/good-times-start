import { describe, expect, it } from "vitest";
import { combineOrders, tableIdFor, withOpenBills } from "./table-logic";
import type { CartLine, Order, RestaurantTable } from "./types";

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

describe("floor status", () => {
  const t = (id: string, status: RestaurantTable["status"], runningTotal = 0): RestaurantTable => ({ id, label: id, section: "Rooftop", seats: 6, status, runningTotal });
  const bill = (tableId: string, total: number, status: Order["status"] = "held"): Order => ({ ...order([line("x", 1)], {}), tableId, total, status, createdAt: 1000 });

  it("never shows a table free while a bill is open on it", () => {
    const floor = withOpenBills([t("R1", "free"), t("R2", "free"), t("R3", "occupied", 700), t("R4", "reserved")], [bill("R2", 520), bill("R3", 680), bill("R4", 90)]);
    expect(floor.map((x) => [x.id, x.status, x.runningTotal])).toEqual([["R1", "free", 0], ["R2", "occupied", 520], ["R3", "occupied", 700], ["R4", "occupied", 90]]);
    expect(floor[1]?.since).toBe(1000);
  });

  it("ignores settled, cancelled and empty bills", () => {
    const empty = { ...bill("R1", 0), lines: [] };
    expect(withOpenBills([t("R1", "free")], [bill("R1", 100, "settled"), bill("R1", 100, "void"), empty])[0]?.status).toBe("free");
  });
});
