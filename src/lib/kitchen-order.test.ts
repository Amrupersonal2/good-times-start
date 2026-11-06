import { describe, expect, it } from "vitest";
import { additionsNotInShared, accumulateSubmittedQuantities, cancelledKitchenLines, guestDetailsError, removeCancelled, reopenedLines, submittedQuantitiesFromKots, subtractSettledKitchenQuantities, subtractSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";
import type { CartLine } from "./types";

const lines: CartLine[] = [
  { itemId: "naan", name: "Butter Naan", price: 60, qty: 3, veg: true, gstRate: 5, station: "Tandoor" },
  { itemId: "paneer", name: "Paneer Butter Masala", price: 290, qty: 1, veg: true, gstRate: 5, station: "Main Course" },
];

describe("kitchen ticket quantities", () => {
  it("does not treat already-shared unsent quantities as new local additions", () => {
    const shared = [{ ...lines[0], qty: 1 }];
    expect(additionsNotInShared(shared, [{ ...lines[0], qty: 1 }])).toEqual([]);
    expect(additionsNotInShared(shared, [{ ...lines[0], qty: 3 }])).toEqual([{ ...lines[0], qty: 2 }]);
  });

  it("sends only quantities not already sent", () => {
    expect(unsentKitchenLines(lines, { naan: 2 })).toEqual([
      { ...lines[0], qty: 1 },
      lines[1],
    ]);
  });

  it("does not send a line twice when its full quantity has already been sent", () => {
    expect(unsentKitchenLines(lines, { naan: 3, paneer: 1 })).toEqual([]);
  });

  it("adds newly sent quantities to the stored totals", () => {
    const naan = lines[0];
    expect(naan).toBeDefined();
    expect(accumulateSubmittedQuantities({ naan: 2 }, naan ? [naan] : [])).toEqual({ naan: 5 });
  });
});
describe("cancellation tickets", () => {
  const l = (itemId: string, qty: number) => ({ itemId, name: itemId, price: 10, qty, veg: true, gstRate: 5, station: "Tandoor" });
  it("finds reduced and removed items that were already sent", () => {
    const sent = { naan: 3, dal: 1, roti: 2 };
    const now = [l("naan", 1), l("roti", 2)];
    expect(cancelledKitchenLines(now, sent, [l("dal", 1)])).toEqual([l("naan", 2), l("dal", 1)]);
    expect(cancelledKitchenLines(now, { naan: 1 })).toEqual([]);
  });
  it("updates sent counts and order lines after a cancellation", () => {
    expect(subtractSubmittedQuantities({ naan: 3, dal: 1 }, [l("naan", 2), l("dal", 1)])).toEqual({ naan: 1 });
    expect(removeCancelled([l("naan", 3), l("dal", 1)], [l("naan", 2), l("dal", 1)])).toEqual([l("naan", 1)]);
  });
});

describe("reopening a running bill on another device's changes", () => {
  const l = (itemId: string, qty: number, price = 100) => ({ itemId, name: itemId, price, qty, veg: true, gstRate: 5, station: "Bar" });

  it("keeps what other devices added since this device's draft (the R1 case: ₹160 draft, ₹340 bill)", () => {
    const draft = [l("virgin-mojito", 1, 160)];
    const shared = [l("virgin-mojito", 1, 160), l("passion-mojito", 1, 180)];
    const lines = reopenedLines(draft, { "virgin-mojito": 1 }, shared, { "virgin-mojito": 1, "passion-mojito": 1 });
    expect(lines.map((x) => [x.itemId, x.qty])).toEqual([["virgin-mojito", 1], ["passion-mojito", 1]]);
    expect(lines.reduce((t, x) => t + x.qty * x.price, 0)).toBe(340);
  });

  it("uses the saved shared snapshot to avoid duplicating already-shared unsent lines", () => {
    const base = [l("tea", 1)];
    const draft = [l("tea", 1)];
    const shared = [l("tea", 1)];
    expect(reopenedLines(draft, { tea: 0 }, shared, { tea: 0 }, base).map((x) => [x.itemId, x.qty])).toEqual([["tea", 1]]);
  });

  it("adds this device's unsent items on top, once", () => {
    const lines = reopenedLines([l("tea", 3), l("fries", 1)], { tea: 1 }, [l("tea", 2), l("rice", 1)], { tea: 2, rice: 1 });
    expect(lines.map((x) => [x.itemId, x.qty])).toEqual([["tea", 4], ["rice", 1], ["fries", 1]]);
  });

  it("keeps a cancellation this device started but hasn't sent", () => {
    const lines = reopenedLines([l("tea", 1)], { tea: 2, rice: 1 }, [l("tea", 2), l("rice", 1), l("cake", 1)], { tea: 2, rice: 1, cake: 1 });
    expect(lines.map((x) => [x.itemId, x.qty])).toEqual([["tea", 1], ["cake", 1]]);
  });

  it("never removes items for an older draft that didn't record what it had sent", () => {
    const lines = reopenedLines([l("tea", 1)], undefined, [l("tea", 1), l("cake", 1)], { tea: 1, cake: 1 });
    expect(lines.map((x) => [x.itemId, x.qty])).toEqual([["tea", 1], ["cake", 1]]);
  });
});


describe("guest details required for POS actions", () => {
  it("requires a name, a valid 10-digit mobile and a party size", () => {
    expect(guestDetailsError({}, undefined)).toBe("Enter the guest name.");
    expect(guestDetailsError({ name: "Guest" }, undefined)).toBe("Enter a valid 10-digit mobile number.");
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, undefined)).toBe("Select the total number of guests (1–50).");
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 2)).toBeNull();
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 6, 6)).toBeNull();
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 7, 8)).toBeNull();
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 7, 6)).toBe("Guest count exceeds this table's capacity (6).");
  });

  it("rejects invalid party sizes and malformed mobile numbers", () => {
    expect(guestDetailsError({ name: "Guest", phone: "12345" }, 2)).toBe("Enter a valid 10-digit mobile number.");
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 0)).toBe("Select the total number of guests (1–50).");
    expect(guestDetailsError({ name: "Guest", phone: "9876543210" }, 51)).toBe("Select the total number of guests (1–50).");
  });
});

