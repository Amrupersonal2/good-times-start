import { describe, expect, it } from "vitest";
import { COUNTER_TYPES, isCounterType } from "./bill-entry";

describe("bill entry", () => {
  it("knows the counter orders and rejects anything else", () => {
    expect(COUNTER_TYPES.map((t) => t.v)).toEqual(["takeaway", "delivery", "swiggy", "zomato"]);
    expect(isCounterType("swiggy")).toBe(true);
    expect(isCounterType("dine-in")).toBe(false);
    expect(isCounterType("anything")).toBe(false);
    expect(isCounterType(undefined)).toBe(false);
  });
});
