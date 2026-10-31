import { describe, expect, it } from "vitest";
import { billSlip, columnsFor, escPos, kotSlip, plain, rawbtIntent, wrap } from "./slip";
import type { Kot, Order, RestaurantSettings } from "./types";

const settings: RestaurantSettings = {
  name: "TAB Bistro by XTSY", address: "Mawdiangdiang, New Shillong Township\nMeghalaya 793018",
  billFooter: "Flavour Food Fusion\nFor Delivery / Table Booking\nWhatsApp: +91 8837317070", gstMode: "unregistered",
} as RestaurantSettings;

// The bill from the photo: Room 7, Masala Bread Omelette ₹169 + Black Tea ₹39 = ₹208.
const bill: Order = {
  uid: "b1", billNo: "SJT/26-27/0835", orderType: "dine-in", tableId: "ROOM-7A", tableLabel: "Room 7A",
  lines: [
    { itemId: "omelette", name: "Masala Bread Omelette", price: 169, qty: 1, veg: false, gstRate: 5, station: "Breakfast" },
    { itemId: "tea", name: "Black Tea", price: 39, qty: 1, veg: true, gstRate: 5, station: "Beverages" },
  ],
  subtotal: 208, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 208,
  payments: [{ mode: "cash", amount: 208 }], status: "settled", createdAt: new Date(2026, 5, 2, 9, 58).getTime(), synced: true,
  customer: { name: "Kalidhas", phone: "8714040109" }, closedBy: "Reception", tax: { exempt: true, inclusive: false, roundToRupee: true },
};

// The KOT from the photo: D2, noodles and parotta.
const kot: Kot = {
  uid: "k1", orderId: 1, billNo: "SJT/26-27/0008", station: "Chinese", kind: "order", tableId: "D2", tableLabel: "D2", orderType: "dine-in",
  lines: [{ name: "Chicken Burned Garlic Hakka Noodles", qty: 1 }, { name: "Kerala Parotta [2 Pcs] With Chicken Gravy", qty: 1, note: "less spicy" }],
  status: "new", createdAt: new Date(2026, 9, 3, 19, 45).getTime(),
};

const text = (lines: { text: string }[]) => lines.map((l) => l.text).join("\n");

describe("thermal slips", () => {
  for (const paper of [80, 58] as const) {
    it(`fits every bill and KOT line on ${paper} mm paper`, () => {
      const cols = columnsFor(paper);
      for (const slip of [billSlip(bill, settings, paper), kotSlip([kot], paper)]) {
        for (const line of slip.lines) expect(line.text.length, line.text).toBeLessThanOrEqual(line.size === "big" ? cols / 2 : cols);
      }
    });
  }

  it("lays the bill out like the restaurant's slips, with numbers lined up", () => {
    const slip = billSlip(bill, settings, 80);
    const t = text(slip.lines);
    expect(slip.lines[0]).toMatchObject({ text: "TAB Bistro by XTSY", align: "center", bold: true, size: "big" });
    for (const want of ["Mawdiangdiang, New Shillong Township", "Meghalaya 793018", "DINE IN", "Bill: SJT/26-27/0835", "Date: 02-06-2026 09:58 AM",
      "Guest: Kalidhas/8714040109", "Cashier: Reception", "Table: Room 7A", "Flavour Food Fusion", "For Delivery / Table Booking", "WhatsApp: +91 8837317070"]) {
      expect(t).toContain(want);
    }
    const header = slip.lines.find((l) => l.text.startsWith("Item"))!.text;
    const omelette = slip.lines.find((l) => l.text.startsWith("Masala Bread Omelette"))!.text;
    expect(omelette.length).toBe(48);
    expect(omelette.endsWith("169.00")).toBe(true);
    expect(header.indexOf("Amt") + 3).toBe(omelette.length); // amounts end under "Amt"
    expect(slip.lines.find((l) => l.text.startsWith("TOTAL"))).toMatchObject({ size: "big", bold: true });
    expect(slip.lines.find((l) => l.text.startsWith("TOTAL"))!.text.trim().endsWith("208.00")).toBe(true);
    expect(t).toMatch(/Total qty\s+2/);
    expect(t).toMatch(/Paid by Cash\s+208\.00/);
    expect(t).not.toMatch(/CGST|SGST/); // GST registration pending: no tax lines
  });

  it("shows CGST and SGST with their rate once the bill carries GST", () => {
    const taxed = billSlip({ ...bill, cgst: 5.2, sgst: 5.2, total: 218, tax: { exempt: false, inclusive: false, roundToRupee: true } }, { ...settings, gstin: "17ABCDE1234F1Z5", gstMode: "regular" } as RestaurantSettings, 80);
    expect(text(taxed.lines)).toMatch(/CGST 2\.5%\s+5\.20/);
    expect(text(taxed.lines)).toContain("TAX INVOICE");
  });

  it("prints the KOT with big order type and table, and tall bold items", () => {
    const slip = kotSlip([kot], 80);
    const t = text(slip.lines);
    expect(t).toContain("Running KOT");
    expect(slip.lines.find((l) => l.text === "DINE IN")).toMatchObject({ size: "big", bold: true });
    expect(slip.lines.find((l) => l.text === "TBL: D2")).toMatchObject({ size: "big", bold: true });
    expect(t).toContain("Date: 03-10-2026  Time: 07:45 PM");
    expect(slip.lines.find((l) => l.text.startsWith("Chicken Burned Garlic"))).toMatchObject({ size: "tall", bold: true });
    expect(t).toContain("NOTE: less spicy");
    expect(t).toMatch(/Total Qty\s+2/);
    expect(text(kotSlip([{ ...kot, kind: "cancel" }], 80).lines)).toContain("CANCEL KOT");
  });

  it("wraps long names inside their column on 58 mm paper", () => {
    const lines = kotSlip([kot], 58).lines.map((l) => l.text);
    expect(lines.some((l) => l.startsWith("Kerala Parotta"))).toBe(true);
    expect(lines.every((l) => l.length <= 32)).toBe(true);
  });

  it("makes ESC/POS bytes: initialise, text, feed and cut, once per copy", () => {
    const bytes = escPos(billSlip(bill, settings, 80), { copies: 2 });
    const asText = String.fromCharCode(...bytes);
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40]);
    expect(asText).toContain("Masala Bread Omelette");
    expect(asText.split("\x1dVB\x00").length - 1).toBe(2);
    expect(rawbtIntent(Uint8Array.from([0x1b, 0x40]))).toBe("intent:base64,G0A=#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;");
  });

  it("keeps text printable on any thermal printer", () => {
    expect(plain("₹120 × 2 — Crème brûlée")).toBe("Rs.120 x 2 - Creme brulee");
    expect(wrap("Kerala Parotta [2 Pcs] With Chicken Gravy", 20)).toEqual(["Kerala Parotta [2", "Pcs] With Chicken", "Gravy"]);
  });
});
