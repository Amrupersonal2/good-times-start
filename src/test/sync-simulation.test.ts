import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kot, MenuItem, Order, RestaurantTable } from "@/lib/types";

/**
 * Multi-device sync regression tests. These run the app's real sync code
 * (cloud-sync, db, stock-actions) against an in-memory device database and
 * an in-memory server, switching between "devices" the way a counter, a
 * waiter tablet and a kitchen screen share one restaurant.
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
let stock: typeof import("@/lib/stock-actions");

beforeAll(async () => {
  fake = await import("./fakes/fake-dexie");
  server = await import("./fakes/fake-supabase");
  mockModule("dexie", () => ({ default: fake.default }));
  mockModule("@/integrations/supabase/client", () => ({ supabase: server.supabase }));
  try { Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true }); } catch { /* already online */ }
  db = await import("@/lib/db");
  sync = await import("@/lib/cloud-sync");
  stock = await import("@/lib/stock-actions");
});

beforeEach(() => {
  fake.fakeDevices.reset();
  server.fakeServer.reset();
});

const R = "restaurant-1";
const on = <T>(device: string, fn: () => Promise<T>) => { fake.fakeDevices.use(device); return fn(); };
const syncNow = (device: string, restaurant = R) => on(device, () => sync.syncCloudData(restaurant));

const dish = (id: string, price = 100): MenuItem => ({ id, name: `Dish ${id}`, category: "Mains", price, veg: true, gstRate: 5, station: "Indian", available: true });
const table = (id: string, status: RestaurantTable["status"] = "free"): RestaurantTable => ({ id, label: id, section: "AC", seats: 4, status, runningTotal: 0 });
function order(uid: string, o: Partial<Order> = {}): Order {
  return {
    uid, billNo: `C1/26-27/${uid.slice(-4).padStart(4, "0")}`, orderType: "dine-in", tableId: "T1",
    lines: [{ itemId: "d1", name: "Dish d1", price: 100, qty: 2, veg: true, gstRate: 5, station: "Indian" }],
    subtotal: 200, discountPct: 0, discountAmt: 0, cgst: 5, sgst: 5, roundOff: 0, total: 210, payments: [], status: "held",
    createdAt: Date.parse("2026-10-17T13:00:00Z"), synced: false, ...o,
  };
}

async function addOrder(o: Order, kots: Omit<Kot, "orderId">[] = []) {
  const d = db.getDb();
  const id = Number(await d.orders.add(o));
  for (const k of kots) await d.kots.add({ ...k, orderId: id });
  await db.markDirty(["order", o.uid!], ...kots.map((k): ["kot", string] => ["kot", k.uid!]));
  return id;
}

