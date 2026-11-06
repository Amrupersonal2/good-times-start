import { describe, expect, it } from "vitest";
import { gstr1Pdf } from "./gstr1-pdf";
describe("GSTR-1 PDF", () => {
  it("produces a PDF", async () => {
    const o = { uid: "u1", billNo: "C1/1", orderType: "dine-in", status: "settled", createdAt: Date.now(), lines: [{ itemId: "a", name: "Naan", price: 100, qty: 1, veg: true, gstRate: 5, station: "x" }], subtotal: 100, discountAmt: 0, cgst: 2.5, sgst: 2.5, roundOff: 0, total: 105, taxable: 100, payments: [{ mode: "cash", amount: 105 }] } as never;
    const blob = await gstr1Pdf([o], { name: "T", gstin: "" } as never, "Nov 2026");
    expect(blob.size).toBeGreaterThan(1000);
  });
});
