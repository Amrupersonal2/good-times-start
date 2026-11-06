/**
 * Sales Summary: one row per bill with filters, a totals strip and an Excel
 * sheet, like a back-office sales report. Pure, tested.
 */
import type { Order, PaymentMode } from "./types";
import { paymentLabel, seriesOf } from "./report-logic";
import type { Column, CellValue, SheetSpec } from "./xlsx";

export interface SummaryFilters {
  billNo: string;
  orderType: "" | Order["orderType"];
  payment: "" | PaymentMode | "split";
  status: "" | Order["status"];
  series: string;
}
export const NO_FILTERS: SummaryFilters = { billNo: "", orderType: "", payment: "", status: "", series: "" };

export const ORDER_TYPE_LABELS: Record<Order["orderType"], string> = { "dine-in": "Dine-in", takeaway: "Takeaway", delivery: "Delivery", swiggy: "Swiggy", zomato: "Zomato" };
export const STATUS_LABELS: Record<Order["status"], string> = { settled: "Complete", held: "Running", void: "Cancelled" };

export function paymentOf(o: Order): string {
  const modes = [...new Set(o.payments.filter((p) => p.amount > 0).map((p) => p.mode))];
  if (!modes.length) return o.status === "held" ? "Unpaid" : "—";
  return modes.length > 1 ? "Split" : paymentLabel(modes[0] as PaymentMode);
}

export function filterBills(orders: Order[], f: SummaryFilters): Order[] {
  const term = f.billNo.trim().toLowerCase();
  return orders.filter((o) => {
    if (term && !o.billNo.toLowerCase().includes(term) && !(o.customer?.phone ?? "").includes(term)) return false;
    if (f.orderType && o.orderType !== f.orderType) return false;
    if (f.status && o.status !== f.status) return false;
    if (f.series && seriesOf(o.billNo) !== f.series) return false;
    if (f.payment) {
      const modes = new Set(o.payments.filter((p) => p.amount > 0).map((p) => p.mode));
      if (f.payment === "split" ? modes.size < 2 : !modes.has(f.payment)) return false;
    }
    return true;
  }).sort((a, b) => b.createdAt - a.createdAt);
}

export interface SummaryTotals { sales: number; orders: number; discount: number; charges: number; tax: number; foodSale: number; cancelled: number; cancelledValue: number }

/** Money totals count completed bills only; cancelled bills are counted separately. */
export function summaryTotals(bills: Order[]): SummaryTotals {
  const done = bills.filter((o) => o.status === "settled");
  const sum = (f: (o: Order) => number) => Math.round(done.reduce((s, o) => s + f(o), 0) * 100) / 100;
  const voids = bills.filter((o) => o.status === "void");
  return {
    sales: sum((o) => o.total),
    orders: done.length,
    discount: sum((o) => o.discountAmt),
    charges: sum((o) => o.serviceCharge ?? 0),
    tax: sum((o) => o.cgst + o.sgst),
    foodSale: sum((o) => o.subtotal - o.discountAmt),
    cancelled: voids.length,
    cancelledValue: Math.round(voids.reduce((s, o) => s + o.total, 0) * 100) / 100,
  };
}

export interface SummaryOptions { items: boolean; tax: boolean; split: boolean }

/** Amount still owed on the bill (paid as Due / pay later). */
export const balanceOf = (o: Order) => o.payments.filter((p) => p.mode === "credit").reduce((s, p) => s + p.amount, 0);
export const itemsOf = (o: Order) => o.lines.map((l) => `${l.qty} × ${l.name}`).join(", ");

export function summarySheet(bills: Order[], opts: SummaryOptions, restaurant: string, rangeLabel: string): SheetSpec {
  const modes = opts.split ? [...new Set(bills.flatMap((o) => o.payments.map((p) => p.mode)))] : [];
  const columns: Column[] = [
    { header: "Bill", format: "text" }, { header: "Date", format: "datetime" }, { header: "Type" }, { header: "Customer" }, { header: "Mobile", format: "text" },
    { header: "Table" }, { header: "Status" }, { header: "Payment mode" },
    { header: "Subtotal", format: "inr", total: true }, { header: "Charges", format: "inr", total: true }, { header: "Discount", format: "inr", total: true }, { header: "Discount %", format: "pct" },
    ...(opts.tax ? [{ header: "CGST", format: "inr", total: true }, { header: "SGST", format: "inr", total: true }] as Column[] : []),
    { header: "Total tax", format: "inr", total: true }, { header: "Total", format: "inr", total: true }, { header: "Balance", format: "inr", total: true }, { header: "Settled by" },
    ...modes.map((m): Column => ({ header: paymentLabel(m), format: "inr", total: true })),
    ...(opts.items ? [{ header: "Items", width: 60 }] as Column[] : []),
  ];
  const rows: CellValue[][] = bills.map((o) => {
    const counts = o.status === "settled";
    const money = (n: number) => (counts ? n : 0);
    return [
      o.billNo, new Date(o.createdAt), ORDER_TYPE_LABELS[o.orderType], o.customer?.name ?? "", o.customer?.phone ?? "",
      o.tableLabel ?? "", STATUS_LABELS[o.status], paymentOf(o),
      money(o.subtotal), money(o.serviceCharge ?? 0), money(o.discountAmt), o.discountPct / 100,
      ...(opts.tax ? [money(o.cgst), money(o.sgst)] : []),
      money(o.cgst + o.sgst), money(o.total), money(balanceOf(o)), o.closedBy ?? "",
      ...modes.map((m) => money(o.payments.filter((p) => p.mode === m).reduce((s, p) => s + p.amount, 0))),
      ...(opts.items ? [itemsOf(o)] : []),
    ];
  });
  return {
    name: "Sales Summary", title: `${restaurant} — Sales Summary`, subtitle: rangeLabel, columns, rows, totals: true,
    notes: ["Money columns count completed bills only; cancelled and running bills show as 0."],
  };
}
