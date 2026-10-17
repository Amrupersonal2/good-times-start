/** Owner dashboard: business overview and live status, computed from this device's bills. Pure functions. */
import type { Kot, Order, OrderType, PaymentMode, StockEntry } from "./types";
import { dayStart, paymentLabel, salesSummary, type Range } from "./report-logic";

const DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export type Preset = "today" | "yesterday" | "thisWeek" | "lastWeek" | "last15" | "thisMonth" | "lastMonth";
export const PRESET_LABELS: Record<Preset, string> = {
  today: "Today", yesterday: "Yesterday", thisWeek: "This week", lastWeek: "Last week", last15: "Last 15 days", thisMonth: "This month", lastMonth: "Last month",
};

/** Weeks start on Monday, as on Indian calendars. Ranges end at the start of the day after. */
export function dashboardRange(preset: Preset, now = Date.now()): Range {
  const today = dayStart(now);
  const d = new Date(today);
  const weekStart = today - ((d.getDay() + 6) % 7) * DAY;
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  switch (preset) {
    case "today": return { from: today, to: today + DAY };
    case "yesterday": return { from: today - DAY, to: today };
    case "thisWeek": return { from: weekStart, to: today + DAY };
    case "lastWeek": return { from: weekStart - 7 * DAY, to: weekStart };
    case "last15": return { from: today - 14 * DAY, to: today + DAY };
    case "thisMonth": return { from: monthStart, to: today + DAY };
    case "lastMonth": return { from: new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), to: monthStart };
  }
}

/** Order types grouped the way owners talk about them. */
export const CHANNELS: { key: string; label: string; types: OrderType[] }[] = [
  { key: "dine", label: "Dine-in", types: ["dine-in"] },
  { key: "pickup", label: "Takeaway", types: ["takeaway"] },
  { key: "delivery", label: "Delivery", types: ["delivery"] },
  { key: "aggregator", label: "Swiggy & Zomato", types: ["swiggy", "zomato"] },
];

export interface Overview {
  net: number;
  bills: number;
  average: number;
  purchases: number;
  channels: { key: string; label: string; net: number; bills: number; share: number }[];
  leakage: { cancelledBills: number; cancelledValue: number; cancelledKots: number; discountedBills: number; complimentaryBills: number; dueBills: number; dueValue: number };
  discounts: { total: number; pos: number; guest: number };
  taxes: { cgst: number; sgst: number; total: number };
  breakup: { pos: number; guest: number };
  payments: { mode: string; label: string; amount: number; share: number }[];
}

export function businessOverview(orders: Order[], kots: Kot[], stock: StockEntry[], range: Range): Overview {
  const within = <T extends { createdAt: number }>(rows: T[]) => rows.filter((r) => r.createdAt >= range.from && r.createdAt < range.to);
  const inRange = within(orders);
  const s = salesSummary(inRange);
  const settled = inRange.filter((o) => o.status === "settled");
  const guest = settled.filter((o) => o.source === "qr" || o.source === "online");
  const sum = (rows: Order[], pick: (o: Order) => number) => r2(rows.reduce((t, o) => t + pick(o), 0));
  const channels = CHANNELS.map((c) => {
    const rows = settled.filter((o) => c.types.includes(o.orderType));
    const net = sum(rows, (o) => o.total);
    return { key: c.key, label: c.label, net, bills: rows.length, share: s.net ? net / s.net : 0 };
  });
  const dues = settled.filter((o) => o.payments.some((p) => p.mode === "credit"));
  const payments = (Object.entries(s.byPayment) as [PaymentMode, number][])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([mode, amount]) => ({ mode, label: paymentLabel(mode), amount, share: s.net ? amount / s.net : 0 }));
  const purchases = r2(stock.filter((e) => e.type === "purchase" && e.at >= range.from && e.at < range.to)
    .reduce((t, e) => t + e.items.reduce((u, i) => u + i.qty * (i.unitCost ?? 0), 0), 0));
  return {
    net: s.net,
    bills: s.bills,
    average: s.average,
    purchases,
    channels,
    leakage: {
      cancelledBills: s.voids,
      cancelledValue: s.voidValue,
      cancelledKots: within(kots).filter((k) => k.kind === "cancel").length,
      discountedBills: settled.filter((o) => o.discountAmt > 0 && o.discountPct < 100).length,
      complimentaryBills: settled.filter((o) => o.lines.length > 0 && (o.discountPct >= 100 || (o.total === 0 && o.subtotal > 0))).length,
      dueBills: dues.length,
      dueValue: r2(dues.reduce((t, o) => t + o.payments.filter((p) => p.mode === "credit").reduce((u, p) => u + p.amount, 0), 0)),
    },
    discounts: { total: s.discounts, pos: r2(s.discounts - sum(guest, (o) => o.discountAmt)), guest: sum(guest, (o) => o.discountAmt) },
    taxes: { cgst: s.cgst, sgst: s.sgst, total: r2(s.cgst + s.sgst) },
    breakup: { pos: r2(s.net - sum(guest, (o) => o.total)), guest: sum(guest, (o) => o.total) },
    payments,
  };
}

export interface LiveCard {
  key: string;
  title: string;
  kind: "table" | "pickup";
  since: number;
  guestName?: string;
  guestPhone?: string;
  lines: { name: string; qty: number }[];
  total: number;
  billNo: string;
}

/** Running (held) bills as cards, oldest first, with each dish's quantity added up. */
export function liveStatus(orders: Order[]): { cards: LiveCard[]; total: number } {
  const cards = orders.filter((o) => o.status === "held" && o.lines.length > 0).sort((a, b) => a.createdAt - b.createdAt).map((o): LiveCard => {
    const qty = new Map<string, number>();
    for (const l of o.lines) qty.set(l.name, (qty.get(l.name) ?? 0) + l.qty);
    const pickupName = o.guestCodes?.[0] ? `${o.guestCodes[0]}${o.customer?.name ? ` ${o.customer.name}` : ""}` : o.customer?.name;
    return {
      key: o.uid ?? o.billNo,
      title: o.tableId ? `Table ${o.tableLabel ?? o.tableId}` : pickupName ?? (o.orderType === "takeaway" ? "Takeaway" : o.orderType === "delivery" ? "Delivery" : o.orderType),
      kind: o.tableId ? "table" : "pickup",
      since: o.createdAt,
      ...(o.customer?.name ? { guestName: o.customer.name } : {}),
      ...(o.customer?.phone ? { guestPhone: o.customer.phone } : {}),
      lines: [...qty.entries()].map(([name, n]) => ({ name, qty: n })),
      total: o.total,
      billNo: o.billNo,
    };
  });
  return { cards, total: r2(cards.reduce((t, c) => t + c.total, 0)) };
}

/** Net sales for each day of the range, including days with none. */
export function salesByDay(orders: Order[], range: Range): { day: number; net: number; bills: number }[] {
  const out: { day: number; net: number; bills: number }[] = [];
  for (let d = dayStart(range.from); d < range.to; d = dayStart(d + DAY + 3_600_000)) out.push({ day: d, net: 0, bills: 0 });
  const index = new Map(out.map((r, i) => [r.day, i]));
  for (const o of orders) {
    if (o.status !== "settled" || o.createdAt < range.from || o.createdAt >= range.to) continue;
    const row = out[index.get(dayStart(o.createdAt)) ?? -1];
    if (row) { row.net = r2(row.net + o.total); row.bills += 1; }
  }
  return out;
}
