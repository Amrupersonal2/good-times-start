import { describe, expect, it } from "vitest";
import { busyGrid, change, cumulativeByHour, kitchenQueue, periodRanges } from "./insights-logic";
import type { Kot, Order } from "./types";

const bill = (at: number, total: number, status: Order["status"] = "settled"): Order => ({
  billNo: "b", orderType: "dine-in", lines: [], subtotal: total, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total, payments: [], status, createdAt: at, synced: true,
});

describe("insights", () => {
  const now = new Date(2026, 9, 17, 14, 30).getTime(); // Saturday 2:30 pm

  it("compares today with the same time last week", () => {
    const { current, previous } = periodRanges("today", now);
    expect(new Date(current.from).getHours()).toBe(0);
    expect(new Date(previous.from).getDate()).toBe(10);
    expect(new Date(previous.to).getHours()).toBe(14);
  });

  it("compares this month so far with the same days last month", () => {
    const { previous } = periodRanges("month", new Date(2026, 2, 31, 20).getTime());
    expect(new Date(previous.from).getMonth()).toBe(1);
    expect(new Date(previous.to).getDate()).toBe(28);
  });

  it("reports change only when there's something to compare", () => {
    expect(change(150, 100)).toBe(50);
    expect(change(80, 100)).toBe(-20);
    expect(change(100, 0)).toBeNull();
  });

  it("builds a running total through the day, ignoring voids", () => {
    const start = new Date(2026, 9, 17).getTime();
    const hour = 3_600_000;
    const run = cumulativeByHour([bill(start + 9 * hour, 100), bill(start + 9.5 * hour, 50), bill(start + 13 * hour, 200), bill(start + 13 * hour, 999, "void")], start);
    expect(run[8]).toBe(0);
    expect(run[9]).toBe(150);
    expect(run[13]).toBe(350);
    expect(run[23]).toBe(350);
  });

  it("averages busy hours by weekday", () => {
    const sat = new Date(2026, 9, 17, 20).getTime();
    const grid = busyGrid([bill(sat, 400), bill(sat - 7 * 86_400_000, 200)], 2);
    expect(grid[5]![20]).toBe(300);
    expect(grid[0]![20]).toBe(0);
  });

  it("counts the kitchen queue and its oldest ticket", () => {
    const k = (status: Kot["status"], mins: number, kind: Kot["kind"] = "order"): Kot => ({ orderId: 1, billNo: "b", station: "x", kind, lines: [], status, createdAt: now - mins * 60000 });
    expect(kitchenQueue([k("new", 3), k("preparing", 12), k("ready", 40), k("new", 50, "cancel")], now)).toEqual({ waiting: 1, cooking: 1, oldestMinutes: 12 });
  });
});
