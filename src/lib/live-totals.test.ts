import { describe, expect, it } from "vitest";
import { liveTotals } from "./live-totals";
import type { Order } from "./types";

const from = 1000, to = 2000;
const o = (p: Partial<Order>) => ({ uid: "a", status: "settled", total: 100, createdAt: 1500, payments: [{ mode: "cash", amount: 100 }], ...p }) as Order;

describe("liveTotals", () => {
  it("counts a bill opened yesterday but settled today", () => {
    expect(liveTotals([o({ createdAt: 10, settledAt: 1500 })], [], from, to).settled).toBe(100);
  });
  it("counts the same bill once even if read twice", () => {
    expect(liveTotals([o({}), o({})], [], from, to).bills).toBe(1);
  });
  it("splits payments by mode and ignores void bills", () => {
    const t = liveTotals([o({ uid: "b", payments: [{ mode: "upi", amount: 60 }, { mode: "card", amount: 40 }] }), o({ uid: "c", status: "void" })], [], from, to);
    expect([t.upi, t.other, t.cash, t.bills]).toEqual([60, 40, 0, 1]);
  });
});
