import type { Kot, Order } from "./types";
import { dayStart, type Range } from "./report-logic";

export type Period = "today" | "yesterday" | "week" | "month";

const DAY = 24 * 60 * 60 * 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The period and a fair comparison: today so far vs the same weekday last week
 * up to the same time; yesterday vs the day before; 7 days vs the 7 before;
 * this month so far vs the same days last month.
 */
export function periodRanges(period: Period, now = Date.now()): { current: Range; previous: Range; label: string } {
  const today = dayStart(now);
  if (period === "today") return { current: { from: today, to: now }, previous: { from: today - 7 * DAY, to: now - 7 * DAY }, label: "vs same time last week" };
  if (period === "yesterday") return { current: { from: today - DAY, to: today - 1 }, previous: { from: today - 2 * DAY, to: today - DAY - 1 }, label: "vs the day before" };
  if (period === "week") return { current: { from: today - 6 * DAY, to: now }, previous: { from: today - 13 * DAY, to: now - 7 * DAY }, label: "vs the 7 days before" };
  const d = new Date(now);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const prevStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  const prevEndDay = Math.min(d.getDate(), new Date(d.getFullYear(), d.getMonth(), 0).getDate());
  const prevTo = new Date(d.getFullYear(), d.getMonth() - 1, prevEndDay, d.getHours(), d.getMinutes()).getTime();
  return { current: { from: monthStart, to: now }, previous: { from: prevStart, to: prevTo }, label: "vs same days last month" };
}

/** Percentage change, or null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Running total of sales through the day, per hour (for "today vs last week" lines). */
export function cumulativeByHour(orders: Order[], from: number, hours = 24): number[] {
  const perHour = Array.from({ length: hours }, () => 0);
  for (const o of orders) {
    if (o.status !== "settled") continue;
    const h = Math.floor((o.createdAt - from) / (60 * 60 * 1000));
    if (h >= 0 && h < hours) perHour[h]! += o.total;
  }
  let run = 0;
  return perHour.map((v) => (run = r2(run + v)));
}

/** Average sales per weekday × hour over the given bills (rows Monday..Sunday). */
export function busyGrid(orders: Order[], weeks: number): number[][] {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  for (const o of orders) {
    if (o.status !== "settled") continue;
    const d = new Date(o.createdAt);
    const row = (d.getDay() + 6) % 7;
    grid[row]![d.getHours()]! += o.total;
  }
  return grid.map((row) => row.map((v) => r2(v / Math.max(1, weeks))));
}

/** Tickets still with the kitchen, and how long the oldest has waited (minutes). */
export function kitchenQueue(kots: Kot[], now = Date.now()): { waiting: number; cooking: number; oldestMinutes: number } {
  const open = kots.filter((k) => k.kind !== "cancel" && (k.status === "new" || k.status === "preparing"));
  const oldest = open.reduce((m, k) => Math.min(m, k.createdAt), Infinity);
  return {
    waiting: open.filter((k) => k.status === "new").length,
    cooking: open.filter((k) => k.status === "preparing").length,
    oldestMinutes: open.length ? Math.max(0, Math.floor((now - oldest) / 60000)) : 0,
  };
}
