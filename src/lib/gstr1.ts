import { RESTAURANT_SAC, gstModeOf, placeOfSupply } from "./billing-config";
import { orderRateBuckets, seqOf, seriesOf, untaxedSales } from "./report-logic";
import type { Order, RestaurantSettings } from "./types";
import type { SheetSpec } from "./xlsx";

/**
 * GSTR-1 workbook from POS bills, laid out like the GST portal's offline
 * tool sheets (b2b, b2cs, hsn, docs) so rows can be pasted straight in,
 * plus a Summary and the Table 14 sales made through Swiggy/Zomato.
 */

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** GST portal date style: 17-Oct-2026 */
export function gstDate(at: number): string {
  const d = new Date(at);
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const isB2b = (o: Order) => GSTIN_RE.test((o.customer?.gstin ?? "").trim().toUpperCase());

export interface Gstr1Totals {
  b2bInvoices: number;
  b2bTaxable: number;
  b2csTaxable: number;
  tax: number;
  aggregatorValue: number;
  untaxedValue: number;
  documents: number;
  cancelled: number;
}

export function gstr1Workbook(orders: Order[], settings: RestaurantSettings, period: string): { sheets: SheetSpec[]; totals: Gstr1Totals } {
  const pos = placeOfSupply(settings.gstin);
  const settled = orders.filter((o) => o.status === "settled").sort((a, b) => a.createdAt - b.createdAt);
  const regular = gstModeOf(settings) === "regular";

  /* b2b: one row per rate per invoice */
  const b2bRows: (string | number)[][] = [];
  let b2bTaxable = 0;
  let tax = 0;
  const b2bInvoices = new Set<string>();
  for (const o of settled.filter(isB2b)) {
    for (const [rate, value] of [...orderRateBuckets(o)].sort(([a], [b]) => a - b)) {
      b2bRows.push([o.customer!.gstin!.trim().toUpperCase(), o.customer?.name ?? "", o.billNo, gstDate(o.createdAt), o.total, pos, "N", "", "Regular B2B", "", rate, r2(value), 0]);
      b2bTaxable += value;
      tax += (value * rate) / 100;
      b2bInvoices.add(o.billNo);
    }
  }

  /* b2cs: totals per place of supply and rate */
  const b2cs = new Map<number, number>();
  for (const o of settled.filter((x) => !isB2b(x))) {
    for (const [rate, value] of orderRateBuckets(o)) b2cs.set(rate, (b2cs.get(rate) ?? 0) + value);
  }
  const b2csRows = [...b2cs].sort(([a], [b]) => a - b).map(([rate, value]) => {
    tax += (value * rate) / 100;
    return ["OE", pos, "", rate, r2(value), 0, ""];
  });
  const b2csTaxable = [...b2cs.values()].reduce((s, v) => s + v, 0);

  /* HSN (SAC) summaries, B2B and B2C separately as the portal now asks */
  const sac = settings.sac || RESTAURANT_SAC;
  const hsnRows = (subset: Order[]) => {
    const byRate = new Map<number, { taxable: number; value: number }>();
    for (const o of subset) {
      const buckets = orderRateBuckets(o);
      const billTaxable = [...buckets.values()].reduce((s, v) => s + v, 0);
      for (const [rate, value] of buckets) {
        const row = byRate.get(rate) ?? { taxable: 0, value: 0 };
        row.taxable += value;
        // Invoice value shared by rate, so each row's total value includes its own tax.
        row.value += billTaxable > 0 ? o.total * (value / billTaxable) : 0;
        byRate.set(rate, row);
      }
    }
    return [...byRate].sort(([a], [b]) => a - b).map(([rate, v]) => {
      const half = r2((v.taxable * rate) / 200);
      return [sac, "Restaurant service", "NA", 0, r2(v.value), rate, r2(v.taxable), 0, half, half, 0];
    });
  };

  /* documents issued, per bill series */
  const issued = orders.filter((o) => (o.status === "settled" || o.status === "void") && o.billNo);
  const series = new Map<string, Order[]>();
  for (const o of issued) series.set(seriesOf(o.billNo), [...(series.get(seriesOf(o.billNo)) ?? []), o]);
  const docRows = [...series].sort(([a], [b]) => a.localeCompare(b)).map(([, list]) => {
    const sorted = [...list].sort((a, b) => seqOf(a.billNo) - seqOf(b.billNo));
    const unique = new Map(sorted.map((o) => [o.billNo, o]));
    const cancelled = [...unique.values()].filter((o) => o.status === "void").length;
    return [regular ? "Invoices for outward supply" : "Bill of supply", sorted[0]!.billNo, sorted[sorted.length - 1]!.billNo, unique.size, cancelled];
  });

  /* Table 14(b): sales through e-commerce operators who pay tax under 9(5) */
  const eco = new Map<string, number>();
  for (const o of settled) {
    if ((o.orderType === "swiggy" || o.orderType === "zomato") && o.tax?.exempt) {
      const name = o.orderType === "swiggy" ? "Swiggy (Bundl Technologies)" : "Zomato";
      eco.set(name, (eco.get(name) ?? 0) + (o.taxable ?? o.total));
    }
  }
  const ecoRows = [...eco].map(([name, value]) => ["Restaurant service, tax paid by operator u/s 9(5)", name, "", r2(value)]);

  const untaxed = untaxedSales(orders);
  const totals: Gstr1Totals = {
    b2bInvoices: b2bInvoices.size,
    b2bTaxable: r2(b2bTaxable),
    b2csTaxable: r2(b2csTaxable),
    tax: r2(tax),
    aggregatorValue: untaxed.aggregator,
    untaxedValue: untaxed.other,
    documents: docRows.reduce((s, r) => s + Number(r[3]), 0),
    cancelled: docRows.reduce((s, r) => s + Number(r[4]), 0),
  };

  const summary: SheetSpec = {
    name: "Summary",
    title: `GSTR-1 — ${settings.legalName || settings.name || "Restaurant"}`,
    subtitle: `GSTIN ${settings.gstin || "not set"}, ${period}. Place of supply ${pos}.`,
    columns: [{ header: "Section", width: 46 }, { header: "Invoices / rows", format: "int" }, { header: "Taxable value", format: "inr" }, { header: "CGST + SGST", format: "inr" }],
    rows: [
      ["4A — B2B invoices (guests with a GSTIN)", b2bInvoices.size, r2(b2bTaxable), r2(b2bRows.reduce((s, r) => s + (Number(r[11]) * Number(r[10])) / 100, 0))],
      ["7 — B2C small (all other bills)", b2csRows.length, r2(b2csTaxable), r2(b2csRows.reduce((s, r) => s + (Number(r[4]) * Number(r[3])) / 100, 0))],
      ["14(b) — through Swiggy/Zomato, tax paid by them", ecoRows.length, totals.aggregatorValue, 0],
      ["Bills with no GST (composition / unregistered)", null, totals.untaxedValue, 0],
      ["13 — Documents issued", totals.documents, null, null],
      ["13 — of which cancelled", totals.cancelled, null, null],
    ],
    notes: [
      "Prepared by XTSY POS from synced bills. Check every figure with your accountant before filing.",
      "b2b, b2cs, hsn(b2b), hsn(b2c) and docs sheets use the GST offline tool's column order; paste rows below its headers.",
      "Restaurant service is intra-state (CGST + SGST). Rates come from each dish's GST rate.",
    ],
  };

  const sheets: SheetSpec[] = [
    summary,
    {
      name: "b2b",
      columns: [
        { header: "GSTIN/UIN of Recipient", width: 18 }, { header: "Receiver Name", width: 24 }, { header: "Invoice Number", width: 16 }, { header: "Invoice date", width: 13 },
        { header: "Invoice Value", format: "inr" }, { header: "Place Of Supply", width: 16 }, { header: "Reverse Charge" }, { header: "Applicable % of Tax Rate" },
        { header: "Invoice Type", width: 14 }, { header: "E-Commerce GSTIN" }, { header: "Rate", format: "int" }, { header: "Taxable Value", format: "inr" }, { header: "Cess Amount", format: "inr" },
      ],
      rows: b2bRows,
    },
    {
      name: "b2cs",
      columns: [{ header: "Type" }, { header: "Place Of Supply", width: 16 }, { header: "Applicable % of Tax Rate" }, { header: "Rate", format: "int" }, { header: "Taxable Value", format: "inr" }, { header: "Cess Amount", format: "inr" }, { header: "E-Commerce GSTIN" }],
      rows: b2csRows,
    },
    ...(["b2b", "b2c"] as const).map((kind): SheetSpec => ({
      name: `hsn(${kind})`,
      columns: [
        { header: "HSN" }, { header: "Description", width: 20 }, { header: "UQC" }, { header: "Total Quantity", format: "int" }, { header: "Total Value", format: "inr" }, { header: "Rate", format: "int" },
        { header: "Taxable Value", format: "inr" }, { header: "Integrated Tax Amount", format: "inr" }, { header: "Central Tax Amount", format: "inr" }, { header: "State/UT Tax Amount", format: "inr" }, { header: "Cess Amount", format: "inr" },
      ],
      rows: hsnRows(settled.filter((o) => (kind === "b2b" ? isB2b(o) : !isB2b(o)))),
    })),
    {
      name: "docs",
      columns: [{ header: "Nature of Document", width: 30 }, { header: "Sr. No. From", width: 16 }, { header: "Sr. No. To", width: 16 }, { header: "Total Number", format: "int" }, { header: "Cancelled", format: "int" }],
      rows: docRows,
    },
    {
      name: "eco 9(5)",
      title: "Table 14(b) — supplies through e-commerce operators liable to pay tax u/s 9(5)",
      subtitle: "Fill in each operator's GSTIN for your state.",
      columns: [{ header: "Nature of supply", width: 46 }, { header: "E-commerce operator", width: 28 }, { header: "GSTIN of operator", width: 18 }, { header: "Net value of supplies", format: "inr" }],
      rows: ecoRows,
    },
  ];
  return { sheets, totals };
}
