import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kot, Order, RestaurantTable } from "@/lib/types";

/**
 * Concurrency regression tests for migration 0020 (versioned records, idempotent
 * KOTs, atomic settlement). They run the real sync code against the in-memory
 * server with `versioned` on, switching between devices like separate sessions.
 */

type Mocker = { mock?: { module?: (p: string, f: () => unknown) => void }; vi?: { doMock: (p: string, f: () => unknown) => void } };
function mockModule(path: string, factory: () => unknown) {
  const api = testApi as unknown as Mocker;
  if (typeof api.mock?.module === "function") api.mock.module(path, factory);
  else api.vi?.doMock(path, factory);
}

let fake: typeof import("./fakes/fake-dexie");
let server: typeof import("./fakes/fake-supabase");
let db: typeof import("@/lib/db");
let sync: typeof import("@/lib/cloud-sync");

beforeAll(async () => {
  fake = await import("./fakes/fake-dexie");
  server = await import("./fakes/fake-supabase");
  mockModule("dexie", () => ({ default: fake.default }));
  mockModule("@/integrations/supabase/client", () => ({ supabase: server.supabase }));
  try { Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true }); } catch { /* already online */ }
  db = await import("@/lib/db");
  sync = await import("@/lib/cloud-sync");
});

beforeEach(() => {
  fake.fakeDevices.reset();
  server.fakeServer.reset();
  server.fakeServer.versioned = true;
  sync.resetVersionedServerProbe();
});

const R = "restaurant-1";
const on = <T>(device: string, fn: () => Promise<T>) => { fake.fakeDevices.use(device); return fn(); };
const syncNow = (device: string) => on(device, () => sync.syncCloudData(R));
const serverRow = (kind: string, id: string) => server.fakeServer.rows.get(`${R}|${kind}|${id}`);

const line = (itemId: string, qty: number, price = 100) => ({ itemId, name: `Dish ${itemId}`, price, qty, veg: true, gstRate: 5, station: "Indian" });
function order(uid: string, o: Partial<Order> = {}): Order {
  return {
    uid, billNo: `C1/26-27/${uid.slice(-4)}`, orderType: "dine-in", tableId: "T1",
    lines: [line("d1", 2)], subtotal: 200, discountPct: 0, discountAmt: 0, cgst: 5, sgst: 5, roundOff: 0, total: 210,
    payments: [], status: "held", createdAt: Date.parse("2026-10-17T13:00:00Z"), synced: false, ...o,
  };
}
const table = (id: string, status: RestaurantTable["status"]): RestaurantTable => ({ id, label: id, section: "Dine-in", seats: 4, status, runningTotal: 0 });

async function save(o: Order) {
  const d = db.getDb();
  const existing = await d.orders.where("uid").equals(o.uid!).first();
  await d.orders.put(existing?.id !== undefined ? { ...o, id: existing.id } : o);
  await db.markDirty(["order", o.uid!]);
}
async function editLines(uid: string, edit: (lines: Order["lines"]) => Order["lines"]) {
  const current = await db.getDb().orders.where("uid").equals(uid).first();
  await save({ ...current!, lines: edit(current!.lines) });
}
const localOrder = (device: string, uid: string) => on(device, () => db.getDb().orders.where("uid").equals(uid).first());
const qtyOf = (o: Order | undefined, itemId: string) => o?.lines.find((l) => l.itemId === itemId)?.qty;

/** Both devices start from the same synced running bill. */
async function shared(uid = "o-0001") {
  await on("counter", () => save(order(uid)));
  await syncNow("counter");
  await syncNow("waiter");
}

