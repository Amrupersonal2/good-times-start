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
  /** Sum of line amounts as printed on the menu (with GST when prices include it). */
  subtotal: number;
  discountAmt: number;
  /** Value before GST, after discount, excluding service charge. */
  taxable: number;
  serviceCharge: number;
  cgst: number;
  sgst: number;
  roundOff: number;
  total: number;
}

export interface TaxOptions {
  /** Menu prices already include GST; tax is worked out backwards from them. */
  inclusive?: boolean;
  /** No GST on this bill: composition scheme, unregistered, or GST paid by Swiggy/Zomato. */
  exempt?: boolean;
  /** Round the total to the nearest rupee (default) or keep paise. */
  roundToRupee?: boolean;
}

/**
 * Bill maths. Discount applies pro-rata to every line; an optional service
 * charge applies to the discounted value before GST and is taxed at the
 * bill's own effective rate (it follows the food it's charged on). Tax splits
 * equally into CGST + SGST (intra-state restaurant supply).
 */
export function computeTotals(lines: CartLine[], discountPct = 0, serviceChargePct = 0, options: TaxOptions = {}): BillTotals {
  const { inclusive = false, exempt = false, roundToRupee = true } = options;
  const subtotal = r2(lines.reduce((s, l) => s + l.price * l.qty, 0));
  const factor = 1 - Math.min(Math.max(discountPct, 0), 100) / 100;
  const discountAmt = r2(subtotal - subtotal * factor);

  let taxableExact = 0;
  let tax = 0;
  for (const l of lines) {
    const gross = l.price * l.qty * factor;
    const rate = exempt ? 0 : l.gstRate / 100;
    const value = inclusive && !exempt ? gross / (1 + rate) : gross;
    taxableExact += value;
    tax += value * rate;
  }
  const taxable = r2(taxableExact);
  const serviceCharge = r2(taxableExact * Math.min(Math.max(serviceChargePct, 0), 20) / 100);
  if (serviceCharge > 0 && taxableExact > 0) tax += serviceCharge * (tax / taxableExact);
  const half = r2(tax / 2);
  const raw = r2(taxableExact + serviceCharge + half * 2);
  const total = roundToRupee ? Math.round(raw) : raw;
  return { subtotal, discountAmt, taxable, serviceCharge, cgst: half, sgst: half, roundOff: r2(total - raw), total };
}

/** Indian financial year label, e.g. Oct 2026 -> "26-27", Feb 2026 -> "25-26". */
export function financialYear(d: Date): string {
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/**
 * GST invoice number: unique per financial year and at most 16 characters
 * (CGST Rule 46). Device series first, e.g. "C1/26-27/0001".
 */
export function billNumber(seq: number, d: Date, device = "D1"): string {
  return `${device.slice(0, 4)}/${financialYear(d)}/${String(seq).padStart(4, "0")}`;
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
