import { describe, it, expect } from "vitest";
import { computeTotals, formatINR, billNumber, financialYear } from "./billing";

const line = (price: number, qty: number, gstRate: number) => ({
  itemId: "x", name: "x", price, qty, veg: true, gstRate, station: "s",
});

describe("billing", () => {
  it("formats rupees in Indian grouping", () => {
    expect(formatINR(123456)).toBe("₹1,23,456.00");
  });
  it("splits 5% GST into CGST and SGST and rounds off", () => {
    const t = computeTotals([line(290, 1, 5)]);
    expect(t.cgst).toBe(7.25);
    expect(t.sgst).toBe(7.25);
    expect(t.total).toBe(305);
    expect(t.roundOff).toBe(0.5);
  });
  it("applies percentage discount before tax", () => {
    const t = computeTotals([line(200, 1, 5)], 10);
    expect(t.discountAmt).toBe(20);
    expect(t.cgst).toBe(4.5);
    expect(t.total).toBe(189);
  });
  it("adds an optional service charge taxed at the food's rate", () => {
    const t = computeTotals([line(1000, 1, 5)], 0, 5);
    expect(t.serviceCharge).toBe(50);
    expect(t.cgst).toBe(26.25);
    expect(t.total).toBe(1103);
    expect(computeTotals([line(1000, 1, 5)]).serviceCharge).toBe(0);
  });
  it("applies service charge after the discount", () => {
    const t = computeTotals([line(1000, 1, 5)], 10, 10);
    expect(t.taxable).toBe(900);
    expect(t.serviceCharge).toBe(90);
  });
  it("uses Indian financial year in bill numbers", () => {
    expect(financialYear(new Date(2026, 9, 11))).toBe("26-27");
    expect(financialYear(new Date(2026, 1, 1))).toBe("25-26");
    expect(billNumber(1, new Date(2026, 1, 1))).toBe("D1/25-26/0001");
    expect(billNumber(12345, new Date(2026, 9, 1), "TAB12").length).toBeLessThanOrEqual(16);
  });
  it("works GST out backwards when menu prices include it", () => {
    const t = computeTotals([line(105, 2, 5)], 0, 0, { inclusive: true });
    expect(t.taxable).toBe(200);
    expect(t.cgst).toBe(5);
    expect(t.total).toBe(210);
    expect(t.subtotal).toBe(210);
  });
  it("charges no GST on exempt bills (composition, or GST paid by Swiggy/Zomato)", () => {
    const t = computeTotals([line(290, 1, 5)], 10, 0, { exempt: true });
    expect([t.taxable, t.cgst, t.sgst, t.total]).toEqual([261, 0, 0, 261]);
  });
  it("can keep paise instead of rounding to the rupee", () => {
    const t = computeTotals([line(290, 1, 5)], 0, 0, { roundToRupee: false });
    expect(t.total).toBe(304.5);
    expect(t.roundOff).toBe(0);
  });
  it("taxes service charge at the bill's rate with inclusive prices too", () => {
    const t = computeTotals([line(105, 1, 5)], 0, 10, { inclusive: true });
    expect(t.serviceCharge).toBe(10);
    expect(t.cgst).toBe(2.75);
    expect(t.total).toBe(116);
  });
});
