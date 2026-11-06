import { describe, expect, it } from "vitest";
import { businessOverview, dashboardRange, liveStatus, salesByDay } from "./dashboard-logic";
import type { Kot, Order, StockEntry } from "./types";

const base = new Date(2026, 9, 18, 13, 0).getTime(); // Sun 18 Oct 2026, 1 pm
const line = (name: string, qty: number, price = 100) => ({ itemId: name, name, price, qty, veg: true, gstRate: 5, station: "K" });
const bill = (o: Partial<Order>): Order => ({
  uid: Math.random().toString(36), billNo: "C1/26-27/0001", orderType: "dine-in", lines: [line("Tea", 1)], subtotal: 100, discountPct: 0, discountAmt: 0,
  cgst: 2.5, sgst: 2.5, roundOff: 0, total: 105, payments: [{ mode: "cash", amount: 105 }], status: "settled", createdAt: base, synced: true, ...o,
});

describe("dashboard ranges", () => {
  it("starts weeks on Monday and months on the 1st", () => {
    const w = dashboardRange("thisWeek", base);
    expect(new Date(w.from).getDay()).toBe(1);
    expect(new Date(w.from).getDate()).toBe(12);
    expect(new Date(dashboardRange("lastWeek", base).from).getDate()).toBe(5);
    const lm = dashboardRange("lastMonth", base);
    expect([new Date(lm.from).getMonth(), new Date(lm.from).getDate(), new Date(lm.to).getMonth()]).toEqual([8, 1, 9]);
    expect(salesByDay([], dashboardRange("last15", base))).toHaveLength(15);
  });
});

describe("business overview", () => {
  const orders: Order[] = [
    bill({ total: 105 }),
    bill({ orderType: "takeaway", total: 210, payments: [{ mode: "upi", amount: 210 }], source: "online" }),
    bill({ orderType: "zomato", total: 300, payments: [{ mode: "wallet", amount: 300 }] }),
    bill({ discountPct: 10, discountAmt: 10, total: 94.5, payments: [{ mode: "credit", amount: 94.5 }] }),
    bill({ discountPct: 100, discountAmt: 100, total: 0, payments: [] }),
    bill({ status: "void", total: 105 }),
    bill({ createdAt: base - 40 * 86_400_000, total: 999 }),
  ];
  const kots = [{ kind: "cancel", createdAt: base }, { kind: "order", createdAt: base }] as Kot[];
  const stock = [{ id: "p", type: "purchase", at: base, items: [{ materialId: "m", qty: 2, unitCost: 450 }] }] as StockEntry[];
  const o = businessOverview(orders, kots, stock, dashboardRange("today", base));

  it("adds up sales, channels and payment modes for the period only", () => {
    expect([o.net, o.bills]).toEqual([709.5, 5]);
    expect(o.channels.find((c) => c.key === "aggregator")).toMatchObject({ net: 300, bills: 1 });
    expect(o.channels.find((c) => c.key === "pickup")?.net).toBe(210);
    expect(o.payments.map((p) => p.mode)).toEqual(["wallet", "upi", "cash", "credit"]);
    expect(o.breakup).toEqual({ pos: 499.5, guest: 210 });
    expect(o.purchases).toBe(900);
  });

  it("shows where money leaks: cancelled bills and KOTs, discounts, complimentary bills and dues", () => {
    expect(o.leakage).toEqual({ cancelledBills: 1, cancelledValue: 105, cancelledKots: 1, discountedBills: 1, complimentaryBills: 1, dueBills: 1, dueValue: 94.5 });
    expect(o.discounts.total).toBe(110);
  });
});

describe("live status", () => {
  it("lists running bills oldest first with each dish added up, and their total", () => {
    const live = liveStatus([
      bill({ status: "held", tableId: "t2", tableLabel: "2A", createdAt: base + 5, lines: [line("Tea", 2), line("Tea", 1), line("Dosa", 1)], total: 400, customer: { name: "Anisha", phone: "7077376844" } }),
      bill({ status: "held", createdAt: base, guestCodes: ["W-1234"], customer: { name: "Banrita" }, total: 149 }),
      bill({ status: "settled" }),
    ]);
    expect(live.total).toBe(549);
    expect(live.cards.map((c) => c.title)).toEqual(["W-1234 Banrita", "2A"]);
    expect(live.cards[1]?.lines).toEqual([{ name: "Tea", qty: 3 }, { name: "Dosa", qty: 1 }]);
  });
});
