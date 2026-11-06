import { expect, it } from "vitest";
import { billSlip, kotSlip } from "./slip";
import type { Order, Kot } from "./types";
it("carries a new section and table onto both paper sizes", () => {
  const order = { billNo: "TBX/26-27/0001", orderType: "dine-in", tableLabel: "Room 7A", tableSection: "Rooms", lines: [], subtotal: 0, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 0, payments: [], status: "held", createdAt: 1, synced: false } as Order;
  const kot = { orderId: 1, billNo: order.billNo, tableLabel: order.tableLabel, tableSection: "Rooms", kotNo: "KOT/20261106/ABCD1234/0001", station: "Kitchen", lines: [], status: "new", createdAt: 1 } as Kot;
  for (const paper of [58, 80] as const) {
    expect(billSlip(order, { name: "TAB Bistro by XTSY" }, paper).lines.some((l) => l.text === "Section: Rooms")).toBe(true);
    expect(kotSlip([kot], paper).lines.some((l) => l.text === "Section: Rooms")).toBe(true);
  }
});