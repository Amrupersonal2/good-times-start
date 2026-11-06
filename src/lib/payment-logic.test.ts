import { describe, expect, it } from "vitest";
import { maxDiscountFor, paymentSummary, settledPayments } from "./payment-logic";

describe("payments", () => {
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