describe("optimistic concurrency (record versions)", () => {
  it("the server owns versions: every write bumps them by one", async () => {
    await shared();
    expect(serverRow("order", "o-0001")?.version).toBe(1);
    await on("counter", () => editLines("o-0001", (l) => [...l, line("d2", 1)]));
    await syncNow("counter");
    expect(serverRow("order", "o-0001")?.version).toBe(2);
  });

  it("refuses a stale write and merges independent additions on two devices without losing either", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", (l) => [...l, line("naan", 2, 40)]));
    await on("waiter", () => editLines("o-0001", (l) => [...l, line("dal", 1, 180)]));
    await syncNow("counter");
    await syncNow("waiter"); // stale base: server says conflict, waiter merges and re-sends
    await syncNow("counter");

    const final = serverRow("order", "o-0001")!.payload as Order;
    expect(final.lines.map((l) => [l.itemId, l.qty]).sort()).toEqual([["d1", 2], ["dal", 1], ["naan", 2]]);
    expect(final.total).toBeGreaterThan(210);
    expect(qtyOf(await localOrder("counter", "o-0001"), "dal")).toBe(1);
    expect(await on("waiter", () => sync.listSyncConflicts())).toEqual([]);
  });

  it("adds quantities when both devices add the same dish, exactly once even after retries", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", (l) => [...l, line("naan", 1, 40)]));
    // A different note keeps the payloads distinct: byte-identical writes are treated as one retried write.
    await on("waiter", () => editLines("o-0001", (l) => [...l, { ...line("naan", 1, 40), note: "butter" }]));
    await syncNow("counter");
    await syncNow("waiter");
    await syncNow("waiter");
    await syncNow("counter");
    expect(qtyOf(serverRow("order", "o-0001")!.payload as Order, "naan")).toBe(2);
  });

  it("keeps a removal made on one device while another device adds a different dish", async () => {
    await on("counter", () => save(order("o-0001", { lines: [line("d1", 2), line("soup", 1)] })));
    await syncNow("counter"); await syncNow("waiter");
    await on("counter", () => editLines("o-0001", (l) => l.filter((x) => x.itemId !== "soup")));
    await on("waiter", () => editLines("o-0001", (l) => l.map((x) => (x.itemId === "d1" ? { ...x, qty: 3 } : x))));
    await syncNow("counter"); await syncNow("waiter");
    const final = serverRow("order", "o-0001")!.payload as Order;
    expect(final.lines.map((l) => [l.itemId, l.qty])).toEqual([["d1", 3]]);
  });

  it("detects a write that lands from another session in the middle of a push", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", (l) => [...l, line("naan", 1, 40)]));
    server.fakeServer.beforeRow = (row) => {
      if (row.record_id !== "o-0001") return;
      server.fakeServer.beforeRow = null;
      // Another session commits first (a legacy client upserting directly).
      void server.supabase.from("restaurant_records").upsert([{ restaurant_id: R, kind: "order", record_id: "o-0001", payload: { ...order("o-0001"), lines: [line("d1", 2), line("tea", 1, 20)] }, deleted: false }]);
    };
    await syncNow("counter");
    const final = serverRow("order", "o-0001")!.payload as Order;
    expect(final.lines.map((l) => l.itemId).sort()).toEqual(["d1", "naan", "tea"]);
  });

  it("detects legacy-client overwrites through the version they bump", async () => {
    await shared();
    await server.supabase.from("restaurant_records").upsert([{ restaurant_id: R, kind: "order", record_id: "o-0001", payload: { ...order("o-0001"), lines: [line("d1", 5)] }, deleted: false }]);
    expect(serverRow("order", "o-0001")?.version).toBe(2);
    await on("waiter", () => editLines("o-0001", (l) => [...l, line("dal", 1)]));
    await syncNow("waiter");
    const final = serverRow("order", "o-0001")!.payload as Order;
    expect(qtyOf(final, "d1")).toBe(5);
    expect(qtyOf(final, "dal")).toBe(1);
  });
});

