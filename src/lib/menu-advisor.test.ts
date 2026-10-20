import { describe, expect, it } from "vitest";
import { advisorSnapshot, isAdvisorOwner, menuAdvisorInput } from "./menu-advisor";
import type { MenuItem, Order } from "./types";

const item: MenuItem = { id: "paneer", name: "Paneer", category: "Main", price: 200, available: true, veg: true, gstRate: 5, station: "Main" };
const order: Order = { billNo: "private-bill", lines: [{ itemId: item.id, name: item.name, price: 200, qty: 2, veg: true, gstRate: 5, station: "Main" }], orderType: "dine-in", status: "settled", subtotal: 400, discountPct: 10, discountAmt: 40, cgst: 9, sgst: 9, roundOff: 0, total: 378, payments: [{ mode: "cash", amount: 378 }], createdAt: 1000, synced: false, customer: { name: "Private guest", phone: "private-phone" }, closedBy: "private-staff" };
describe("owner menu analysis", () => {
  it("allows owners, not managers, cashiers or signed-out users", () => {
    expect(isAdvisorOwner("owner")).toBe(true);
    for (const role of ["manager", "cashier", undefined]) expect(isAdvisorOwner(role)).toBe(false);
  });
  it("includes only settled sales in the requested period", () => {
    const snapshot = advisorSnapshot([order, { ...order, status: "held" }, { ...order, status: "void" }, { ...order, createdAt: 3000 }], [item], 0, 2000);
    const data = JSON.parse(snapshot.sales);
    expect(data.bills).toBe(1); expect(data.revenue).toBe(378); expect(data.dishes[0].qty).toBe(2); expect(data.dishes[0].amount).toBe(360); expect(data.paymentTotals.cash).toBe(378);
  });
  it("excludes customer, staff and bill identifiers", () => {
    const snapshot = advisorSnapshot([order], [item], 0, 2000);
    for (const value of ["private-bill", "Private guest", "private-phone", "private-staff"]) expect(snapshot.sales).not.toContain(value);
  });
  it("requires both sales and menu data and a restaurant id", () => {
    const input = { restaurantId: "11111111-1111-4111-8111-111111111111", sales: "Paneer: 2 sold, ₹378", menu: "Paneer: ₹200" };
    expect(menuAdvisorInput.safeParse(input).success).toBe(true);
    expect(menuAdvisorInput.safeParse({ ...input, sales: "" }).success).toBe(false);
    expect(menuAdvisorInput.safeParse({ ...input, menu: "" }).success).toBe(false);
    expect(menuAdvisorInput.safeParse({ ...input, restaurantId: "bad" }).success).toBe(false);
    expect(menuAdvisorInput.safeParse({ ...input, sales: "x".repeat(30001) }).success).toBe(false);
  });
});