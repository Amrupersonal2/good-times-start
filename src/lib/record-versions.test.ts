import { describe, expect, it } from "vitest";
import { buildUnits, mergeLines, mergeOrder } from "./record-versions";
import type { CartLine, Order } from "./types";

const l = (itemId: string, qty: number, extra: Partial<CartLine> = {}): CartLine => ({ itemId, name: itemId, price: 100, qty, veg: true, gstRate: 5, station: "Indian", ...extra });
const q = (lines: CartLine[]) => lines.map((x) => [x.itemId, x.qty]);

describe("mergeLines", () => {
  it("keeps independent additions from both sides", () => {
    expect(q(mergeLines([l("a", 1)], [l("a", 1), l("b", 1)], [l("a", 1), l("c", 2)]).lines)).toEqual([["a", 1], ["c", 2], ["b", 1]]);
  });
  it("adds quantities of the same new dish once", () => {
    expect(q(mergeLines([], [l("naan", 1)], [l("naan", 2)]).lines)).toEqual([["naan", 3]]);
  });
  it("applies both quantity deltas to an existing dish", () => {
    expect(q(mergeLines([l("a", 2)], [l("a", 3)], [l("a", 5)]).lines)).toEqual([["a", 6]]);
  });
  it("keeps a removal when the other side didn't touch the dish", () => {
    expect(q(mergeLines([l("a", 1), l("b", 1)], [l("a", 1)], [l("a", 1), l("b", 1), l("c", 1)]).lines)).toEqual([["a", 1], ["c", 1]]);
  });
  it("flags edit-vs-removal instead of guessing", () => {
    expect(mergeLines([l("a", 1)], [], [l("a", 3)]).conflicts).toHaveLength(1);
  });
  it("flags repeated dish rows", () => {
    expect(mergeLines([], [l("a", 1), l("a", 1)], []).conflicts).toHaveLength(1);
  });
});

describe("mergeOrder", () => {
  const o = (lines: CartLine[], status: Order["status"] = "held"): Order => ({ uid: "u", billNo: "B1", orderType: "dine-in", lines, subtotal: 0, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 0, payments: [], status, createdAt: 1, synced: false });
  it("recomputes totals after a merge", () => {
    const merged = mergeOrder(o([l("a", 1)]), o([l("a", 1), l("b", 1)]), o([l("a", 2)]));
    expect(merged.order?.subtotal).toBe(300);
  });
  it("never auto-merges into a bill settled elsewhere", () => {
    expect(mergeOrder(o([l("a", 1)]), o([l("a", 2)]), o([l("a", 1)], "settled")).order).toBeNull();
  });
});

describe("buildUnits", () => {
  it("groups a settled bill with its sale stock entry and table", () => {
    const units = buildUnits([
      { kind: "table", record_id: "T1", payload: {}, deleted: false, base_version: 1 },
      { kind: "order", record_id: "o1", payload: { status: "settled", tableId: "T1" }, deleted: false, base_version: 1 },
      { kind: "stock_entry", record_id: "sale:o1", payload: {}, deleted: false, base_version: null },
      { kind: "menu", record_id: "m1", payload: {}, deleted: false, base_version: 1 },
    ]);
    expect(units.map((u) => u.map((r) => r.record_id))).toEqual([["o1", "sale:o1", "T1"], ["m1"]]);
  });
});