describe("staff conflict alerts", () => {
  it("keeps the local unsynced copy, shows a conflict, and lets staff take the cloud copy", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", () => [])); // removed d1
    await on("waiter", () => editLines("o-0001", (l) => l.map((x) => ({ ...x, qty: 4 })))); // edited d1
    await syncNow("counter");
    await syncNow("waiter");

    const conflicts = await on("waiter", () => sync.listSyncConflicts());
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.reasons.join(" ")).toMatch(/removed on one device/);
    await syncNow("waiter"); // a pull must not overwrite the waiter's copy while staff decide
    expect(qtyOf(await localOrder("waiter", "o-0001"), "d1")).toBe(4);

    await on("waiter", () => sync.resolveSyncConflict(conflicts[0]!.key, "cloud"));
    expect((await localOrder("waiter", "o-0001"))?.lines).toEqual([]);
    expect(await on("waiter", () => sync.listSyncConflicts())).toEqual([]);
  });

  it("'keep mine' re-sends the local copy on top of the latest version", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", () => []));
    await on("waiter", () => editLines("o-0001", (l) => l.map((x) => ({ ...x, qty: 4 }))));
    await syncNow("counter"); await syncNow("waiter");
    const [c] = await on("waiter", () => sync.listSyncConflicts());
    await on("waiter", () => sync.resolveSyncConflict(c!.key, "mine"));
    await syncNow("waiter");
    expect(qtyOf(serverRow("order", "o-0001")!.payload as Order, "d1")).toBe(4);
  });
});

describe("idempotent KOT submission", () => {
  const kot = (uid: string, o: Partial<Kot> = {}): Kot => ({ uid, orderId: 1, orderUid: "o-0001", billNo: "C1/26-27/0001", station: "Tandoor", kind: "order", lines: [{ name: "Naan", qty: 2 }], status: "new", createdAt: 1, submissionId: "sub-1", ...o } as Kot);

  it("stores one logical ticket per submission and station, and drops the local duplicate", async () => {
    await on("counter", async () => {
      await db.getDb().kots.add(kot("k-a"));
      await db.getDb().kots.add(kot("k-b")); // the same submission retried after a crash
      await db.getDb().kots.add(kot("k-c", { station: "Bar" }));
      await db.markDirty(["kot", "k-a"], ["kot", "k-b"], ["kot", "k-c"]);
    });
    await syncNow("counter");
    const kots = [...server.fakeServer.rows.values()].filter((r) => r.kind === "kot");
    expect(kots.map((r) => r.record_id).sort()).toEqual(["k-a", "k-c"]);
    expect(await on("counter", () => db.getDb().kots.count())).toBe(2);
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(0);
  });

  it("a second device replaying the same submission doesn't create another ticket", async () => {
    await on("counter", async () => { await db.getDb().kots.add(kot("k-a")); await db.markDirty(["kot", "k-a"]); });
    await syncNow("counter");
    await on("tablet", async () => { await db.getDb().kots.add(kot("k-z")); await db.markDirty(["kot", "k-z"]); });
    await syncNow("tablet");
    expect([...server.fakeServer.rows.values()].filter((r) => r.kind === "kot")).toHaveLength(1);
  });

  it("legacy upserts of a duplicate ticket are skipped by the server too", async () => {
    await on("counter", async () => { await db.getDb().kots.add(kot("k-a")); await db.markDirty(["kot", "k-a"]); });
    await syncNow("counter");
    await server.supabase.from("restaurant_records").upsert([{ restaurant_id: R, kind: "kot", record_id: "k-dup", payload: kot("k-dup"), deleted: false }]);
    expect(serverRow("kot", "k-dup")).toBeUndefined();
  });
});

describe("retries", () => {
  it("a push whose response was lost is re-sent safely (identical content is not a conflict)", async () => {
    await shared();
    await on("counter", () => editLines("o-0001", (l) => [...l, line("naan", 1, 40)]));
    const realRpc = server.supabase.rpc.bind(server.supabase);
    let dropped = false;
    (server.supabase as { rpc: typeof realRpc }).rpc = async (...args: Parameters<typeof realRpc>) => {
      const result = await realRpc(...args);
      if (!dropped) { dropped = true; return { data: null, error: { message: "Failed to fetch", code: "NETWORK" } }; }
      return result;
    };
    try {
      await expect(syncNow("counter")).rejects.toBeTruthy();
      await syncNow("counter");
    } finally { (server.supabase as { rpc: typeof realRpc }).rpc = realRpc; }
    expect(qtyOf(serverRow("order", "o-0001")!.payload as Order, "naan")).toBe(1);
    expect(serverRow("order", "o-0001")?.version).toBe(2);
    expect(await on("counter", () => sync.listSyncConflicts())).toEqual([]);
  });
});

