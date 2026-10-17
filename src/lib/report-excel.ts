import { categorySales, gstByRate, itemSales, paymentLabel, salesSummary, staffSales, untaxedSales, type Range } from "./report-logic";
import type { Customer, DayClose, MenuItem, Order } from "./types";
import type { CustomerStats } from "./customer-logic";
import type { SheetSpec } from "./xlsx";

const ORDER_TYPE: Record<string, string> = { "dine-in": "Dine-in", takeaway: "Takeaway", delivery: "Delivery", swiggy: "Swiggy", zomato: "Zomato" };
const STATUS: Record<Order["status"], string> = { settled: "Settled", held: "Running", void: "Void" };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function rangeLabel(range: Range): string {
  const f = (t: number) => new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  return f(range.from) === f(range.to) ? f(range.from) : `${f(range.from)} to ${f(range.to)}`;
}

/** Every report for a period as one workbook. */
export function reportsWorkbook(orders: Order[], menu: MenuItem[], closes: DayClose[], range: Range, restaurant: string): SheetSpec[] {
  const when = rangeLabel(range);
  const s = salesSummary(orders);
  const untaxed = untaxedSales(orders);
  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt);
  const items = itemSales(orders, menu);

  return [
    {
      name: "Summary", title: `${restaurant || "Restaurant"} — sales summary`, subtitle: when,
      columns: [{ header: "Measure", width: 34 }, { header: "Value", format: "inr" }],
      rows: [
        ["Net sales (incl. GST)", s.net], ["Bills", s.bills], ["Average bill", s.average], ["Gross (menu value)", s.gross],
        ["Discounts", s.discounts], ["Service charge", s.serviceCharge], ["Taxable value", s.taxable], ["CGST", s.cgst], ["SGST", s.sgst],
        ["Round off", s.roundOff], ["Swiggy/Zomato sales (GST paid by them)", untaxed.aggregator], ["Sales without GST", untaxed.other],
        ["Void bills", s.voids], ["Value of void bills", s.voidValue],
      ],
      notes: ["Bills and Void bills are counts; every other row is in rupees."],
    },
    {
      name: "Bills", title: "Bills", subtitle: when, totals: true,
      columns: [
        { header: "Bill", width: 16 }, { header: "Date & time", format: "datetime" }, { header: "Type" }, { header: "Table" }, { header: "Status" },
        { header: "Guest", width: 18 }, { header: "Phone" }, { header: "Guest GSTIN", width: 17 },
        { header: "Subtotal", format: "inr", total: true }, { header: "Discount", format: "inr", total: true }, { header: "Service charge", format: "inr", total: true },
        { header: "Taxable", format: "inr", total: true }, { header: "CGST", format: "inr", total: true }, { header: "SGST", format: "inr", total: true },
        { header: "Round off", format: "inr", total: true }, { header: "Total", format: "inr", total: true }, { header: "Paid by", width: 22 },
        { header: "Settled by" }, { header: "Void reason", width: 24 }, { header: "Rating", format: "int" },
      ],
      rows: sorted.map((o) => {
        const counts = o.status === "settled";
        return [
          o.billNo, o.createdAt, ORDER_TYPE[o.orderType] ?? o.orderType, o.tableLabel ?? o.tableId ?? "", STATUS[o.status],
          o.customer?.name ?? "", o.customer?.phone ?? "", o.customer?.gstin ?? "",
          counts ? o.subtotal : 0, counts ? o.discountAmt : 0, counts ? o.serviceCharge ?? 0 : 0,
          counts ? o.taxable ?? r2(o.subtotal - o.discountAmt) : 0, counts ? o.cgst : 0, counts ? o.sgst : 0, counts ? o.roundOff : 0, counts ? o.total : 0,
          o.payments.map((p) => `${paymentLabel(p.mode)} ${p.amount}`).join(", "), o.closedBy ?? "", o.voidReason ?? "", o.feedback?.rating ?? null,
        ];
      }),
      notes: ["Money columns count settled bills only; void and running bills show 0 so the totals equal your sales."],
    },
    {
      name: "Bill items", title: "Items on every settled bill", subtitle: when, totals: true,
      columns: [{ header: "Bill", width: 16 }, { header: "Date", format: "datetime" }, { header: "Dish", width: 40 }, { header: "Qty", format: "int", total: true }, { header: "Price", format: "inr" }, { header: "Amount", format: "inr", total: true }, { header: "GST %", format: "int" }, { header: "Station" }, { header: "Note", width: 20 }],
      rows: sorted.filter((o) => o.status === "settled").flatMap((o) => o.lines.map((l) => [o.billNo, o.createdAt, l.name, l.qty, l.price, r2(l.price * l.qty), l.gstRate, l.station, l.note ?? ""])),
    },
    {
      name: "Dishes", title: "Dishes sold", subtitle: `${when}. Sales after discount, before GST.`, totals: true,
      columns: [{ header: "Dish", width: 40 }, { header: "Category", width: 24 }, { header: "Qty", format: "int", total: true }, { header: "Sales", format: "inr", total: true }],
      rows: items.map((i) => [i.name, i.category, i.qty, i.amount]),
    },
    {
      name: "Categories", title: "Sales by menu section", subtitle: when, totals: true,
      columns: [{ header: "Section", width: 28 }, { header: "Qty", format: "int", total: true }, { header: "Sales", format: "inr", total: true }],
      rows: categorySales(items).map((c) => [c.category, c.qty, c.amount]),
    },
    {
      name: "Payments", title: "Payments and order types", subtitle: when, totals: true,
      columns: [{ header: "Payment mode", width: 22 }, { header: "Amount", format: "inr", total: true }, { header: "Share", format: "pct" }],
      rows: Object.entries(s.byPayment).sort((a, b) => b[1] - a[1]).map(([m, v]) => [paymentLabel(m), v, s.net ? v / s.net : 0]),
    },
    {
      name: "Order types", title: "Sales by order type", subtitle: when, totals: true,
      columns: [{ header: "Order type", width: 22 }, { header: "Bills", format: "int", total: true }, { header: "Sales", format: "inr", total: true }],
      rows: Object.entries(s.byOrderType).sort((a, b) => b[1].net - a[1].net).map(([t, v]) => [ORDER_TYPE[t] ?? t, v.bills, v.net]),
    },
    {
      name: "GST by rate", title: "GST by rate", subtitle: `${when}. For filing, use the GSTR-1 download.`, totals: true,
      columns: [{ header: "GST rate %", format: "int" }, { header: "Taxable value", format: "inr", total: true }, { header: "CGST", format: "inr", total: true }, { header: "SGST", format: "inr", total: true }],
      rows: gstByRate(orders).map((g) => [g.rate, g.taxable, g.cgst, g.sgst]),
    },
    {
      name: "Staff", title: "Bills by staff", subtitle: when, totals: true,
      columns: [{ header: "Settled by", width: 24 }, { header: "Bills", format: "int", total: true }, { header: "Sales", format: "inr", total: true }, { header: "Voids", format: "int", total: true }],
      rows: staffSales(orders).map((x) => [x.name, x.bills, x.net, x.voids]),
    },
    {
      name: "Day closes", title: "Cash drawer closes", subtitle: when,
      columns: [{ header: "Day" }, { header: "Counter" }, { header: "Bills", format: "int" }, { header: "Sales", format: "inr" }, { header: "Opening float", format: "inr" }, { header: "Cash expected", format: "inr" }, { header: "Cash counted", format: "inr" }, { header: "Difference", format: "inr" }, { header: "Closed by" }, { header: "Note", width: 30 }],
      rows: [...closes].sort((a, b) => a.day.localeCompare(b.day) || a.series.localeCompare(b.series)).map((c) => [c.day, c.series, c.bills, c.net, c.openingCash, c.expectedCash, c.countedCash, r2(c.countedCash - c.expectedCash), c.closedBy ?? "", c.note ?? ""]),
    },
  ];
}

/** Guest directory with visits, spend, points and dues. */
export function guestsWorkbook(rows: { customer: Customer; stats: CustomerStats }[], restaurant: string): SheetSpec[] {
  return [{
    name: "Guests", title: `${restaurant || "Restaurant"} — guests`, subtitle: new Date().toLocaleDateString("en-IN"), totals: true,
    columns: [{ header: "Name", width: 24 }, { header: "Phone" }, { header: "Visits", format: "int", total: true }, { header: "Spent", format: "inr", total: true }, { header: "Last visit", format: "date" }, { header: "Points", format: "int", total: true }, { header: "Due", format: "inr", total: true }, { header: "Average rating" }, { header: "Note", width: 30 }],
    rows: [...rows].sort((a, b) => b.stats.spent - a.stats.spent).map(({ customer: c, stats: x }) => [c.name ?? "", c.phone, x.visits, x.spent, x.lastVisit, x.points, x.due, x.averageRating, c.note ?? ""]),
  }];
}
