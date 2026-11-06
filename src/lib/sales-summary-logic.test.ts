import { describe, expect, it } from "vitest";
import { NO_FILTERS, filterBills, paymentOf, summarySheet, summaryTotals } from "./sales-summary-logic";
import type { Order } from "./types";

const bill = (n: number, o: Partial<Order> = {}): Order => ({
  uid: `o${n}`, billNo: `C1/26-27/${String(n).padStart(4, "0")}`, orderType: "dine-in", tableLabel: `T${n}`,
  lines: [{ itemId: "a", name: "Momo", price: 100, qty: 2, veg: true, gstRate: 5, station: "K" }],
  subtotal: 200, discountPct: 0, discountAmt: 0, cgst: 5, sgst: 5, roundOff: 0, total: 210,
  payments: [{ mode: "cash", amount: 210 }], status: "settled", createdAt: n * 1000, synced: true, ...o,
});

const bills = [
  bill(1),
  bill(2, { orderType: "takeaway", payments: [{ mode: "upi", amount: 100 }, { mode: "cash", amount: 110 }] }),
  bill(3, { billNo: "C2/26-27/0001", discountPct: 10, discountAmt: 20, serviceCharge: 18, cgst: 4.5, sgst: 4.5, total: 207, payments: [{ mode: "credit", amount: 207 }], customer: { name: "Asha", phone: "9876543210" } }),
  bill(4, { status: "void", voidReason: "Wrong table" }),
  bill(5, { status: "held", payments: [] }),
];

describe("sales summary", () => {
  it("totals completed bills only and counts cancellations apart", () => {
    expect(summaryTotals(bills)).toEqual({ sales: 627, orders: 3, discount: 20, charges: 18, tax: 29, foodSale: 580, cancelled: 1, cancelledValue: 210 });
  });

  it("filters by bill or phone, type, payment, split, status and terminal", () => {
    const ids = (f: Partial<typeof NO_FILTERS>) => filterBills(bills, { ...NO_FILTERS, ...f }).map((o) => o.uid);
    expect(ids({})).toEqual(["o5", "o4", "o3", "o2", "o1"]);
    expect(ids({ billNo: "0002" })).toEqual(["o2"]);
    expect(ids({ billNo: "98765" })).toEqual(["o3"]);
    expect(ids({ orderType: "takeaway" })).toEqual(["o2"]);
    expect(ids({ payment: "cash" })).toEqual(["o4", "o2", "o1"]);
    expect(ids({ payment: "split" })).toEqual(["o2"]);
    expect(ids({ status: "void" })).toEqual(["o4"]);
    expect(ids({ series: "C2" })).toEqual(["o3"]);
  });

  it("names the payment like the counter does", () => {
    expect(paymentOf(bills[1]!)).toBe("Split");
    expect(paymentOf(bills[4]!)).toBe("Unpaid");
  });

  it("builds the Excel sheet with optional tax, split-payment and item columns", () => {
    const plain = summarySheet(bills, { items: false, tax: false, split: false }, "TAB", "Today");
    expect(plain.columns.map((c) => c.header)).not.toContain("CGST");
    const full = summarySheet(bills, { items: true, tax: true, split: true }, "TAB", "Today");
    const h = full.columns.map((c) => c.header);
    expect(h).toEqual(expect.arrayContaining(["CGST", "SGST", "Items"]));
    const row3 = full.rows[2]!;
    expect(row3[h.indexOf("Balance")]).toBe(207);
    expect(row3[h.indexOf("Items")]).toBe("2 × Momo");
    // A cancelled bill is listed but adds nothing to the money columns.
    expect(full.rows[3]![h.indexOf("Total")]).toBe(0);
    expect(full.rows[3]![h.indexOf("Status")]).toBe("Cancelled");
  });
});
