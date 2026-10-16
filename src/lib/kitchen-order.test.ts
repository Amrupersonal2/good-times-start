import { describe, expect, it } from "vitest";
import { accumulateSubmittedQuantities, cancelledKitchenLines, removeCancelled, subtractSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";
import type { CartLine } from "./types";

const lines: CartLine[] = [
  { itemId: "naan", name: "Butter Naan", price: 60, qty: 3, veg: true, gstRate: 5, station: "Tandoor" },
  { itemId: "paneer", name: "Paneer Butter Masala", price: 290, qty: 1, veg: true, gstRate: 5, station: "Main Course" },
];

describe("kitchen ticket quantities", () => {
  it("sends only quantities not already sent", () => {
    expect(unsentKitchenLines(lines, { naan: 2 })).toEqual([
      { ...lines[0], qty: 1 },
      lines[1],
    ]);
  });

  it("does not send a line twice when its full quantity has already been sent", () => {
    expect(unsentKitchenLines(lines, { naan: 3, paneer: 1 })).toEqual([]);
  });

  it("adds newly sent quantities to the stored totals", () => {
    const naan = lines[0];
    expect(naan).toBeDefined();
    expect(accumulateSubmittedQuantities({ naan: 2 }, naan ? [naan] : [])).toEqual({ naan: 5 });
  });
});
describe("cancellation tickets", () => {
  const l = (itemId: string, qty: number) => ({ itemId, name: itemId, price: 10, qty, veg: true, gstRate: 5, station: "Tandoor" });
  it("finds reduced and removed items that were already sent", () => {
    const sent = { naan: 3, dal: 1, roti: 2 };
    const now = [l("naan", 1), l("roti", 2)];
    expect(cancelledKitchenLines(now, sent, [l("dal", 1)])).toEqual([l("naan", 2), l("dal", 1)]);
    expect(cancelledKitchenLines(now, { naan: 1 })).toEqual([]);
  });
  it("updates sent counts and order lines after a cancellation", () => {
    expect(subtractSubmittedQuantities({ naan: 3, dal: 1 }, [l("naan", 2), l("dal", 1)])).toEqual({ naan: 1 });
    expect(removeCancelled([l("naan", 3), l("dal", 1)], [l("naan", 2), l("dal", 1)])).toEqual([l("naan", 1)]);
  });
});
