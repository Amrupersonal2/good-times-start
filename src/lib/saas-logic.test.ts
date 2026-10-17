import { describe, expect, it } from "vitest";
import { accountState, canAddOutlet, hasFeature, monthlyRevenue, slugError, slugify, type Account, type Plan } from "./saas-logic";

const now = Date.parse("2026-10-17T12:00:00Z");
const day = 86_400_000;
const iso = (offsetDays: number) => new Date(now + offsetDays * day).toISOString();
const account = (over: Partial<Account>): Account => ({ id: "a", name: "TAB", plan_id: "growth", status: "active", trial_ends_at: null, paid_until: null, billing_email: "", billing_phone: "", billing_gstin: "", ...over });
const growth: Plan = { id: "growth", name: "Growth", monthly_price: 1499, yearly_price: 14999, max_outlets: 1, max_staff: 15, features: { qr_ordering: true, online_ordering: true }, sort: 2, active: true };

describe("account state", () => {
  it("counts down a trial and stops it at the end", () => {
    expect(accountState(account({ status: "trialing", trial_ends_at: iso(10) }), now)).toMatchObject({ live: true, warn: false, daysLeft: 10 });
    expect(accountState(account({ status: "trialing", trial_ends_at: iso(2) }), now)).toMatchObject({ live: true, warn: true });
    expect(accountState(account({ status: "trialing", trial_ends_at: iso(-1) }), now).live).toBe(false);
  });
  it("gives a week's grace after the paid period, like the database", () => {
    expect(accountState(account({ paid_until: iso(-3) }), now)).toMatchObject({ live: true, warn: true });
    expect(accountState(account({ paid_until: iso(-8) }), now).live).toBe(false);
    expect(accountState(account({}), now)).toMatchObject({ live: true, label: "Active" });
    expect(accountState(account({ status: "suspended" }), now).live).toBe(false);
  });
  it("gates features by plan and by being live", () => {
    expect(hasFeature(account({}), growth, "qr_ordering", now)).toBe(true);
    expect(hasFeature(account({}), growth, "multi_outlet", now)).toBe(false);
    expect(hasFeature(account({ status: "cancelled" }), growth, "qr_ordering", now)).toBe(false);
    expect(hasFeature(null, null, "multi_outlet", now)).toBe(true);
    expect(canAddOutlet(growth, 1)).toBe(false);
  });
});

describe("web addresses and revenue", () => {
  it("makes database-safe addresses", () => {
    expect(slugify("TAB Bistro by XTSY!")).toBe("tab-bistro-by-xtsy");
    expect(slugify("  ")).toBe("restaurant");
    expect(slugError("tab-bistro")).toBe("");
    expect(slugError("-tab")).not.toBe("");
    expect(slugError("Tab")).not.toBe("");
  });
  it("adds up monthly revenue from paying, live accounts per outlet", () => {
    expect(monthlyRevenue([
      { planId: "growth", status: "active", live: true, outlets: [1, 2] },
      { planId: "growth", status: "trialing", live: true, outlets: [1] },
      { planId: "growth", status: "active", live: false, outlets: [1] },
    ], [growth])).toBe(2998);
  });
});
