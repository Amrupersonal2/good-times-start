import { describe, expect, it } from "vitest";
import { addToGuestCart, asMenuItem, billWithGuestLines, cartLinesFromGuest, guestLineFor, guestOrderPayload, guestSubtotal, orderPageUrl, pickupChoices, setGuestQty, sortGuestOrders, type GuestOrder } from "./guest-order-logic";
import type { MenuItem, Order } from "./types";

const momo: MenuItem = {
  id: "momo", name: "Chicken Momo", category: "Momos", price: 180, veg: false, gstRate: 5, station: "Kitchen", available: true,
  variants: [{ id: "h", name: "Half", price: 180 }, { id: "f", name: "Full", price: 320 }],
  addons: [{ id: "dip", name: "Extra dip", price: 20 }],
};
const tea: MenuItem = { id: "tea", name: "Masala Tea", category: "Tea", price: 40, veg: true, gstRate: 5, station: "Bar", available: true, prices: { takeaway: 45 } };

describe("guest cart", () => {
  it("prices like the counter and adds up the same dish", () => {
    let cart = addToGuestCart([], guestLineFor(momo, "table", "f", ["dip"]));
    cart = addToGuestCart(cart, guestLineFor(momo, "table", "f", ["dip"]));
    cart = addToGuestCart(cart, guestLineFor(tea, "online"));
    expect(cart.map((l) => [l.name, l.price, l.qty])).toEqual([["Chicken Momo (Full) + Extra dip", 340, 2], ["Masala Tea", 45, 1]]);
    expect(guestSubtotal(cart)).toBe(725);
    expect(guestOrderPayload(setGuestQty(cart, cart[1]!.key, 0))).toEqual([{ itemId: "momo", variantId: "f", addonIds: ["dip"], qty: 2, note: "" }]);
  });

  it("keeps the takeaway price when a public dish becomes a menu item again", () => {
    const { prices: _p, ...publicTea } = tea;
    expect(asMenuItem({ ...publicTea, takeawayPrice: 45 }).prices).toEqual({ takeaway: 45 });
  });
});

describe("accepting a guest order", () => {
  it("rebuilds bill lines from the local menu and keeps unknown dishes", () => {
    const { lines, missing } = cartLinesFromGuest([
      { itemId: "momo", variantId: "f", addonIds: ["dip"], qty: 1, name: "x", price: 1, note: "spicy" },
      { itemId: "momo", variantId: "f", addonIds: ["dip"], qty: 1, name: "x", price: 1, note: "no onion" },
      { itemId: "gone", qty: 2, name: "Old dish", price: 99, veg: true },
    ], [momo, tea], "table");
    expect(lines[0]).toMatchObject({ itemId: "momo|v:f|a:dip", price: 340, qty: 2, note: "spicy; no onion", station: "Kitchen" });
    expect(lines[1]).toMatchObject({ name: "Old dish", price: 99, qty: 2 });
    expect(missing).toEqual(["Old dish"]);
  });

  it("adds to the table's open bill and counts the items as sent to the kitchen", () => {
    const base: Order = {
      id: 7, uid: "u1", billNo: "C1/26-27/0004", orderType: "dine-in", tableId: "t1", lines: [{ itemId: "tea", name: "Masala Tea", price: 40, qty: 1, veg: true, gstRate: 5, station: "Bar" }],
      subtotal: 40, discountPct: 0, discountAmt: 0, cgst: 1, sgst: 1, roundOff: 0, total: 42, payments: [], status: "held", createdAt: 1, synced: true,
      kotSubmittedQty: { tea: 1 }, tax: {},
    };
    const { lines } = cartLinesFromGuest([{ itemId: "tea", qty: 2, name: "", price: 0 }], [tea], "table");
    const bill = billWithGuestLines(base, lines, { billNo: "unused", orderType: "dine-in", discountPct: 0, payments: [], status: "held", createdAt: 2, synced: false }, "Q-0001");
    expect(bill.billNo).toBe("C1/26-27/0004");
    expect(bill.lines).toEqual([expect.objectContaining({ itemId: "tea", qty: 3 })]);
    expect(bill.kotSubmittedQty).toEqual({ tea: 3 });
    expect(bill.subtotal).toBe(120);
    expect(bill.guestCodes).toEqual(["Q-0001"]);
  });

  it("opens a new bill for a pickup order", () => {
    const { lines } = cartLinesFromGuest([{ itemId: "tea", qty: 2, name: "", price: 0 }], [tea], "online");
    const bill = billWithGuestLines(null, lines, { uid: "n", billNo: "C1/26-27/0005", orderType: "takeaway", discountPct: 0, payments: [], status: "held", createdAt: 2, synced: false, source: "online", tax: { inclusive: true } }, "W-1234");
    expect(bill).toMatchObject({ billNo: "C1/26-27/0005", subtotal: 90, total: 90, source: "online", kotSubmittedQty: { tea: 2 } });
  });
});

describe("links and lists", () => {
  it("builds table and online links", () => {
    expect(orderPageUrl("https://pos.xtsy.one/", "tab-bistro", "t 1")).toBe("https://pos.xtsy.one/order/tab-bistro?table=t%201");
    expect(orderPageUrl("https://pos.xtsy.one", "tab-bistro")).toBe("https://pos.xtsy.one/order/tab-bistro");
  });
  it("offers pickup slots on the quarter hour after the prep time", () => {
    const choices = pickupChoices(new Date(2026, 9, 17, 19, 2), 20);
    expect(choices[0]!.at).toBeNull();
    expect(new Date(choices[1]!.at ?? "").getMinutes()).toBe(30);
    expect(choices).toHaveLength(9);
  });
  it("puts waiting orders first", () => {
    const o = (id: string, status: GuestOrder["status"], at: string) => ({ id, status, created_at: at }) as GuestOrder;
    expect(sortGuestOrders([o("a", "ready", "3"), o("b", "new", "1"), o("c", "new", "2")]).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});
