import type { MenuItem, Order, PaymentMode } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface Range { from: number; to: number }

/** Start of the local day for a timestamp. */
export function dayStart(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function presetRange(preset: "today" | "yesterday" | "7d" | "month", now = Date.now()): Range {
  const today = dayStart(now);
  const day = 24 * 60 * 60 * 1000;
  if (preset === "yesterday") return { from: today - day, to: today - 1 };
  if (preset === "7d") return { from: today - 6 * day, to: today + day - 1 };
  if (preset === "month") {
    const d = new Date(now);
    return { from: new Date(d.getFullYear(), d.getMonth(), 1).getTime(), to: today + day - 1 };
  }
  return { from: today, to: today + day - 1 };
}

export function inRange<T extends { createdAt: number }>(rows: T[], range: Range): T[] {
  return rows.filter((r) => r.createdAt >= range.from && r.createdAt <= range.to);
}

export interface SalesSummary {
  bills: number;
  gross: number;
  discounts: number;
  serviceCharge: number;
  taxable: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  net: number;
  average: number;
  voids: number;
  voidValue: number;
  byPayment: Record<string, number>;
  byOrderType: Record<string, { bills: number; net: number }>;
}

/** Sales for settled bills; voids are counted separately and never add to sales. */
export function salesSummary(orders: Order[]): SalesSummary {
  const settled = orders.filter((o) => o.status === "settled");
  const voided = orders.filter((o) => o.status === "void" && o.lines.length > 0);
  const byPayment: Record<string, number> = {};
  const byOrderType: Record<string, { bills: number; net: number }> = {};
  for (const o of settled) {
    for (const p of o.payments) byPayment[p.mode] = r2((byPayment[p.mode] ?? 0) + p.amount);
    const t = (byOrderType[o.orderType] ??= { bills: 0, net: 0 });
    t.bills += 1;
    t.net = r2(t.net + o.total);
  }
  const sum = (pick: (o: Order) => number) => r2(settled.reduce((s, o) => s + pick(o), 0));
  const net = sum((o) => o.total);
  return {
    bills: settled.length,
    gross: sum((o) => o.subtotal),
    discounts: sum((o) => o.discountAmt),
    serviceCharge: sum((o) => o.serviceCharge ?? 0),
    taxable: sum((o) => o.subtotal - o.discountAmt + (o.serviceCharge ?? 0)),
    cgst: sum((o) => o.cgst),
    sgst: sum((o) => o.sgst),
    roundOff: sum((o) => o.roundOff),
    net,
    average: settled.length ? r2(net / settled.length) : 0,
    voids: voided.length,
    voidValue: r2(voided.reduce((s, o) => s + o.total, 0)),
    byPayment,
    byOrderType,
  };
}

export interface GstRow { rate: number; taxable: number; cgst: number; sgst: number }

/**
 * Taxable value and tax by GST rate, for filing. Each line is valued after
 * the bill's discount; service charge is shown at the bill's effective rate.
 */
export function gstByRate(orders: Order[]): GstRow[] {
  const rows = new Map<number, { taxable: number; tax: number }>();
  const add = (rate: number, taxable: number) => {
    const row = rows.get(rate) ?? { taxable: 0, tax: 0 };
    row.taxable += taxable;
    row.tax += taxable * rate / 100;
    rows.set(rate, row);
  };
  for (const o of orders.filter((x) => x.status === "settled")) {
    const factor = 1 - Math.min(Math.max(o.discountPct, 0), 100) / 100;
    let foodTaxable = 0;
    let foodTax = 0;
    for (const l of o.lines) {
      const value = l.price * l.qty * factor;
      add(l.gstRate, value);
      foodTaxable += value;
      foodTax += value * l.gstRate / 100;
    }
    const sc = o.serviceCharge ?? 0;
    if (sc > 0 && foodTaxable > 0) add(Math.round((foodTax / foodTaxable) * 10000) / 100, sc);
  }
  return [...rows]
    .sort(([a], [b]) => a - b)
    .map(([rate, v]) => ({ rate, taxable: r2(v.taxable), cgst: r2(v.tax / 2), sgst: r2(v.tax / 2) }));
}

export interface ItemRow { name: string; category: string; qty: number; amount: number }

/** Quantity and sales value per dish (portions listed separately), most sold first. */
export function itemSales(orders: Order[], menu: MenuItem[]): ItemRow[] {
  const categoryOf = new Map(menu.map((m) => [m.id, m.category]));
  const rows = new Map<string, ItemRow>();
  for (const o of orders.filter((x) => x.status === "settled")) {
    const factor = 1 - Math.min(Math.max(o.discountPct, 0), 100) / 100;
    for (const l of o.lines) {
      const row = rows.get(l.name) ?? { name: l.name, category: categoryOf.get(l.menuItemId ?? l.itemId) ?? "Other", qty: 0, amount: 0 };
      row.qty += l.qty;
      row.amount = r2(row.amount + l.price * l.qty * factor);
      rows.set(l.name, row);
    }
  }
  return [...rows.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount);
}

export function categorySales(items: ItemRow[]): { category: string; qty: number; amount: number }[] {
  const rows = new Map<string, { category: string; qty: number; amount: number }>();
  for (const i of items) {
    const row = rows.get(i.category) ?? { category: i.category, qty: 0, amount: 0 };
    row.qty += i.qty;
    row.amount = r2(row.amount + i.amount);
    rows.set(i.category, row);
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount);
}

/** Bills settled and voided per staff member. */
export function staffSales(orders: Order[]): { name: string; bills: number; net: number; voids: number }[] {
  const rows = new Map<string, { name: string; bills: number; net: number; voids: number }>();
  for (const o of orders) {
    const name = o.closedBy || "Not recorded";
    const row = rows.get(name) ?? { name, bills: 0, net: 0, voids: 0 };
    if (o.status === "settled") { row.bills += 1; row.net = r2(row.net + o.total); }
    if (o.status === "void" && o.lines.length) row.voids += 1;
    rows.set(name, row);
  }
  return [...rows.values()].filter((r) => r.bills || r.voids).sort((a, b) => b.net - a.net);
}

/** Sales per day across a range (every day present, even with no sales). */
export function dailySales(orders: Order[], range: Range): { day: string; net: number }[] {
  const out: { day: string; net: number }[] = [];
  const totals = new Map<string, number>();
  for (const o of orders.filter((x) => x.status === "settled")) totals.set(dayKey(o.createdAt), r2((totals.get(dayKey(o.createdAt)) ?? 0) + o.total));
  for (let t = dayStart(range.from); t <= range.to; t = dayStart(t + 36 * 60 * 60 * 1000)) out.push({ day: dayKey(t), net: totals.get(dayKey(t)) ?? 0 });
  return out;
}

export function hourlySales(orders: Order[]): { hour: number; net: number }[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, net: 0 }));
  for (const o of orders.filter((x) => x.status === "settled")) hours[new Date(o.createdAt).getHours()]!.net = r2(hours[new Date(o.createdAt).getHours()]!.net + o.total);
  return hours;
}

/** The bill series code inside a bill number: INV/26-27/C1/0007 → C1. */
export function seriesOf(billNo: string): string {
  return billNo.split("/")[2] ?? "";
}

/** Cash that should be in one counter's drawer: opening float plus cash kept on that counter's bills. */
export function expectedCash(orders: Order[], series: string, openingCash: number, duesCollectedInCash = 0): number {
  const cash = orders
    .filter((o) => o.status === "settled" && seriesOf(o.billNo) === series)
    .reduce((s, o) => s + o.payments.filter((p) => p.mode === "cash").reduce((t, p) => t + p.amount, 0), 0);
  return r2(openingCash + cash + duesCollectedInCash);
}

const csvCell = (value: unknown) => {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows: (string | number | undefined)[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function paymentLabel(mode: PaymentMode | string): string {
  return ({ cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet", credit: "Due", points: "Points" } as Record<string, string>)[mode] ?? mode;
}
