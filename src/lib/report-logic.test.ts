import { describe, expect, it } from "vitest";
import { categorySales, dailySales, expectedCash, gstByRate, inRange, itemSales, presetRange, salesSummary, seriesOf, staffSales, toCsv } from "./report-logic";
import type { CartLine, Order } from "./types";

const line = (name: string, price: number, qty: number, gstRate = 5, itemId = name): CartLine => ({ itemId, name, price, qty, veg: true, gstRate, station: "x" });
const order = (o: Partial<Order>): Order => ({
  billNo: "INV/26-27/C1/0001", orderType: "dine-in", lines: [], subtotal: 0, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0,
  roundOff: 0, total: 0, payments: [], status: "settled", createdAt: new Date(2026, 9, 16, 13).getTime(), synced: true, ...o,
});

const a = order({ lines: [line("Naan", 60, 2), line("Beer", 300, 1, 18)], subtotal: 420, cgst: 30, sgst: 30, total: 480, payments: [{ mode: "cash", amount: 480 }], closedBy: "Riya" });
const b = order({ billNo: "INV/26-27/C2/0001", orderType: "takeaway", lines: [line("Naan", 60, 1)], discountPct: 10, subtotal: 60, discountAmt: 6, cgst: 1.35, sgst: 1.35, roundOff: 0.3, total: 57,
  payments: [{ mode: "upi", amount: 57 }], closedBy: "Riya", createdAt: new Date(2026, 9, 15, 20).getTime() });
const v = order({ status: "void", lines: [line("Naan", 60, 1)], total: 63, closedBy: "Arun" });

describe("reports", () => {
  it("summarises sales and keeps voids out", () => {
    const s = salesSummary([a, b, v]);
    expect(s).toMatchObject({ bills: 2, gross: 480, discounts: 6, net: 537, average: 268.5, voids: 1, voidValue: 63 });
    expect(s.byPayment).toEqual({ cash: 480, upi: 57 });
    expect(s.byOrderType["takeaway"]).toEqual({ bills: 1, net: 57 });
  });

  it("splits taxable value and tax by GST rate after discounts", () => {
    expect(gstByRate([a, b])).toEqual([
      { rate: 5, taxable: 174, cgst: 4.35, sgst: 4.35 },
      { rate: 18, taxable: 300, cgst: 27, sgst: 27 },
    ]);
  });

  it("ranks items and rolls them up by category", () => {
    const items = itemSales([a, b], [{ id: "Naan", name: "Naan", category: "Breads", price: 60, veg: true, gstRate: 5, station: "x", available: true }]);
    expect(items[0]).toEqual({ name: "Naan", category: "Breads", qty: 3, amount: 174 });
    expect(categorySales(items)).toEqual([{ category: "Other", qty: 1, amount: 300 }, { category: "Breads", qty: 3, amount: 174 }]);
  });

  it("credits staff with bills and voids", () => {
    expect(staffSales([a, b, v])).toEqual([{ name: "Riya", bills: 2, net: 537, voids: 0 }, { name: "Arun", bills: 0, net: 0, voids: 1 }]);
  });

  it("filters by date and fills empty days", () => {
    const range = { from: new Date(2026, 9, 15).getTime(), to: new Date(2026, 9, 16, 23, 59).getTime() };
    expect(inRange([a, b], { from: new Date(2026, 9, 16).getTime(), to: range.to })).toEqual([a]);
    expect(dailySales([a, b], range)).toEqual([{ day: "2026-10-15", net: 57 }, { day: "2026-10-16", net: 480 }]);
    const today = presetRange("today", new Date(2026, 9, 16, 15).getTime());
    expect(today.from).toBe(new Date(2026, 9, 16).getTime());
  });

  it("works out each counter's expected cash from its bill series", () => {
    expect(seriesOf("INV/26-27/C2/0001")).toBe("C2");
    expect(expectedCash([a, b], "C1", 2000)).toBe(2480);
    expect(expectedCash([a, b], "C2", 1000, 200)).toBe(1200);
  });

  it("writes CSV that spreadsheets read correctly", () => {
    expect(toCsv([["Bill", "Note"], ["B1", 'Said "great", thanks']])).toBe('Bill,Note\nB1,"Said ""great"", thanks"');
  });
});
