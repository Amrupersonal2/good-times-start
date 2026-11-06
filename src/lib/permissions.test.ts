import { describe, expect, it } from "vitest";
import { can } from "./permissions";

const as = (role: "owner" | "manager" | "cashier" | "captain" | "kitchen" | "unknown") => ({ role });

describe("permissions", () => {
  it("keeps every set-up, money and settings control with the owner and managers", () => {
    for (const action of ["menu.edit", "menu.import", "tables.edit", "stock.setup", "stock.purchase", "bill.void", "bill.cancel", "settings.billing", "staff.manage", "reports.view", "reports.export", "dashboard.view", "guests.points", "marketing.manage"] as const) {
      expect([action, can(as("owner"), action), can(as("manager"), action)]).toEqual([action, true, true]);
      for (const staff of ["cashier", "captain", "kitchen", "unknown"] as const) expect([action, staff, can(as(staff), action)]).toEqual([action, staff, false]);
    }
  });

  it("lets the shift do its work", () => {
    expect(can(as("cashier"), "bill.settle")).toBe(true);
    expect(can(as("cashier"), "counter.close")).toBe(true);
    expect(can(as("captain"), "kot.send")).toBe(true);
    expect(can(as("captain"), "bill.settle")).toBe(false);
    expect(can(as("kitchen"), "stock.wastage")).toBe(true);
    expect(can(as("kitchen"), "bill.create")).toBe(false);
  });

  it("gives nothing to someone not signed in, and device reset and outlets only to the owner", () => {
    expect(can(null, "bill.create")).toBe(false);
    expect(can(as("manager"), "device.reset")).toBe(false);
    expect(can(as("manager"), "outlets.manage")).toBe(false);
    expect(can(as("owner"), "device.reset")).toBe(true);
  });
});
