/**
 * KPI forecast for the owner's dashboard: where today and this month are likely to close.
 * Pure functions over this device's settled bills; no AI, so every number can be checked by hand.
 *
 * Today: what is already billed, plus what the restaurant usually bills after this time of day
 *   on the same weekday (last 4 weeks), or on any trading day when the weekday has too little history.
 * Month: billed so far this month, plus the rest of today, plus the usual sales per calendar day
 *   (closed days included) for each day left in the month.
 */
import { dayStart } from "./report-logic";
import type { Order } from "./types";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Trading days needed before a forecast is shown; fewer and one odd day swings it too much. */
export const MIN_TRADING_DAYS = 7;
export const LOOKBACK_DAYS = 28;

export type ForecastBasis = "weekday" | "all-days";

export interface KpiForecast {
  ready: true;
  basis: ForecastBasis;
  /** Number of past days the today-forecast is built from. */
  referenceDays: number;
  today: {
    soFar: number;
    billsSoFar: number;
    expected: number;
    low: number;
    high: number;
    bills: number;
    averageBill: number;
    /** Expected close against a usual day of the same kind; 0.1 = 10% above. null when usual is 0. */
    vsUsual: number | null;
  };
  month: { soFar: number; expected: number; daysLeft: number; dailyAverage: number };
}

export interface ForecastNotReady { ready: false; tradingDays: number; needed: number }

/** Start of the next calendar day, safe across clock changes. */
const nextDay = (at: number) => dayStart(at + DAY + 3_600_000);

interface DayTotals { day: number; net: number; bills: number; netAfter: number; billsAfter: number }

export function kpiForecast(orders: Order[], now: number = Date.now()): KpiForecast | ForecastNotReady {
  const today = dayStart(now);
  const offset = now - today;
  const lookFrom = dayStart(today - LOOKBACK_DAYS * DAY + 3_600_000);
  const settled = orders.filter((o) => o.status === "settled" && o.createdAt < now);

  // Past days in the look-back window, with what was billed after this time of day.
  const days = new Map<number, DayTotals>();
  let firstSale = Infinity;
  for (const o of settled) {
    if (o.createdAt < lookFrom || o.createdAt >= today) continue;
    const d = dayStart(o.createdAt);
    firstSale = Math.min(firstSale, d);
    const row = days.get(d) ?? { day: d, net: 0, bills: 0, netAfter: 0, billsAfter: 0 };
    row.net += o.total; row.bills += 1;
    if (o.createdAt - d >= offset) { row.netAfter += o.total; row.billsAfter += 1; }
    days.set(d, row);
  }
  const trading = [...days.values()];
  if (trading.length < MIN_TRADING_DAYS) return { ready: false, tradingDays: trading.length, needed: MIN_TRADING_DAYS };

  const weekday = new Date(now).getDay();
  const sameWeekday = trading.filter((d) => new Date(d.day).getDay() === weekday);
  const basis: ForecastBasis = sameWeekday.length >= 2 ? "weekday" : "all-days";
  const ref = basis === "weekday" ? sameWeekday : trading;
  const mean = (pick: (d: DayTotals) => number) => ref.reduce((t, d) => t + pick(d), 0) / ref.length;

  const todays = settled.filter((o) => o.createdAt >= today);
  const soFar = r2(todays.reduce((t, o) => t + o.total, 0));
  const billsSoFar = todays.length;
  const restOfDay = mean((d) => d.netAfter);
  const expected = r2(soFar + restOfDay);
  const bills = Math.round(billsSoFar + mean((d) => d.billsAfter));
  const afters = ref.map((d) => d.netAfter);
  const usual = mean((d) => d.net);

  // Month: sales per calendar day since the first sale in the window (or the full window), closed days included.
  const monthStart = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1).getTime();
  const nextMonth = new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 1).getTime();
  const windowStart = Math.max(lookFrom, firstSale);
  const calendarDays = Math.max(1, Math.round((today - windowStart) / DAY));
  const dailyAverage = r2(trading.reduce((t, d) => t + d.net, 0) / calendarDays);
  let daysLeft = 0;
  for (let d = nextDay(today); d < nextMonth; d = nextDay(d)) daysLeft += 1;
  const monthSoFar = r2(settled.filter((o) => o.createdAt >= monthStart).reduce((t, o) => t + o.total, 0));

  return {
    ready: true,
    basis,
    referenceDays: ref.length,
    today: {
      soFar,
      billsSoFar,
      expected,
      low: r2(soFar + Math.min(...afters)),
      high: r2(soFar + Math.max(...afters)),
      bills,
      averageBill: bills ? r2(expected / bills) : 0,
      vsUsual: usual > 0 ? r2(expected / usual - 1) : null,
    },
    month: { soFar: monthSoFar, expected: r2(monthSoFar + restOfDay + dailyAverage * daysLeft), daysLeft, dailyAverage },
  };
}
