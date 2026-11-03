import { businessOverview } from "./dashboard-logic";
import { gstr1Workbook } from "./gstr1";
import type { Order, RestaurantSettings } from "./types";

const inr = (n: number) => `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const cell = (v: unknown) => (v == null ? "" : typeof v === "number" ? v.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(v));

/** Builds a GSTR-1 PDF: Dashboard revenue + payment totals, then every GSTR-1 section. */
export async function gstr1Pdf(orders: Order[], settings: RestaurantSettings, period: string): Promise<Blob> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const settled = orders.filter((o) => o.status === "settled");
  const from = Math.min(...settled.map((o) => o.createdAt), Date.now());
  const ov = businessOverview(orders, [], [], { from, to: Date.now() + 1 } as never);
  const { sheets } = gstr1Workbook(orders, settings, period);

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(`GSTR-1 — ${settings.legalName || settings.name || "Restaurant"}`, 40, 40);
  doc.setFontSize(10);
  doc.text(`GSTIN ${settings.gstin || "not set"} · ${period}`, 40, 58);

  autoTable(doc, {
    startY: 72,
    head: [["Dashboard", "Value"]],
    body: [["Net revenue", inr(ov.net)], ["Bills", String(ov.bills)], ["CGST + SGST", inr(ov.taxes.total)], ...ov.payments.map((p) => [`Paid by ${p.label}`, inr(p.amount)])],
    theme: "grid",
    headStyles: { fillColor: [30, 30, 30] },
  });

  for (const s of sheets) {
    if (!s.rows.length) continue;
    const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
    doc.setFontSize(12);
    doc.text(s.title || s.name, 40, y);
    autoTable(doc, {
      startY: y + 8,
      head: [s.columns.map((c) => c.header)],
      body: s.rows.map((r) => r.map(cell)),
      styles: { fontSize: 7 },
      theme: "striped",
      headStyles: { fillColor: [30, 30, 30] },
    });
  }
  doc.setFontSize(8);
  doc.text("Prepared from synced POS bills. Check with your accountant before filing.", 40, doc.internal.pageSize.getHeight() - 20);
  return doc.output("blob");
}
