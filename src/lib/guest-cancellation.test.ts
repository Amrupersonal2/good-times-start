import { expect, it } from "vitest";
import { guestCanCancel } from "./guest-cancellation";
it("permits cancellation through one minute, but not after", () => {
  const placed = "2026-11-07T08:00:00Z", at = Date.parse(placed);
  expect(guestCanCancel("new", placed, at)).toBe(true);
  expect(guestCanCancel("new", placed, at + 60_000)).toBe(true);
  expect(guestCanCancel("new", placed, at + 60_001)).toBe(false);
});
it("does not permit guest cancellation of accepted or closed orders", () => {
  for (const status of ["accepted", "ready", "completed", "cancelled", "rejected"]) expect(guestCanCancel(status, "2026-11-07T08:00:00Z", Date.parse("2026-11-07T08:00:30Z"))).toBe(false);
});