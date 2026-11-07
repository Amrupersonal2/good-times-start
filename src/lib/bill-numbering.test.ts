import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  allocate: vi.fn(async (_series: string, requestId: string) => `POS/${requestId === "bill-a" ? "0005" : "0006"}`),
  requestId: vi.fn(async (_series: string, requestId: string) => requestId),
  kots: [] as { id?: number; uid?: string; orderUid?: string; orderId?: number; billNo: string }[],
  orders: new Map<number, unknown>(),
  dirty: vi.fn(async () => undefined),
}));

vi.mock("./restaurant-numbering", () => ({ allocateRestaurantNumber: mocks.allocate, allocatedNumberRequestId: mocks.requestId }));
vi.mock("./db", () => ({
  markDirty: mocks.dirty,
  getDb: () => ({
    kots: {
      filter: (fn: (k: (typeof mocks.kots)[number]) => boolean) => ({ toArray: async () => mocks.kots.filter(fn) }),
      put: async (k: (typeof mocks.kots)[number]) => { const i = mocks.kots.findIndex((x) => x.id === k.id); mocks.kots[i] = k; },
    },
    orders: { put: async (o: { id: number }) => { mocks.orders.set(o.id, o); } },
  }),
}));

import { billLabel, hasBillNumber, numberBillForPrint, shortBillNo, stampKotsWithBillNo, withBillNumber } from "./bill-numbering";
import type { Order } from "./types";

const bill = (over: Partial<Order> = {}): Order => ({ uid: "bill-a", id: 7, billNo: "", status: "held", lines: [], total: 60, payments: [], createdAt: 1, ...over } as unknown as Order);

describe("bill numbering at settlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.kots.splice(0, mocks.kots.length, { id: 1, uid: "k1", orderUid: "bill-a", billNo: "" }, { id: 2, uid: "k2", orderUid: "other", billNo: "" });
    mocks.orders.clear();
  });

  it("labels running bills without a number", () => {
    expect(hasBillNumber(bill())).toBe(false);
    expect(billLabel(bill())).toBe("Running bill");
    expect(shortBillNo(bill())).toBe("");
    expect(billLabel(bill({ billNo: "POS/0004" }))).toBe("POS/0004");
    expect(shortBillNo(bill({ billNo: "POS/0004" }))).toBe("0004");
    // A QR bill shows its QR series number until it is settled.
    expect(billLabel({ ...bill(), qrNo: "QR/0001" })).toBe("QR/0001");
    expect(billLabel({ ...bill({ billNo: "POS/0005" }), qrNo: "QR/0001" })).toBe("POS/0005");
  });

  it("gives a running bill its number from the allocator, keyed by the bill uid", async () => {
    const numbered = await withBillNumber(bill());
    expect(numbered.billNo).toBe("POS/0005");
    expect(numbered.numberRequestId).toBe("bill-a");
    expect(mocks.allocate).toHaveBeenCalledWith("POS", "bill-a");
  });

  it("never renumbers a bill that already has a number", async () => {
    const kept = await withBillNumber(bill({ billNo: "POS/0002" }));
    expect(kept.billNo).toBe("POS/0002");
    expect(mocks.allocate).not.toHaveBeenCalled();
  });

  it("stamps the new number on that bill's kitchen tickets only", async () => {
    const changed = await stampKotsWithBillNo(bill({ billNo: "POS/0005" }));
    expect(changed).toEqual([["kot", "k1"]]);
    expect(mocks.kots.map((k) => k.billNo)).toEqual(["POS/0005", ""]);
  });

  it("numbers a running bill on first print and saves it for sync", async () => {
    const printed = await numberBillForPrint(bill());
    expect(printed.billNo).toBe("POS/0005");
    expect(mocks.orders.get(7)).toMatchObject({ billNo: "POS/0005", synced: false });
    expect(mocks.dirty).toHaveBeenCalledWith(["order", "bill-a"], ["kot", "k1"]);
  });

  it("leaves settled bills alone when reprinting", async () => {
    const settled = bill({ billNo: "POS/0003", status: "settled" });
    expect(await numberBillForPrint(settled)).toBe(settled);
    expect(mocks.allocate).not.toHaveBeenCalled();
  });
});
