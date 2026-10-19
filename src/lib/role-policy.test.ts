import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_POLICY, checkPin, hashPin, modeFor, pinProblem, resolvePolicy, screenAllowed } from "./role-policy";
import { can, needsPin, screenPermitted, setRolePolicy } from "./permissions";

const as = (role: "owner" | "manager" | "cashier" | "captain" | "kitchen") => ({ role });

afterEach(() => setRolePolicy(undefined, undefined));

describe("role policy", () => {
  it("fills gaps with the defaults and ignores junk", () => {
    const p = resolvePolicy({ cashier: { actions: { cancelBill: "pin", discount: "maybe" as never, dashboard: "on" }, screens: { "/stock": false } }, captain: { actions: { settle: "on" } } });
    expect(p.cashier.actions.cancelBill).toBe("pin");
    expect(p.cashier.actions.discount).toBe(DEFAULT_POLICY.cashier.actions.discount);
    expect(p.cashier.screens["/stock"]).toBe(false);
    expect(p.cashier.screens["/menu"]).toBe(true);
    // Settling isn't a waiter action, so it can't be switched on for them.
    expect(p.captain.actions.settle).toBe("off");
  });

  it("never limits owners and managers, and gives kitchen nothing configurable", () => {
    const p = resolvePolicy({ cashier: { actions: { discount: "off" } } });
    expect(modeFor(p, "owner", "discount")).toBe("on");
    expect(modeFor(p, "manager", "cancelBill")).toBe("on");
    expect(modeFor(p, "kitchen", "kotPrint")).toBe("off");
    expect(screenAllowed(p, "captain", "/menu")).toBe(false);
  });

  it("drives the app's permission checks", () => {
    expect(can(as("cashier"), "bill.cancel")).toBe(false); // default: admin only, as before
    setRolePolicy({ cashier: { actions: { cancelBill: "pin", discount: "off", dashboard: "on" }, screens: { "/reports": false } } }, undefined);
    expect(can(as("cashier"), "bill.cancel")).toBe(true);
    expect(needsPin(as("cashier"), "bill.cancel")).toBe(true);
    expect(can(as("cashier"), "bill.discount")).toBe(false);
    expect(can(as("cashier"), "dashboard.view")).toBe(true);
    expect(screenPermitted("cashier", "/reports")).toBe(false);
    // Admins are unaffected; database-protected actions can't be granted.
    expect(can(as("owner"), "bill.discount")).toBe(true);
    expect(needsPin(as("owner"), "bill.cancel")).toBe(false);
    expect(can(as("cashier"), "menu.edit")).toBe(false);
    expect(can(as("cashier"), "bill.void")).toBe(false);
  });

  it("lets waiters send and edit KOTs by default, and nothing else at the counter", () => {
    expect(can(as("captain"), "kot.send")).toBe(true);
    expect(can(as("captain"), "kot.edit")).toBe(true);
    expect(can(as("captain"), "bill.settle")).toBe(false);
    setRolePolicy({ captain: { actions: { kotEdit: "pin" } } }, undefined);
    expect(needsPin(as("captain"), "kot.edit")).toBe(true);
  });
});

describe("admin PIN", () => {
  it("rejects weak PINs", () => {
    expect(pinProblem("12")).toMatch(/4 to 6/);
    expect(pinProblem("1111")).toMatch(/easy/);
    expect(pinProblem("1234")).toMatch(/easy/);
    expect(pinProblem("4321")).toMatch(/easy/);
    expect(pinProblem("2580")).toBeNull();
  });

  it("stores only a salted hash and checks the PIN against it", async () => {
    const stored = await hashPin("2580", undefined, 1000);
    expect(JSON.stringify(stored)).not.toContain("2580");
    expect(await checkPin("2580", stored)).toBe(true);
    expect(await checkPin("2581", stored)).toBe(false);
    expect(await checkPin("2580", null)).toBe(false);
    const again = await hashPin("2580", undefined, 1000);
    expect(again.hash).not.toBe(stored.hash); // different salt each time
  });
});
