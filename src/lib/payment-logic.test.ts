import { describe, expect, it } from "vitest";
import { maxDiscountFor, paymentSummary, repairedSettlementPayments, settledPayments } from "./payment-logic";
import { computeTotals } from "./billing";

describe("payments", () => {
  it("repairs queued NC settlements without inventing a cash payment", () => {
    expect(repairedSettlementPayments({ status: "settled", total: 0, payments: [{ mode: "cash", amount: 0 }] })).toEqual([]);
  });
  it("removes only zero split tenders and preserves real paid amounts", () => {
    const payments = [{ mode: "cash" as const, amount: 60 }, { mode: "upi" as const, amount: 0 }];
    expect(repairedSettlementPayments({ status: "settled", total: 60, payments })).toEqual([{ mode: "cash", amount: 60 }]);
    expect(payments).toHaveLength(2);
  });
  it("never repairs missing, negative, unsupported or mismatched payments", () => {
    expect(repairedSettlementPayments({ status: "settled", total: 60, payments: [{ mode: "cash", amount: 0 }] })).toBeNull();
    expect(repairedSettlementPayments({ status: "settled", total: 60, payments: [{ mode: "cash", amount: 60 }, { mode: "cash", amount: -1 }] })).toBeNull();
    expect(repairedSettlementPayments({ status: "void", total: 0, payments: [{ mode: "cash", amount: 0 }] })).toBeNull();
  });
  it("100% NC discount closes at zero including GST and service charge", () => {
    const totals = computeTotals([{ itemId: "chai", name: "Milk Chai", price: 60, qty: 1, veg: true, gstRate: 5, station: "Kitchen" }], 100, 10);
    expect(totals).toMatchObject({ subtotal: 60, discountAmt: 60, cgst: 0, sgst: 0, serviceCharge: 0, total: 0 });
    expect(settledPayments([], totals.total)).toEqual([]);
  });
  it("records no payment for a zero-total bill", () => {
    expect(settledPayments([{ mode: "cash", amount: 0 }], 0)).toEqual([]);
  });
  it("gives change only from cash", () => {
    expect(paymentSummary([{ mode: "cash", amount: 500 }], 430)).toMatchObject({ change: 70, remaining: 0, complete: true, error: "" });
    expect(paymentSummary([{ mode: "card", amount: 500 }], 430)).toMatchObject({ complete: false });
    expect(paymentSummary([{ mode: "card", amount: 500 }], 430).error).not.toBe("");
  });

  it("tracks what's still due across split payments", () => {
    const entries = [{ mode: "upi" as const, amount: 300 }, { mode: "cash" as const, amount: 100 }];
    expect(paymentSummary(entries, 430)).toMatchObject({ remaining: 30, complete: false });
    expect(paymentSummary([...entries, { mode: "cash", amount: 50 }], 430)).toMatchObject({ remaining: 0, change: 20, complete: true });
  });

  it("records kept amounts, net of change, one entry per mode", () => {
    expect(settledPayments([{ mode: "upi", amount: 300 }, { mode: "cash", amount: 100 }, { mode: "cash", amount: 50 }], 430))
      .toEqual([{ mode: "upi", amount: 300 }, { mode: "cash", amount: 130 }]);
    expect(settledPayments([{ mode: "cash", amount: 500 }], 430)).toEqual([{ mode: "cash", amount: 430 }]);
  });

  it("limits staff discounts but not owners and managers", () => {
    expect(maxDiscountFor("cashier", 10)).toBe(10);
    expect(maxDiscountFor("manager", 10)).toBe(100);
  });
});
