import { describe, expect, it, vi } from "vitest";
import { boardTables, boardKots, readBoardKots, matchesBoard } from "./table-board";
import type { Table } from "dexie";
import type { Order, Kot, RestaurantTable } from "./types";
const floor: RestaurantTable = { id: "7A", label: "7A", section: "Rooms", seats: 2, status: "free", runningTotal: 0 };
const closed = { tableId: "7A", status: "settled", createdAt: 10, settledAt: 120 } as Order;
describe("live table status board", () => {
  it("reads existing caches through indexed orderId and retains globally linked orphan tickets", async () => {
    const linked = { orderId: 7, orderUid: "open" } as Kot;
    const orphan = { orderId: 0, orderUid: "open" } as Kot;
    const where = vi.fn((index: string) => {
      if (index !== "orderId") throw new Error(`KeyPath ${index} is not indexed`);
      return { anyOf: (ids: number[]) => ({ toArray: async () => ids.includes(7) ? [linked] : [] }), equals: (id: number) => ({ toArray: async () => id === 0 ? [orphan, { orderId: 0, orderUid: "other" } as Kot] : [] }) };
    });
    expect(await readBoardKots({ where } as unknown as Table<Kot, number>, [{ id: 7, uid: "open", status: "held" } as Order])).toEqual([linked, orphan]);
    expect(where.mock.calls).toEqual([["orderId"], ["orderId"]]);
  });
  it("shows yesterday's bill as settled today by payment date", () => {
    expect(boardTables([floor], [closed], 100, 200)[0]?.settledAt).toBe(120);
    expect(boardTables([floor], [closed], 0, 100)[0]?.settledAt).toBeUndefined();
  });
  it.each(["occupied", "billed", "reserved"] as const)("preserves %s instead of a settled annotation", (status) => {
    expect(boardTables([{ ...floor, status }], [closed], 100, 200)[0]?.settledAt).toBeUndefined();
  });
  it("keeps a held device out of the settled filter", () => {
    expect(boardTables([{ ...floor, heldDevice: "counter" }], [closed], 100, 200)[0]?.settledAt).toBeUndefined();
  });
  it("counts bill-printed tables as occupied without a printed summary", () => {
    expect(matchesBoard({ ...floor, status: "billed" }, "occupied")).toBe(true);
    expect(matchesBoard({ ...floor, status: "billed" }, "free")).toBe(false);
  });
  it("groups stations once and excludes served, cancellation and settled-bill KOTs", () => {
    const k = { orderUid: "open", orderId: 1, submissionId: "send", createdAt: 1, status: "new", station: "Kitchen" } as Kot;
    expect(boardKots([k, { ...k, station: "Bar" }, { ...k, submissionId: "served", status: "served" }, { ...k, submissionId: "cancel", kind: "cancel" }, { ...k, orderUid: "closed", submissionId: "closed" }], [{ uid: "open", id: 1, status: "held" } as Order])).toHaveLength(1);
  });
  it("retains open hotel KOTs from previous days", () => {
    expect(boardKots([{ orderUid: "stay", status: "new", createdAt: 1 } as Kot], [{ uid: "stay", status: "held" } as Order])).toHaveLength(1);
  });
});