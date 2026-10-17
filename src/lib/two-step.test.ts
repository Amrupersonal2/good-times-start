import { afterEach, describe, expect, it } from "vitest";
import { armed, disarm, press } from "./two-step";

afterEach(() => disarm());

describe("two-step actions", () => {
  it("arms on the first press and runs on the second", () => {
    expect(press("settle-cash")).toBe(false);
    expect(armed()).toBe("settle-cash");
    expect(press("settle-cash")).toBe(true);
    expect(armed()).toBeNull();
  });

  it("a press on a different action moves the arm instead of running anything", () => {
    press("settle-cash");
    expect(press("settle-upi")).toBe(false);
    expect(armed()).toBe("settle-upi");
    expect(press("settle-cash")).toBe(false);
  });

  it("disarms by itself after the wait", async () => {
    press("send-kot", 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(armed()).toBeNull();
    expect(press("send-kot", 20)).toBe(false);
  });
});
