import { describe, expect, it } from "vitest";
import { filterGuestMenu, GUEST_ORDER_ORIGIN, orderingSaveError, guestChannel } from "./qr-ordering";
import { orderPageUrl } from "./guest-order-logic";
import type { MenuItem } from "./types";

const menu: MenuItem[] = [
  { id: "tea", name: "Assam Tea", category: "Drinks", price: 40, veg: true, gstRate: 5, station: "Bar", available: true },
  { id: "chicken", name: "Chicken Tikka", category: "Appetizers", price: 300, veg: false, gstRate: 5, station: "Kitchen", available: true },
];
describe("QR ordering", () => {
  it("uses table service for a selected table and pickup only when enabled", () => {
    expect(guestChannel(true, false, "t1")).toBe("table");
    expect(guestChannel(true, false)).toBeNull();
    expect(guestChannel(true, true)).toBe("online");
    expect(guestChannel(false, true, "t1")).toBeNull();
  });
  it("prints public table links rather than preview links", () => {
    expect(orderPageUrl(GUEST_ORDER_ORIGIN, "tab-bistro", "t1")).toBe("https://good-times-start.lovable.app/order/tab-bistro?table=t1");
  });
  it("combines vegetarian filtering with category search", () => {
    expect(filterGuestMenu(menu, "drinks", "veg").map((item) => item.id)).toEqual(["tea"]);
    expect(filterGuestMenu(menu, "drinks", "nonveg")).toEqual([]);
  });
  it("does not report a permission-filtered update as saved", () => {
    expect(orderingSaveError(null, [])).not.toBeNull();
    expect(orderingSaveError(null, [{ id: "r" }])).toBeNull();
  });
});