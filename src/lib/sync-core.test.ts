import { describe, expect, it } from "vitest";
import {
  isOrderPayload,
  legacyKotUid,
  legacyOrderUid,
  mergeSentLines,
  normaliseDeviceCode,
  outboxKey,
  pullStartFrom,
  randomDeviceCode,
  sameLines,
  toSharedPayload,
} from "./sync-core";
import type { CartLine } from "./types";

const line = (itemId: string, qty: number, note?: string): CartLine => ({
  itemId, name: itemId, price: 100, qty, veg: true, gstRate: 5, station: "Main Course", ...(note ? { note } : {}),
});

describe("sync core", () => {
  it("builds stable keys and legacy ids", () => {
    expect(outboxKey("order", "abc")).toBe("order:abc");
    expect(legacyOrderUid({ billNo: "INV/26-27/D1/0007", createdAt: 1792050797821 })).toBe("legacy:INV/26-27/D1/0007:1792050797821");
    expect(legacyKotUid({ billNo: "INV/26-27/D1/0007", station: "Tandoor", createdAt: 5 })).toBe("legacy:INV/26-27/D1/0007:Tandoor:5");
  });

  it("makes short, unambiguous device codes", () => {
    expect(randomDeviceCode()).toMatch(/^[A-HJ-NP-Z2-9]{3}$/);
    expect(normaliseDeviceCode(" c-1 counter ")).toBe("C1CO");
  });

  it("overlaps the pull cursor and ignores bad cursors", () => {
    expect(pullStartFrom(null)).toBeNull();
    expect(pullStartFrom("not a date")).toBeNull();
    expect(pullStartFrom("2026-10-16T10:00:10.000Z", 10_000)).toBe("2026-10-16T10:00:00.000Z");
  });

  it("drops device-only fields before upload", () => {
    const payload = toSharedPayload("order", { id: 4, uid: "u", synced: false, cloudUserId: "x", billNo: "B", note: undefined });
    expect(payload).toEqual({ uid: "u", billNo: "B" });
    expect(toSharedPayload("kot", { id: 1, orderId: 2, uid: "k" })).toEqual({ uid: "k" });
  });

  it("validates order payloads from the cloud", () => {
    const order = { billNo: "B", lines: [line("a", 1)], total: 105, createdAt: 1, status: "held" };
    expect(isOrderPayload(order)).toBe(true);
    expect(isOrderPayload({ ...order, status: "paid" })).toBe(false);
    expect(isOrderPayload({ ...order, lines: [{ name: "x" }] })).toBe(false);
  });

  it("adds this device's unsent items on top of items another device already sent", () => {
    const latest = [line("naan", 2), line("dal", 1)];
    const merged = mergeSentLines(latest, [line("naan", 1, "extra butter"), line("lassi", 2)]);
    expect(merged).toEqual([line("naan", 3, "extra butter"), line("dal", 1), line("lassi", 2)]);
    expect(latest[0]?.qty).toBe(2);
  });

  it("compares line lists regardless of order", () => {
    expect(sameLines([line("a", 1), line("b", 2)], [line("b", 2), line("a", 1)])).toBe(true);
    expect(sameLines([line("a", 1)], [line("a", 2)])).toBe(false);
  });
});
