import { describe, expect, it } from "vitest";
import { dayBounds, historyBills } from "./orders-history";
import type { Order } from "./types";
describe("Orders history", () => {
  it("filters settled and cancelled bills without excluding them from full history", () => {
    const orders = ["held", "settled", "void"].map((status, i) => ({ status, uid: String(i) } as Order));
    expect(historyBills(orders, "settled").map((o) => o.uid)).toEqual(["1"]);
    expect(historyBills(orders, "cancelled").map((o) => o.uid)).toEqual(["2"]);
    expect(historyBills(orders, "bills")).toHaveLength(3);
  });
  it("uses inclusive start and exclusive next midnight for custom dates", () => {
    const [start, end] = dayBounds("2026-11-06");
    expect(start).toBe(new Date(2026, 10, 6).getTime());
    expect(end).toBe(new Date(2026, 10, 7).getTime());
  });
});