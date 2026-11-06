import { describe, expect, it } from "vitest";
import { lineFor, sentGroups, shortCode, since } from "./bill-view-logic";
import type { Kot } from "./types";

describe("bill view", () => {
  it("makes short dish codes", () => {
    expect(shortCode("Aloo Paratha")).toBe("AP");
    expect(shortCode("Cappuccino")).toBe("CAP");
    expect(shortCode("Kerala Parotta [2 Pcs] With Chicken Gravy")).toBe("KPW");
    expect(shortCode("Drinking Water 500 ml")).toBe("DW500");
  });

  it("numbers tickets in the order they were sent, joining one send's stations into one KOT", () => {
    const k = (uid: string, at: number, station: string, kind: Kot["kind"] = "order"): Kot =>
      ({ uid, orderId: 1, billNo: "B", station, kind, lines: [{ itemId: uid, name: uid, qty: 1 }], status: "new", createdAt: at });
    const groups = sentGroups([k("c", 300, "Kitchen"), k("a", 100, "Kitchen"), k("b", 100, "Bar"), k("x", 200, "Kitchen", "cancel")]);
    expect(groups.map((g) => [g.number, g.cancel, g.station, g.lines.length])).toEqual([[1, false, "Kitchen, Bar", 2], [1, true, "Kitchen", 1], [2, false, "Kitchen", 1]]);
  });

  it("uses the official KOT number and groups station rows by submission ID, not timestamp", () => {
    const k = (uid: string, at: number, station: string, submissionId: string, kotNo: string): Kot =>
      ({ uid, orderId: 1, orderUid: "order-1", submissionId, kotNo, billNo: "POS/0001", station, lines: [{ itemId: uid, name: uid, qty: 1 }], status: "new", createdAt: at });
    const groups = sentGroups([
      k("one-kitchen", 100, "Kitchen", "send-1", "KOT/0010"),
      k("one-bar", 100, "Bar", "send-1", "KOT/0010"),
      k("two", 100, "Continental", "send-2", "KOT/0011"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => [g.kotNo, g.station, g.lines.length])).toEqual([
      ["KOT/0010", "Kitchen, Bar", 2],
      ["KOT/0011", "Continental", 1],
    ]);
  });

  it("groups legacy station rows sent at the same timestamp when submission identity is unavailable", () => {
    const a: Kot = { orderId: 1, orderUid: "order-1", billNo: "POS/0001", station: "Kitchen", lines: [], status: "new", createdAt: 100 };
    const b: Kot = { ...a, station: "Continental" };
    expect(sentGroups([a, b])).toHaveLength(1);
    expect(sentGroups([a, b])[0]?.station).toBe("Kitchen, Continental");
  });

  it("says how long ago a ticket went", () => {
    expect(since(0, 30_000)).toBe("just now");
    expect(since(0, 12 * 60_000)).toBe("12 min");
    expect(since(0, 65 * 60_000)).toBe("1 h 5 min");
  });

  it("finds a sent item's bill line by id, or by name for older tickets", () => {
    const lines = [{ itemId: "t", name: "Tea", price: 1, qty: 2, veg: true, gstRate: 5, station: "B" }];
    expect(lineFor(lines, "t", "x")?.name).toBe("Tea");
    expect(lineFor(lines, undefined, "Tea")?.itemId).toBe("t");
  });
});
