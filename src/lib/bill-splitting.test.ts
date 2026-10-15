import { describe, expect, it } from "vitest";
import { splitLines } from "./bill-splitting";
import type { CartLine } from "./types";

const lines: CartLine[] = [
  { itemId: "naan", name: "Butter Naan", price: 60, qty: 3, veg: true, gstRate: 5, station: "Tandoor" },
  { itemId: "paneer", name: "Paneer Butter Masala", price: 290, qty: 1, veg: true, gstRate: 5, station: "Main Course" },
];

describe("split bill quantities", () => {
  it("moves only selected quantities and leaves the remainder on the original bill", () => {
    expect(splitLines(lines, { naan: 2 })).toEqual({
      split: [{ ...lines[0], qty: 2 }],
      remaining: [{ ...lines[0], qty: 1 }, lines[1]],
    });
  });
  it("never moves more items than the original quantity", () => {
    expect(splitLines(lines, { naan: 99 }).split[0]?.qty).toBe(3);
  });
});