describe("atomic settlement", () => {
  async function settleOn(device: string, uid: string, payments: Order["payments"]) {
    await on(device, async () => {
      const d = db.getDb();
      const current = await d.orders.where("uid").equals(uid).first();
      await d.orders.put({ ...current!, status: "settled", settledAt: Date.now(), payments });
      await d.stockEntries.put({ id: `sale:${uid}`, type: "sale", at: Date.now(), items: [{ materialId: "flour", qty: -1 }] });
      await d.restTables.put(table("T1", "free"));
      await db.markDirty(["order", uid], ["stock_entry", `sale:${uid}`], ["table", "T1"]);
    });
  }

  it("records payment, stock ledger and table release together, and payments once even when re-sent", async () => {
    await shared();
    await settleOn("counter", "o-0001", [{ mode: "cash", amount: 100 }, { mode: "upi", amount: 110 }]);
    await syncNow("counter");
    expect((serverRow("order", "o-0001")!.payload as Order).status).toBe("settled");
    expect(serverRow("stock_entry", "sale:o-0001")).toBeDefined();
    expect((serverRow("table", "T1")!.payload as RestaurantTable).status).toBe("free");
    expect(server.fakeServer.payments.size).toBe(2);

    // Duplicate settlement push (retry / second tap): no extra payments.
    await on("counter", () => db.markDirty(["order", "o-0001"]));
    await syncNow("counter");
    expect(server.fakeServer.payments.size).toBe(2);
  });

  it("commits nothing when the bill changed elsewhere: no payment, no stock, table stays occupied", async () => {
    await on("counter", async () => { await db.getDb().restTables.put(table("T1", "occupied")); await db.markDirty(["table", "T1"]); });
    await shared();
    await on("waiter", () => editLines("o-0001", (l) => [...l, line("dessert", 1, 150)]));
    await syncNow("waiter");
    await settleOn("counter", "o-0001", [{ mode: "cash", amount: 210 }]); // would under-charge
    await syncNow("counter");

    expect((serverRow("order", "o-0001")!.payload as Order).status).toBe("held");
    expect(serverRow("stock_entry", "sale:o-0001")).toBeUndefined();
    expect((serverRow("table", "T1")!.payload as RestaurantTable).status).toBe("occupied");
    expect(server.fakeServer.payments.size).toBe(0);
    const [c] = await on("counter", () => sync.listSyncConflicts());
    expect(c?.related?.sort()).toEqual(["stock_entry:sale:o-0001", "table:T1"]);
    expect((await localOrder("counter", "o-0001"))?.status).toBe("settled"); // kept locally for staff
  });

  it("split bill: the paid part settles atomically while the rest stays running", async () => {
    await shared();
    await on("counter", async () => {
      await save(order("o-part", { lines: [line("d1", 1)], status: "settled", payments: [{ mode: "card", amount: 105 }], total: 105 }));
      await editLines("o-0001", () => [line("d1", 1)]);
    });
    await syncNow("counter");
    expect((serverRow("order", "o-part")!.payload as Order).status).toBe("settled");
    expect((serverRow("order", "o-0001")!.payload as Order).status).toBe("held");
    expect([...server.fakeServer.payments.values()]).toEqual([{ mode: "card", amount: 105 }]);
  });
});

describe("rollout compatibility", () => {
  it("falls back to the legacy upsert path when the migration isn't applied yet", async () => {
    server.fakeServer.versioned = false;
    await on("counter", () => save(order("o-0001")));
    await syncNow("counter");
    expect(serverRow("order", "o-0001")).toBeDefined();
    expect(server.fakeServer.requests.upsert).toBeGreaterThan(0);
  });

  it("keeps offline sales queued and pushes them through the versioned path when back online", async () => {
    server.fakeServer.offline = true;
    await on("counter", () => save(order("o-0001", { status: "settled", payments: [{ mode: "cash", amount: 210 }] })));
    await expect(syncNow("counter")).rejects.toBeTruthy();
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(1);
    server.fakeServer.offline = false;
    await syncNow("counter");
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(0);
    expect(server.fakeServer.payments.size).toBe(1);
  });
});
