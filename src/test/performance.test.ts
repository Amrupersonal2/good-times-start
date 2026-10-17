import { describe, expect, it } from "vitest";
import { computeTotals } from "@/lib/billing";
import { customerStats, ordersByCustomer } from "@/lib/customer-logic";
import { gstr1Workbook } from "@/lib/gstr1";
import { menuWorkbook } from "@/lib/menu-excel";
import { gstByRate, itemSales, salesSummary, staffSales } from "@/lib/report-logic";
import { consumptionFor } from "@/lib/stock-logic";
import { buildXlsx } from "@/lib/xlsx";
import { TAB_MATERIALS, TAB_MENU } from "@/data/tab-bistro";
import type { CartLine, Order } from "@/lib/types";

/**
 * Speed budgets for a busy restaurant's year: ~60,000 bills, 3,000 guests.
 * Budgets are several times what a mid-range laptop needs, so they catch
 * accidental slow-downs (like comparing every guest with every bill)
 * without failing on a slow CI machine.
 */

const time = (fn: () => unknown) => { const t = performance.now(); fn(); return performance.now() - t; };

function yearOfBills(count: number): Order[] {
  const start = new Date(2026, 3, 1).getTime();
  const menu = TAB_MENU;
  const out: Order[] = [];
  for (let i = 0; i < count; i += 1) {
    const lines: CartLine[] = [];
    for (let j = 0; j < 1 + (i % 5); j += 1) {
      const m = menu[(i * 7 + j * 13) % menu.length]!;
      const v = m.variants?.[(i + j) % m.variants.length];
      lines.push({ itemId: v ? `${m.id}|v:${v.id}` : m.id, ...(v ? { menuItemId: m.id } : {}), name: m.name, price: v?.price ?? m.price, qty: 1 + ((i + j) % 3), veg: m.veg, gstRate: m.gstRate, station: m.station });
    }
    const t = computeTotals(lines, i % 10 === 0 ? 10 : 0);
    const phone = i % 3 === 0 ? `98${String(70000000 + (Math.floor(i / 3) % 3000)).padStart(8, "0")}` : undefined;
    out.push({
      uid: `u${i}`, billNo: `C${1 + (i % 3)}/26-27/${String(i).padStart(5, "0")}`, orderType: (["dine-in", "takeaway", "swiggy"] as const)[i % 3]!,
      lines, discountPct: i % 10 === 0 ? 10 : 0, ...t, payments: [{ mode: i % 2 ? "upi" : "cash", amount: t.total }],
      status: i % 97 === 0 ? "void" : "settled", createdAt: start + i * 520_000, synced: true, closedBy: `Staff ${i % 6}`,
      ...(phone ? { customer: { phone }, customerId: phone } : {}),
    });
  }
  return out;
}

const bills = yearOfBills(60_000);

describe("speed budgets", () => {
  it("adds up a bill in microseconds", () => {
    const lines = bills[42]!.lines;
    const ms = time(() => { for (let i = 0; i < 100_000; i += 1) computeTotals(lines, 5, 10, { inclusive: i % 2 === 0 }); });
    expect(ms).toBeLessThan(1500);
  });

  it("builds a year of reports quickly", () => {
    const ms = time(() => { salesSummary(bills); gstByRate(bills); itemSales(bills, TAB_MENU); staffSales(bills); });
    expect(ms).toBeLessThan(2500);
  });

  it("works out every guest's stats in one pass", () => {
    const guests = Array.from(ordersByCustomer(bills).keys()).map((id) => ({ id }));
    expect(guests.length).toBe(3000);
    const ms = time(() => {
      const grouped = ordersByCustomer(bills);
      for (const g of guests) customerStats(g, grouped.get(g.id) ?? [], 5);
    });
    expect(ms).toBeLessThan(1500);
  });

  it("works out recipe use for a busy day's bills", () => {
    const day = bills.slice(0, 400);
    const ms = time(() => { for (const b of day) consumptionFor(b.lines, TAB_MENU); });
    expect(ms).toBeLessThan(1000);
  });

  it("exports a month's GSTR-1 and a year of bills to Excel", () => {
    const month = bills.slice(0, 5_000);
    let bytes = 0;
    const ms = time(() => {
      bytes += buildXlsx(gstr1Workbook(month, { name: "TAB Bistro", gstin: "17AAACX1234A1Z5" }, "April 2026").sheets).length;
      bytes += buildXlsx([{ name: "Bills", columns: [{ header: "Bill" }, { header: "Date", format: "datetime" }, { header: "Total", format: "inr", total: true }],
        rows: bills.map((b) => [b.billNo, b.createdAt, b.total]), totals: true }]).length;
    });
    expect(bytes).toBeGreaterThan(1_000_000);
    expect(ms).toBeLessThan(6000);
  });

  it("exports the full menu with recipes and food cost", () => {
    const ms = time(() => buildXlsx(menuWorkbook(TAB_MENU, TAB_MATERIALS)));
    expect(ms).toBeLessThan(800);
  });
});
