import { describe, expect, it } from "vitest";
import { counterCanClose, counterPayments } from "./counter-logic";
import type { Order } from "./types";
describe("Hotel cash closing", () => {
  it("allows hotel closing while room bills remain open for 28 days", () => {
    expect(counterCanClose("hotel", 28)).toBe(true);
    expect(counterCanClose("restaurant", 1)).toBe(false);
  });
  it("includes a 28-day room stay on the payment day, only on the receiving device", () => {
    const at = new Date(2026, 10, 6, 12).getTime();
    const bill = { status: "settled", billNo: "TBX/26-27/0001", createdAt: at - 28 * 86400000, settledAt: at, settledDeviceId: "counter-a", total: 539 } as Order;
    const range = { from: at - 3600000, to: at + 3600000 };
    expect(counterPayments([bill, { ...bill, status: "held" }], range, "counter-a", "TBX").map((o) => o.total)).toEqual([539]);
    expect(counterPayments([bill], range, "counter-b", "TBX")).toEqual([]);
  });
});