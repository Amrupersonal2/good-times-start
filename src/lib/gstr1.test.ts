import { describe, expect, it } from "vitest";
import { gstDate, gstr1Workbook } from "./gstr1";
import { computeTotals } from "./billing";
import { taxOptionsFor } from "./billing-config";
import { buildXlsx, readXlsx } from "./xlsx";
import type { CartLine, Order, OrderType, RestaurantSettings } from "./types";

const settings: RestaurantSettings = { name: "TAB Bistro by XTSY", legalName: "XTSY Ventures Private Limited", gstin: "17AAACX1234A1Z5" };
const line = (price: number, qty: number, gstRate = 5): CartLine => ({ itemId: `i${price}`, name: `Dish ${price}`, price, qty, veg: true, gstRate, station: "x" });
let seq = 0;
function bill(lines: CartLine[], o: Partial<Order> & { orderType?: OrderType } = {}): Order {
  seq += 1;
  const orderType = o.orderType ?? "dine-in";
  const tax = taxOptionsFor(settings, orderType);
  const t = computeTotals(lines, o.discountPct ?? 0, o.serviceChargePct ?? 0, tax);
  return {
    billNo: `C1/26-27/${String(seq).padStart(4, "0")}`, orderType, lines, discountPct: 0, ...t, tax, payments: [{ mode: "cash", amount: t.total }],
    status: "settled", createdAt: new Date(2026, 9, 10 + (seq % 5), 13).getTime(), synced: true, ...o,
  };
}

describe("GSTR-1", () => {
  it("formats dates like the GST portal", () => {
    expect(gstDate(new Date(2026, 9, 7).getTime())).toBe("07-Oct-2026");
  });

  it("splits B2B and B2C, keeps Swiggy/Zomato out of tax, and lists documents", async () => {
    const orders = [
      bill([line(1000, 1)]),
      bill([line(200, 2), line(300, 1, 18)], { serviceChargePct: 10 }),
      bill([line(500, 2)], { customer: { name: "Acme Travels", gstin: "17ABCDE1234F1Z5" } }),
      bill([line(400, 1)], { orderType: "swiggy" }),
      bill([line(250, 1)], { status: "void", voidReason: "Guest left" }),
    ];
    const { sheets, totals } = gstr1Workbook(orders, settings, "October 2026");
    expect(totals).toMatchObject({ b2bInvoices: 1, b2bTaxable: 1000, b2csTaxable: 1770, aggregatorValue: 400, documents: 5, cancelled: 1 });

    const b2cs = sheets.find((s) => s.name === "b2cs")!.rows;
    expect(b2cs).toEqual([["OE", "17-Meghalaya", "", 5, 1440, 0, ""], ["OE", "17-Meghalaya", "", 18, 330, 0, ""]]);
    const b2b = sheets.find((s) => s.name === "b2b")!.rows;
    expect(b2b).toEqual([["17ABCDE1234F1Z5", "Acme Travels", "C1/26-27/0003", gstDate(orders[2]!.createdAt), 1050, "17-Meghalaya", "N", "", "Regular B2B", "", 5, 1000, 0]]);
    expect(sheets.find((s) => s.name === "docs")!.rows).toEqual([["Invoices for outward supply", "C1/26-27/0001", "C1/26-27/0005", 5, 1]]);
    expect(sheets.find((s) => s.name === "eco 9(5)")!.rows).toEqual([["Restaurant service, tax paid by operator u/s 9(5)", "Swiggy (Bundl Technologies)", "", 400]]);

    // Tax in the return matches the tax actually charged on the bills.
    const charged = orders.filter((o) => o.status === "settled").reduce((s, o) => s + o.cgst + o.sgst, 0);
    expect(Math.abs(totals.tax - charged)).toBeLessThan(0.05);

    const hsn = sheets.find((s) => s.name === "hsn(b2c)")!.rows;
    expect(hsn.map((r) => [r[0], r[2], r[5], r[6]])).toEqual([["996331", "NA", 5, 1440], ["996331", "NA", 18, 330]]);

    const back = await readXlsx(buildXlsx(sheets));
    expect(back.map((s) => s.name)).toEqual(["Summary", "b2b", "b2cs", "hsn(b2b)", "hsn(b2c)", "docs", "eco 9(5)"]);
  });

  it("works out taxable value backwards when prices include GST", () => {
    const inclusive = { ...settings, pricesIncludeGst: true };
    const t = computeTotals([line(210, 1)], 0, 0, taxOptionsFor(inclusive, "dine-in"));
    const o: Order = { billNo: "C1/26-27/0001", orderType: "dine-in", lines: [line(210, 1)], discountPct: 0, ...t, tax: taxOptionsFor(inclusive, "dine-in"), payments: [], status: "settled", createdAt: 1, synced: true };
    const { totals } = gstr1Workbook([o], inclusive, "x");
    expect(totals.b2csTaxable).toBe(200);
    expect(totals.tax).toBe(10);
  });
});
