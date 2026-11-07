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
  it("lists a Room 7A bill opened yesterday under today's settlements only", () => {
    const today = dayBounds("2026-11-07");
    const yesterday = dayBounds("2026-11-06");
    const room = { uid: "7a", total: 1380, status: "settled", createdAt: yesterday[0] + 1000, settledAt: today[0] + 1000 } as Order;
    expect(historyBills([room], "settled", today)).toEqual([room]);
    expect(historyBills([room], "settled", yesterday)).toEqual([]);
    expect(historyBills([room], "bills", yesterday)).toEqual([room]);
    expect(historyBills([room], "bills", today)).toEqual([]);
  });
});