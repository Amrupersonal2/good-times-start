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
    expect(billNumber(1, new Date(2026, 1, 1))).toBe("INV/25-26/D1/0001");
  });
});
