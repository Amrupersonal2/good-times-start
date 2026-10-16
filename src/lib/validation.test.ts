import { describe, expect, it } from "vitest";
import { emailError, fssaiError, gstinCheckChar, gstinError, upiError } from "./validation";

describe("validation", () => {
  it("accepts a GSTIN with a correct check character", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(gstinError("27AAPFU0939F1ZV")).toBe("");
    expect(gstinError(" 27aapfu0939f1zv ")).toBe("");
    expect(gstinError("")).toBe("");
  });

  it("rejects malformed or mistyped GSTINs", () => {
    expect(gstinError("27AAPFU0939F1Z")).toMatch(/15 characters/);
    expect(gstinError("27AAPFU0939F1ZW")).toMatch(/typo/);
  });

  it("checks FSSAI, UPI and email formats", () => {
    expect(fssaiError("11224333000123")).toBe("");
    expect(fssaiError("1122")).not.toBe("");
    expect(upiError("tabbistro@okaxis")).toBe("");
    expect(upiError("tabbistro")).not.toBe("");
    expect(emailError("staff@xtsy.one")).toBe("");
    expect(emailError("staff@")).not.toBe("");
  });
});
