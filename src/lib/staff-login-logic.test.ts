import { describe, expect, it } from "vitest";
import { accessProblem, appFromLocation, appsFor, deviceKind, emailFromInput, loginForEmail, maskPhone, passwordProblem, type LoginRow } from "./staff-login-logic";

const row = (login: LoginRow["login"], patch: Partial<LoginRow> = {}): LoginRow => ({
  login, active: true, devices: login === "billdesk" ? ["desktop"] : login === "waiter" ? ["android"] : ["android", "ios", "desktop"], whatsapp: "", display_name: login, ...patch,
});

describe("internal logins", () => {
  it("accepts short names and full addresses", () => {
    expect(emailFromInput(" Admin ")).toBe("admin@xtsy.pos");
    expect(emailFromInput("BILLDESK@XTSY.POS")).toBe("billdesk@xtsy.pos");
    expect(emailFromInput("waiter")).toBe("waiter@xtsy.pos");
    expect(emailFromInput("owner@gmail.com")).toBe("owner@gmail.com");
    expect(loginForEmail("Waiter@xtsy.pos")).toBe("waiter");
    expect(loginForEmail("someone@xtsy.pos")).toBeNull();
  });

  it("gives each login its own app; admin gets all three", () => {
    expect(appsFor("admin", "owner")).toEqual(["manager", "pos", "waiter"]);
    expect(appsFor("billdesk", "cashier")).toEqual(["pos"]);
    expect(appsFor("waiter", "captain")).toEqual(["waiter"]);
    expect(appsFor(null, "owner")).toEqual(["manager", "pos", "waiter"]); // the owner's own account
    expect(appsFor(null, "kitchen")).toEqual([]);
  });

  it("tells each device apart", () => {
    expect(deviceKind("Mozilla/5.0 (Linux; Android 14; SM-X200) Chrome/130")).toBe("android");
    expect(deviceKind("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe("ios");
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe("ios"); // iPad in desktop mode
    expect(deviceKind("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe("desktop");
    expect(deviceKind("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", "Win32", 0)).toBe("desktop");
  });

  it("keeps each login in its app and on its devices", () => {
    expect(accessProblem({ login: "billdesk", role: "cashier", row: row("billdesk"), app: "pos", device: "desktop" })).toBeNull();
    expect(accessProblem({ login: "billdesk", role: "cashier", row: row("billdesk"), app: "pos", device: "android" })).toMatch(/Windows or Mac computer only/);
    expect(accessProblem({ login: "billdesk", role: "cashier", row: row("billdesk"), app: "manager", device: "desktop" })).toMatch(/uses Restro POS by XTSY, not POS Business Manager/);
    expect(accessProblem({ login: "waiter", role: "captain", row: row("waiter"), app: "waiter", device: "android" })).toBeNull();
    expect(accessProblem({ login: "waiter", role: "captain", row: row("waiter"), app: "waiter", device: "desktop" })).toMatch(/Android phone or tablet only/);
    expect(accessProblem({ login: "waiter", role: "captain", row: row("waiter", { devices: ["android", "ios"] }), app: "waiter", device: "ios" })).toBeNull();
    expect(accessProblem({ login: "waiter", role: "captain", row: row("waiter", { active: false }), app: "waiter", device: "android" })).toMatch(/switched off/);
  });

  it("never locks the admin out of a device", () => {
    for (const device of ["android", "ios", "desktop"] as const) {
      for (const app of ["manager", "pos", "waiter"] as const) {
        expect(accessProblem({ login: "admin", role: "owner", row: row("admin", { devices: ["desktop"] }), app, device })).toBeNull();
      }
    }
  });

  it("knows which app a window is", () => {
    expect(appFromLocation("/", "?app=pos")).toBe("pos");
    expect(appFromLocation("/dashboard", "?app=manager")).toBe("manager");
    expect(appFromLocation("/waiter", "?app=waiter")).toBe("waiter");
    expect(appFromLocation("/waiter", "")).toBeNull(); // an admin peeking at the waiter screen stays in their app
    expect(appFromLocation("/manager", "")).toBe("manager");
    expect(appFromLocation("/", "?app=evil")).toBeNull();
  });

  it("checks new passwords and hides phone numbers", () => {
    expect(passwordProblem("short1")).toMatch(/8 characters/);
    expect(passwordProblem("onlyletters")).toMatch(/Mix/);
    expect(passwordProblem("Xtsy123$$")).toBeNull();
    expect(maskPhone("918837317070")).toBe("+91 ••••• •7070");
    expect(maskPhone("")).toBe("");
  });
});
