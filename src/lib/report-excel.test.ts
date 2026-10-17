import { describe, expect, it } from "vitest";
import { reportsWorkbook } from "./report-excel";
import { buildXlsx, readXlsx } from "./xlsx";
import type { Order } from "./types";

const bill = (n: number, o: Partial<Order> = {}): Order => ({
  uid: `u${n}`, billNo: `C1/26-27/000${n}`, orderType: "dine-in", lines: [{ itemId: "a", name: "Naan", price: 60, qty: 2, veg: true, gstRate: 5, station: "Tandoor" }],
  subtotal: 120, discountPct: 0, discountAmt: 0, taxable: 120, cgst: 3, sgst: 3, roundOff: 0, total: 126, payments: [{ mode: "cash", amount: 126 }],
  status: "settled", createdAt: new Date(2026, 9, 17, 13).getTime(), synced: true, ...o,
});

describe("reports workbook", () => {
  it("totals only settled bills and opens as a real workbook", async () => {
    const sheets = reportsWorkbook([bill(1), bill(2), bill(3, { status: "void", voidReason: "Guest left" })], [], [], { from: 0, to: Date.now() }, "TAB Bistro");
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Bills", "Bill items", "Dishes", "Categories", "Payments", "Order types", "GST by rate", "Staff", "Day closes"]);
    const back = await readXlsx(buildXlsx(sheets));
    const bills = back.find((s) => s.name === "Bills")!.rows;
    const header = bills.findIndex((r) => r[0] === "Bill");
    const totalRow = bills[header + 4]!;
    expect(totalRow[0]).toBe("Total");
    expect(totalRow[15]).toBe(252);
    expect(back.find((s) => s.name === "Dishes")!.rows.find((r) => r[0] === "Naan")).toEqual(["Naan", "Other", 4, 240]);
  });
});
