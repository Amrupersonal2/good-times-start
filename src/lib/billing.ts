import type { CartLine } from "./types";

/** Indian number format: ₹1,23,456.00 */
export function formatINR(n: number, decimals = 2): string {
  return (
    "₹" +
    n.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  );
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BillTotals {
  subtotal: number;
  discountAmt: number;
  taxable: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
}

/** GST-exclusive billing: discount applied pro-rata, tax split equally into CGST + SGST, round-off to nearest rupee. */
export function computeTotals(lines: CartLine[], discountPct = 0): BillTotals {
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const factor = 1 - Math.min(Math.max(discountPct, 0), 100) / 100;
  const discountAmt = r2(subtotal - subtotal * factor);
  let tax = 0;
  for (const l of lines) tax += l.price * l.qty * factor * (l.gstRate / 100);
  const half = r2(tax / 2);
  const taxable = r2(subtotal - discountAmt);
  const raw = taxable + half * 2;
  const total = Math.round(raw);
  return { subtotal, discountAmt, taxable, cgst: half, sgst: half, roundOff: r2(total - raw), total };
}

/** Indian financial year label, e.g. Oct 2026 -> "26-27", Feb 2026 -> "25-26". */
export function financialYear(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

export function billNumber(seq: number, d: Date, device = "D1"): string {
  return `INV/${financialYear(d)}/${device}/${String(seq).padStart(4, "0")}`;
}

export function upiLink(opts: { vpa: string; name: string; amount: number; billNo: string }): string {
  const p = new URLSearchParams({
    pa: opts.vpa,
    pn: opts.name,
    am: opts.amount.toFixed(2),
    cu: "INR",
    tn: `Bill ${opts.billNo}`,
  });
  return `upi://pay?${p.toString()}`;
}
