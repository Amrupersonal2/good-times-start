import { describe, expect, it } from "vitest";
import { customerStats, earnedPoints, normalisePhone } from "./customer-logic";
import type { Order } from "./types";

const bill = (phone: string, total: number, payments: Order["payments"], extra: Partial<Order> = {}): Order => ({
  billNo: "B", orderType: "dine-in", lines: [], subtotal: total, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0,
  total, payments, status: "settled", createdAt: 100, synced: true, customer: { phone }, ...extra,
});

describe("customers", () => {
  it("matches phone numbers however they're typed", () => {
    expect(normalisePhone("+91 98765 43210")).toBe("9876543210");
    expect(normalisePhone("09876543210")).toBe("9876543210");
    expect(normalisePhone("12345")).toBeNull();
  });

  it("earns 1% on discounted settled value from the sixth visit, excluding points redeemed", () => {
    const order = bill("x", 1180, [{ mode: "points", amount: 20 }, { mode: "upi", amount: 1160 }], { subtotal: 1500, discountAmt: 300, taxable: 1200 });
    expect(earnedPoints(order, 1, false)).toBe(0);
    expect(earnedPoints(order, 1, true)).toBe(11);
    expect(earnedPoints(order, 0, true)).toBe(0);
  });

  it("awards loyalty only from the sixth settled visit, in chronological order", () => {
    const orders = Array.from({ length: 6 }, (_, index) => bill("9876543210", 1000, [{ mode: "cash", amount: 1000 }], { createdAt: (6 - index) * 10, subtotal: 1000, taxable: 1000 }));
    const stats = customerStats({ id: "9876543210", pointsAdjustment: 0, duesPaid: [] }, orders, 1);
    expect(stats.visits).toBe(6);
    expect(stats.pointsEarned).toBe(10);
    expect(stats.points).toBe(10);
  });

  it("works out visits, points, dues and ratings from bills", () => {
    const orders = [
      bill("+91 98765 43210", 1000, [{ mode: "cash", amount: 1000 }], { createdAt: 10, feedback: { rating: 5, at: 1 } }),
      bill("9876543210", 600, [{ mode: "points", amount: 30 }, { mode: "credit", amount: 570 }], { createdAt: 20, feedback: { rating: 4, at: 2 } }),
      bill("9876543210", 999, [{ mode: "cash", amount: 999 }], { status: "void" }),
      bill("1111111111", 500, [{ mode: "cash", amount: 500 }]),
    ];
    const stats = customerStats({ id: "9876543210", pointsAdjustment: 5, duesPaid: [{ id: "p", amount: 200, mode: "upi", at: 30 }] }, orders, 5);
    expect(stats).toMatchObject({ visits: 2, spent: 1600, lastVisit: 20, pointsEarned: 0, pointsRedeemed: 30, points: 0, dueOwed: 570, duePaid: 200, due: 370, averageRating: 4.5 });
  });
});
