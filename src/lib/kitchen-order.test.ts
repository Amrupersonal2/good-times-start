import { describe, expect, it } from "vitest";
import { accumulateSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";
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