describe("KOT-backed submitted quantities", () => {
  const kot = (kind: "order" | "cancel", itemId: string, qty: number) => ({
    orderId: 1, billNo: "POS/0001", station: "Kitchen", kind,
    lines: [{ itemId, name: itemId, qty }], status: "new" as const, createdAt: 1,
  });

  it("treats printed KOT order tickets as submitted, even if the order snapshot is stale", () => {
    const submitted = submittedQuantitiesFromKots([kot("order", "paneer", 2), kot("order", "naan", 1)]);
    expect(unsentKitchenLines([{ ...lines[0], qty: 2 }, lines[1]], submitted)).toEqual([{ ...lines[0], qty: 1 }]);
  });

  it("subtracts cancellation tickets from the net submitted quantity", () => {
    const submitted = submittedQuantitiesFromKots([kot("order", "paneer", 3), kot("cancel", "paneer", 1)]);
    expect(submitted).toEqual({ paneer: 2 });
  });

  it("does not turn quantities allocated to a split bill into kitchen cancellations", () => {
    const kots = [kot("order", "paneer", 3), kot("order", "naan", 2)];
    const settled = { paneer: 1, naan: 2 };
    const submitted = submittedQuantitiesFromKots(kots, settled);
    expect(submitted).toEqual({ paneer: 2 });
    expect(cancelledKitchenLines([{ ...lines[0], qty: 2 }], submitted, lines)).toEqual([]);
    expect(unsentKitchenLines([{ ...lines[0], qty: 2 }], submitted)).toEqual([]);
  });

  it("subtracts split allocations safely when legacy order snapshots are used", () => {
    expect(subtractSettledKitchenQuantities({ tea: 2, cake: 1 }, { tea: 1, cake: 3 })).toEqual({ tea: 1 });
  });
});