describe("multi-device sync", () => {
  it("delivers a KOT sent at the counter to the kitchen screen, linked to the kitchen's copy of the bill", async () => {
    await on("counter", () => addOrder(order("o-0001"), [{ uid: "k-1", orderUid: "o-0001", billNo: "C1/26-27/0001", station: "Tandoor", kind: "order", lines: [{ name: "Naan", qty: 2 }], status: "new", createdAt: 1 }]));
    await syncNow("counter");
    await syncNow("kitchen");

    const [kitchenOrder, kitchenKot] = await on("kitchen", async () => [await db.getDb().orders.where("uid").equals("o-0001").first(), await db.getDb().kots.where("uid").equals("k-1").first()] as const);
    expect(kitchenOrder?.total).toBe(210);
    expect(kitchenOrder?.synced).toBe(true);
    expect(kitchenKot?.orderId).toBe(kitchenOrder?.id);
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(0);
  });

  it("keeps sales made offline and uploads them once the connection is back", async () => {
    server.fakeServer.offline = true;
    for (let i = 1; i <= 30; i += 1) await on("counter", () => addOrder(order(`o-${String(i).padStart(4, "0")}`, { status: "settled" })));
    await expect(syncNow("counter")).rejects.toBeTruthy();
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(30);
    expect(await on("counter", () => db.getDb().orders.count())).toBe(30);

    server.fakeServer.offline = false;
    await syncNow("counter");
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(0);
    await syncNow("manager-phone");
    expect(await on("manager-phone", () => db.getDb().orders.where("status").equals("settled").count())).toBe(30);
  });

  it("settles two edits to the same table by push order, and every device ends up agreeing", async () => {
    for (const device of ["counter", "waiter"]) {
      await on(device, async () => { await db.getDb().restTables.put(table("T1")); });
    }
    await on("counter", async () => { await db.getDb().restTables.put(table("T1")); await db.markDirty(["table", "T1"]); });
    await syncNow("counter");
    await syncNow("waiter");

    // Waiter reserves T1 while offline; meanwhile the counter seats guests at T1 and syncs first.
    await on("waiter", async () => { await db.getDb().restTables.update("T1", { status: "reserved" }); await db.markDirty(["table", "T1"]); });
    await on("counter", async () => { await db.getDb().restTables.update("T1", { status: "occupied", runningTotal: 450 }); await db.markDirty(["table", "T1"]); });
    await syncNow("counter");
    await syncNow("waiter");
    await syncNow("counter");

    const statuses = await Promise.all(["counter", "waiter"].map((d) => on(d, async () => (await db.getDb().restTables.get("T1"))?.status)));
    expect(statuses).toEqual(["reserved", "reserved"]);
    expect([...server.fakeServer.rows.values()].find((r) => r.record_id === "T1")?.payload).toMatchObject({ status: "reserved" });
  });

  it("pages a big backlog to a new device and doesn't download it again", async () => {
    await on("counter", async () => {
      const items = Array.from({ length: 1234 }, (_, i) => dish(`d${i}`, 100 + i));
      await db.getDb().menu.bulkPut(items);
      await db.markDirty(...items.map((m): ["menu", string] => ["menu", m.id]));
    });
    await syncNow("counter");
    expect(server.fakeServer.requests.upsert).toBe(7); // batches of 200

    server.fakeServer.requests = { upsert: 0, select: 0, rowsReturned: 0 };
    await syncNow("new-tablet");
    expect(await on("new-tablet", () => db.getDb().menu.count())).toBe(1234);
    expect(server.fakeServer.requests.select).toBe(3); // pages of 500

    server.fakeServer.requests = { upsert: 0, select: 0, rowsReturned: 0 };
    await syncNow("new-tablet");
    // Only rows inside the 10-second safety overlap come back.
    expect(server.fakeServer.requests.rowsReturned).toBeLessThanOrEqual(11);
    expect(await on("new-tablet", () => db.getDb().menu.count())).toBe(1234);
  });

  it("still picks up a row that committed with a timestamp just behind the last pull", async () => {
    await on("counter", async () => { await db.getDb().menu.put(dish("first")); await db.markDirty(["menu", "first"]); });
    await syncNow("counter");
    await syncNow("kitchen");
    const cursor = await on("kitchen", async () => (await db.getDb().meta.get("pullCursor"))?.value);
    expect(typeof cursor).toBe("string");
    const behind = Date.parse(String(cursor)) - 5000;
    server.fakeServer.insertAt({ restaurant_id: R, kind: "menu", record_id: "late", payload: dish("late"), deleted: false }, behind);
    await syncNow("kitchen");
    expect(await on("kitchen", () => db.getDb().menu.get("late"))).toBeTruthy();
  });

  it("refuses a cashier's menu and settings changes without holding up their sales, and puts the menu back", async () => {
    await on("owner", async () => { await db.getDb().menu.put(dish("d1", 100)); await db.markDirty(["menu", "d1"]); });
    await syncNow("owner");
    await syncNow("cashier");

    server.fakeServer.staffOnly.add("cashier");
    await on("cashier", async () => {
      await db.saveSettings({ name: "Renamed by cashier" });
      await db.getDb().menu.put(dish("d1", 150)); // price change
      await db.getDb().menu.put(dish("new-dish", 90)); // new dish
      await db.markDirty(["menu", "d1"], ["menu", "new-dish"]);
      await addOrder(order("o-5001", { status: "settled" }));
    });
    await syncNow("cashier"); // no error: the sale goes through

    expect(await on("cashier", () => db.getDb().outbox.count())).toBe(0);
    const kinds = [...server.fakeServer.rows.values()].map((r) => `${r.kind}:${r.record_id}`).sort();
    expect(kinds).toEqual(["menu:d1", "order:o-5001"]);
    expect([...server.fakeServer.rows.values()].find((r) => r.record_id === "d1")?.payload).toMatchObject({ price: 100 });
    // The cashier's screen matches the cloud again.
    expect((await on("cashier", () => db.getDb().menu.get("d1")))?.price).toBe(100);
    expect(await on("cashier", () => db.getDb().menu.get("new-dish"))).toBeUndefined();
    const notice = await on("cashier", async () => (await db.getDb().meta.get("syncNotice"))?.value);
    expect(JSON.parse(String(notice))).toMatchObject({ count: 3 });
    expect(sync.describeNotice(notice)).toMatch(/3 changes to restaurant details, menu were undone/);
  });

  it("drops test bills a device held offline from before launch, and keeps everything made after", async () => {
    // Offline since before launch, the counter holds an old test bill and its ticket.
    await on("old-counter", () => addOrder(order("o-test", { status: "held", createdAt: Date.parse("2026-10-19T11:00:00Z") })));
    server.fakeServer.launchedAt = Date.parse("2026-10-24T04:05:00Z");
    // After launch it takes a real bill, then reconnects.
    await on("old-counter", () => addOrder(order("o-real", { status: "settled", createdAt: Date.parse("2026-10-25T13:54:00Z") })));
    await syncNow("old-counter");

    const kept = [...server.fakeServer.rows.values()].filter((r) => r.kind === "order").map((r) => r.record_id);
    expect(kept).toEqual(["o-real"]);
    // The device no longer shows the old test bill, has nothing stuck waiting, and says why.
    expect(await on("old-counter", () => db.getDb().orders.where("uid").equals("o-test").first())).toBeUndefined();
    expect(await on("old-counter", () => db.getDb().outbox.count())).toBe(0);
    const notice = await on("old-counter", async () => (await db.getDb().meta.get("syncNotice"))?.value);
    expect(sync.describeNotice(notice)).toMatch(/1 test record from before launch .* was removed from this device/);
    expect(sync.describeNotice(notice)).not.toMatch(/owner or a manager/);
  });

  it("won't let staff rewrite a settled bill, and restores the original on their device", async () => {
    await on("counter", () => addOrder(order("o-6001", { status: "settled", total: 210 })));
    await syncNow("counter");
    server.fakeServer.staffOnly.add("counter");
    await on("counter", async () => {
      const d = db.getDb();
      const o = await d.orders.where("uid").equals("o-6001").first();
      await d.orders.update(o!.id!, { total: 10 });
      await db.markDirty(["order", "o-6001"]);
      await addOrder(order("o-6002", { status: "held" }));
    });
    await syncNow("counter");
    expect([...server.fakeServer.rows.values()].find((r) => r.record_id === "o-6001")?.payload).toMatchObject({ total: 210 });
    expect([...server.fakeServer.rows.values()].some((r) => r.record_id === "o-6002")).toBe(true);
    expect((await on("counter", () => db.getDb().orders.where("uid").equals("o-6001").first()))?.total).toBe(210);
  });

  it("keeps retrying when the cloud can't be reached, rather than dropping changes", async () => {
    server.fakeServer.offline = true;
    await on("counter", () => addOrder(order("o-7001")));
    await expect(syncNow("counter")).rejects.toBeTruthy();
    expect(await on("counter", () => db.getDb().outbox.count())).toBe(1);
  });

  it("shares a guest's WhatsApp yes with every device, and campaigns only reach guests who said yes", async () => {
    const marketing = await import("@/lib/marketing-actions");
    const logic = await import("@/lib/marketing-logic");
    await on("counter", async () => {
      await marketing.setWhatsappConsent("+91 90000 00001", true, "in person", "Asha");
      await db.getDb().customers.put({ id: "9000000002", phone: "9000000002", name: "Bina", createdAt: 1 });
      await db.markDirty(["customer", "9000000002"]);
    });
    await syncNow("counter");
    await syncNow("manager-phone");
    const guests = await on("manager-phone", async () => logic.buildAudience(await db.getDb().customers.toArray(), []));
    expect(guests.find((g) => g.id === "9000000001")?.optIn).toBe(true);
    const { ready } = logic.pickRecipients(guests, "all", Date.now());
    expect(ready.map((r) => r.name)).toEqual(["Asha"]);

    // Messaging her records the time on every device, so she isn't messaged again too soon.
    await on("manager-phone", () => marketing.markMessaged(["9000000001"]));
    await syncNow("manager-phone");
    await syncNow("counter");
    const again = await on("counter", async () => logic.pickRecipients(logic.buildAudience(await db.getDb().customers.toArray(), []), "all", Date.now()));
    expect(again.ready).toEqual([]);
    expect(again.skipped.map((s) => s.reason).sort()).toEqual(["messaged recently", "no consent"]);
  });

  it("won't mix two restaurants' data on one device", async () => {
    await syncNow("counter", "restaurant-1");
    await expect(syncNow("counter", "restaurant-2")).rejects.toThrow(/another restaurant/);
  });

  it("keeps stock levels right when ledger entries arrive more than once", async () => {
    await on("store-room", async () => {
      await stock.recordStockEntry({ type: "purchase", items: [{ materialId: "paneer", qty: 5, unitCost: 380 }] });
      await stock.recordStockEntry({ id: "sale:o-1", type: "sale", items: [{ materialId: "paneer", qty: -0.4 }] });
      await stock.recordStockEntry({ id: "sale:o-1", type: "sale", items: [{ materialId: "paneer", qty: -0.4 }] }); // same bill twice
    });
    expect((await on("store-room", () => db.getMaterialLevels())).get("paneer")).toBe(4.6);
    await syncNow("store-room");
    await syncNow("counter");
    await syncNow("counter"); // overlap re-delivers recent entries
    expect((await on("counter", () => db.getMaterialLevels())).get("paneer")).toBe(4.6);
  });

  it("removes a deleted dish from every device", async () => {
    await on("counter", async () => { await db.getDb().menu.put(dish("gone")); await db.markDirty(["menu", "gone"]); });
    await syncNow("counter");
    await syncNow("waiter");
    expect(await on("waiter", () => db.getDb().menu.get("gone"))).toBeTruthy();
    await on("counter", async () => { await db.getDb().menu.delete("gone"); await db.markDirty(["menu", "gone"]); });
    await syncNow("counter");
    await syncNow("waiter");
    expect(await on("waiter", () => db.getDb().menu.get("gone"))).toBeUndefined();
  });

  it("keeps both bills when two counters settle at the same moment", async () => {
    await on("counter-1", () => addOrder(order("o-1001", { status: "settled", billNo: "C1/26-27/0001" })));
    await on("counter-2", () => addOrder(order("o-2001", { status: "settled", billNo: "C2/26-27/0001" })));
    await syncNow("counter-1");
    await syncNow("counter-2");
    await syncNow("counter-1");
    for (const d of ["counter-1", "counter-2"]) {
      expect((await on(d, () => db.getDb().orders.toArray())).map((o) => o.billNo).sort()).toEqual(["C1/26-27/0001", "C2/26-27/0001"]);
    }
  });

  it("finds a table's running bill by index, ignoring its settled history", async () => {
    await on("counter", async () => {
      for (let i = 0; i < 200; i += 1) await db.getDb().orders.add(order(`o-h${i}`, { status: "settled", createdAt: i }));
      await db.getDb().orders.add(order("o-run", { status: "held", createdAt: 999 }));
    });
    const { latestHeldOrder } = await import("@/lib/table-actions");
    expect((await on("counter", () => latestHeldOrder("T1")))?.uid).toBe("o-run");
  });

  it("indexes bills from older app versions by guest phone, so the Guests page finds them without scanning every bill", async () => {
    server.fakeServer.insertAt({ restaurant_id: R, kind: "order", record_id: "o-old", payload: order("o-old", { status: "settled", customer: { phone: "+91 98765 43210" } }), deleted: false }, server.fakeServer.now);
    await syncNow("tablet");
    const found = await on("tablet", () => db.getDb().orders.where("customerId").above("").toArray());
    expect(found.map((o) => [o.uid, o.customerId])).toEqual([["o-old", "9876543210"]]);
  });
});
