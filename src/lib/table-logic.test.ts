import { describe, expect, it } from "vitest";
import { addQuantityMaps, combineOrders, placeName, tableCanAccommodateOrder, tableIdFor, withOpenBills } from "./table-logic";
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

  it("shows an open bill's amount when the table mirror says ₹0", () => {
    const floor = withOpenBills([t("BONFIRE-1", "billed", 0)], [bill("BONFIRE-1", 60)]);
    expect(floor.map((x) => [x.status, x.runningTotal])).toEqual([["billed", 60]]);
  });

  it("ignores settled, cancelled and empty bills", () => {
    const empty = { ...bill("R1", 0), lines: [] };
    expect(withOpenBills([t("R1", "free")], [bill("R1", 100, "settled"), bill("R1", 100, "void"), empty])[0]?.status).toBe("free");
  });

  it("shows Room 7A free after its ₹1380 bill is settled despite a stale table mirror", () => {
    const settled = bill("ROOM-7A", 1380, "settled");
    const floor = withOpenBills([t("ROOM-7A", "occupied", 1380)], [], [settled]);
    expect(floor[0]?.status).toBe("free");
    expect(floor[0]?.runningTotal).toBe(0);
    expect(settled.total).toBe(1380);
    expect(settled.status).toBe("settled");
  });

  it("does not release a room with a newer open bill, QR bill or unsent draft", () => {
    const stale = t("ROOM-7A", "occupied", 1380);
    const closed = [bill("ROOM-7A", 1380, "settled")];
    expect(withOpenBills([stale], [bill("ROOM-7A", 80)], closed)[0]?.status).toBe("occupied");
    expect(withOpenBills([stale], [{ ...bill("ROOM-7A", 80), source: "qr" }], closed)[0]?.status).toBe("occupied");
    expect(withOpenBills([stale], [], closed, ["ROOM-7A"])[0]?.status).toBe("occupied");
    expect(withOpenBills([{ ...stale, heldDevice: "waiter" }], [], closed)[0]?.status).toBe("occupied");
  });

  it("keeps a table's QR bill apart from its staff bill", () => {
    const qr = (tableId: string, total: number, uid: string): Order => ({ ...bill(tableId, total), source: "qr", uid, createdAt: 2000 });
    const floor = withOpenBills([t("D1", "occupied", 400), t("HUT-1", "free"), t("D2", "free")], [bill("D1", 400), qr("D1", 250, "q1"), qr("HUT-1", 180, "q2")]);
    expect(floor.map((x) => [x.id, x.status, x.runningTotal, x.qrTotal ?? null, x.qrBill ?? null])).toEqual([
      ["D1", "occupied", 400, 250, "q1"],
      ["HUT-1", "occupied", 0, 180, "q2"],
      ["D2", "free", 0, null, null],
    ]);
  });
});


describe("place names", () => {
  it("names short codes as tables and named places as themselves", () => {
    expect(["D1", "D2", "4", "T4", "2A", "Room 3A", "Room 666", "Bonfire 1", "Hut 2", "Family Table"].map(placeName))
      .toEqual(["Table D1", "Table D2", "Table 4", "Table T4", "Table 2A", "Room 3A", "Room 666", "Bonfire 1", "Hut 2", "Family Table"]);
  });
});


describe("table capacity and merged bill accounting", () => {
  it("adds party sizes and settled KOT allocations when bills merge", () => {
    const into = { ...order([line("naan", 1)], { naan: 1 }), guestCount: 2, kotSettledQty: { naan: 1 } };
    const from = { ...order([line("dal", 1)], { dal: 1 }), guestCount: 3, kotSettledQty: { dal: 1 } };
    const merged = combineOrders(into, from);
    expect(merged.guestCount).toBe(5);
    expect(merged.kotSettledQty).toEqual({ naan: 1, dal: 1 });
    expect(addQuantityMaps({ naan: 1 }, { naan: 2, dal: 1 })).toEqual({ naan: 3, dal: 1 });
  });

  it("rejects moving or merging a party onto a table with insufficient seats", () => {
    expect(tableCanAccommodateOrder({ seats: 4 }, { guestCount: 4 })).toBe(true);
    expect(tableCanAccommodateOrder({ seats: 4 }, { guestCount: 5 })).toBe(false);
    expect(tableCanAccommodateOrder({ seats: 4 }, {})).toBe(true);
  });
});

describe("floor bills not yet on this device", () => {
  it("flags a busy table with an amount but no local bill", async () => {
    const { withOpenBills } = await import("./table-logic");
    const t = { id: "D1", label: "D1", section: "Dine-in", seats: 2, status: "occupied", runningTotal: 280 } as never;
    expect(withOpenBills([t], [])[0]?.awaitingBill).toBe(true);
  });
});
