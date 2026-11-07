import { describe, expect, it } from "vitest";
import { rejectOversizedLists } from "./input-limits";

describe("rejectOversizedLists", () => {
  it("passes requests within the limits through unchanged", () => {
    const input = { params: ["a"], recipients: Array.from({ length: 25 }, () => ({ wa: "919000000000" })) };
    expect(rejectOversizedLists(input, { params: 5, recipients: 25 })).toBe(input);
  });
  it("refuses an oversized list before any validation runs", () => {
    const huge = { recipients: Array.from({ length: 100_000 }, () => ({})) };
    expect(() => rejectOversizedLists(huge, { recipients: 25 })).toThrow(/at most 25/);
  });
  it("leaves non-object input for the schema to reject", () => {
    expect(rejectOversizedLists(null, { recipients: 25 })).toBeNull();
    expect(rejectOversizedLists("x", { recipients: 25 })).toBe("x");
  });
});
