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

  it("earns points only on the part not paid with points", () => {
    expect(earnedPoints(bill("x", 1000, [{ mode: "cash", amount: 1000 }]), 5)).toBe(50);
    expect(earnedPoints(bill("x", 1000, [{ mode: "points", amount: 200 }, { mode: "upi", amount: 800 }]), 5)).toBe(40);
    expect(earnedPoints(bill("x", 1000, [{ mode: "cash", amount: 1000 }]), 0)).toBe(0);
  });

  it("works out visits, points, dues and ratings from bills", () => {
    const orders = [
      bill("+91 98765 43210", 1000, [{ mode: "cash", amount: 1000 }], { createdAt: 10, feedback: { rating: 5, at: 1 } }),
      bill("9876543210", 600, [{ mode: "points", amount: 30 }, { mode: "credit", amount: 570 }], { createdAt: 20, feedback: { rating: 4, at: 2 } }),
      bill("9876543210", 999, [{ mode: "cash", amount: 999 }], { status: "void" }),
      bill("1111111111", 500, [{ mode: "cash", amount: 500 }]),
    ];
    const stats = customerStats({ id: "9876543210", pointsAdjustment: 5, duesPaid: [{ id: "p", amount: 200, mode: "upi", at: 30 }] }, orders, 5);
    expect(stats).toMatchObject({ visits: 2, spent: 1600, lastVisit: 20, pointsEarned: 78, pointsRedeemed: 30, points: 53, dueOwed: 570, duePaid: 200, due: 370, averageRating: 4.5 });
  });
});
