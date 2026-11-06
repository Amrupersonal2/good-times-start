import { describe, expect, it } from "vitest";
import { kpiForecast, MIN_TRADING_DAYS } from "./forecast";
import type { Order } from "./types";

const at = (month: number, day: number, hour: number) => new Date(2026, month, day, hour, 0).getTime();
const bill = (createdAt: number, total: number, o: Partial<Order> = {}): Order => ({
  uid: Math.random().toString(36), billNo: "C1/26-27/0001", orderType: "dine-in", lines: [], subtotal: total, discountPct: 0, discountAmt: 0,
  cgst: 0, sgst: 0, roundOff: 0, total, payments: [{ mode: "cash", amount: total }], status: "settled", createdAt, synced: true, ...o,
});

describe("KPI forecast", () => {
  it("waits for a week of trading before forecasting", () => {
    const orders = [17, 18, 19, 20, 21, 22].map((d) => bill(at(9, d, 12), 1000));
    expect(kpiForecast(orders, at(9, 31, 14))).toEqual({ ready: false, tradingDays: 6, needed: MIN_TRADING_DAYS });
  });

  it("projects today from the same weekday and the month from the daily average (hand-checked)", () => {
    // 17–30 Oct: weekdays ₹1,000 at noon + ₹2,000 at 8 pm; Saturdays (17, 24) ₹1,000 at noon + ₹3,000 at 8 pm + ₹1,000 at 9 pm.
    const orders: Order[] = [];
    for (let d = 17; d <= 30; d++) {
      const saturday = d === 17 || d === 24;
      orders.push(bill(at(9, d, 12), 1000), bill(at(9, d, 20), saturday ? 3000 : 2000));
      if (saturday) orders.push(bill(at(9, d, 21), 1000));
    }
    // Today, Sat 31 Oct at 2 pm: ₹1,500 billed; a void and a bill after "now" must not count.
    orders.push(bill(at(9, 31, 13), 1500), bill(at(9, 31, 13), 9999, { status: "void" }), bill(at(9, 31, 15), 777));
    const f = kpiForecast(orders, at(9, 31, 14));
    if (!f.ready) throw new Error("expected a forecast");
    expect(f.basis).toBe("weekday");
    expect(f.referenceDays).toBe(2);
    // Saturdays bill ₹4,000 in 2 bills after 2 pm: 1,500 + 4,000.
    expect(f.today).toEqual({ soFar: 1500, billsSoFar: 1, expected: 5500, low: 5500, high: 5500, bills: 3, averageBill: 1833.33, vsUsual: 0.1 });
    // Month so far 12 × 3,000 + 2 × 5,000 + 1,500 = 47,500; plus 4,000 for the rest of today; 31 Oct is the last day.
    expect(f.month).toEqual({ soFar: 47500, expected: 51500, daysLeft: 0, dailyAverage: 3285.71 });
  });

  it("falls back to all trading days when the weekday has little history, and counts the days left", () => {
    // 6–13 Oct, ₹1,000 at noon + ₹2,000 at 8 pm; only one Wednesday (7 Oct) before Wed 14 Oct.
    const orders = [6, 7, 8, 9, 10, 11, 12, 13].flatMap((d) => [bill(at(9, d, 12), 1000), bill(at(9, d, 20), 2000)]);
    const f = kpiForecast(orders, at(9, 14, 14));
    if (!f.ready) throw new Error("expected a forecast");
    expect(f.basis).toBe("all-days");
    expect(f.referenceDays).toBe(8);
    expect(f.today).toMatchObject({ soFar: 0, expected: 2000, bills: 1, averageBill: 2000, vsUsual: -0.33 });
    // 24,000 so far + 2,000 rest of today + 17 days (15–31 Oct) × 3,000.
    expect(f.month).toEqual({ soFar: 24000, expected: 77000, daysLeft: 17, dailyAverage: 3000 });
  });

  it("shows a range from the slowest to the busiest reference day", () => {
    const orders = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((d) => bill(at(9, d, 19), d % 2 ? 4000 : 2000));
    const f = kpiForecast(orders, at(9, 18, 10)); // Sunday morning; only one Sunday (11 Oct) has sales, so all days are used
    if (!f.ready) throw new Error("expected a forecast");
    expect(f.today.low).toBe(2000);
    expect(f.today.high).toBe(4000);
    expect(f.today.low).toBeLessThanOrEqual(f.today.expected);
    expect(f.today.expected).toBeLessThanOrEqual(f.today.high);
  });
});
