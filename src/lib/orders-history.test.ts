import { describe, expect, it } from "vitest";
import { dayBounds, historyBills, isNcBill, paidBy } from "./orders-history";
import type { Order } from "./types";

const paid = (mode: string, amount: number) => ({ mode, amount });
const order = (over: Partial<Order>) => ({ uid: "x", status: "settled", createdAt: 1, payments: [], total: 0, ...over } as unknown as Order);

describe("Orders history", () => {
  it("splits closed bills into settled (paid), NC and cancelled", () => {
    const cash = order({ uid: "cash", payments: [paid("cash", 500)] as Order["payments"], total: 500, settledAt: 10 });
    const nc = order({ uid: "nc", settledAt: 11 });
    const voided = order({ uid: "void", status: "void", cancelledAt: 12 });
    const held = order({ uid: "run", status: "held" });
    const all = [cash, nc, voided, held];
    expect(historyBills(all, "settled").map((o) => o.uid)).toEqual(["cash"]);
    expect(historyBills(all, "nc").map((o) => o.uid)).toEqual(["nc"]);
    expect(historyBills(all, "cancelled").map((o) => o.uid)).toEqual(["void"]);
    expect(historyBills(all, "kots")).toEqual([]);
    expect(isNcBill(nc)).toBe(true);
    expect(isNcBill(cash)).toBe(false);
  });

  it("filters settled bills by how they were paid, including split payments", () => {
    const split = order({ payments: [paid("cash", 200), paid("upi", 300)] as Order["payments"] });
    const card = order({ payments: [paid("card", 400)] as Order["payments"] });
    expect([paidBy(split, "cash"), paidBy(split, "upi"), paidBy(split, "other")]).toEqual([true, true, false]);
    expect([paidBy(card, "cash"), paidBy(card, "other"), paidBy(card, "all")]).toEqual([false, true, true]);
  });

  it("uses inclusive start and exclusive next midnight for custom dates", () => {
    const [start, end] = dayBounds("2026-11-06");
    expect(start).toBe(new Date(2026, 10, 6).getTime());
    expect(end).toBe(new Date(2026, 10, 7).getTime());
  });

  it("lists a Room 7A bill opened yesterday on the day it was settled", () => {
    const today = dayBounds("2026-11-07");
    const yesterday = dayBounds("2026-11-06");
    const room = order({ uid: "7a", total: 1380, payments: [paid("cash", 1380)] as Order["payments"], createdAt: yesterday[0] + 1000, settledAt: today[0] + 1000 });
    expect(historyBills([room], "settled", today)).toEqual([room]);
    expect(historyBills([room], "settled", yesterday)).toEqual([]);
  });

  it("lists bills in the order they were settled", () => {
    const late = order({ uid: "late", payments: [paid("cash", 1)] as Order["payments"], settledAt: 900 });
    const early = order({ uid: "early", payments: [paid("upi", 1)] as Order["payments"], settledAt: 300 });
    expect(historyBills([late, early], "settled").map((o) => o.uid)).toEqual(["early", "late"]);
  });
});
