import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CartLine, Kot, Order, RestaurantTable } from "@/lib/types";

/**
 * End-to-end service on three terminals (counter, waiter phone, Business Manager) through the
 * real sync, numbering, bill-numbering and history code, against the in-memory cloud. Each step
 * checks what every terminal shows, the official POS/KOT series, and that no sync error or
 * conflict is left behind. Realtime is simulated by handing each terminal the cloud row its
 * notice would carry (applyLiveChange), exactly as the live channel does.
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
let numbering: typeof import("@/lib/restaurant-numbering");
let bills: typeof import("@/lib/bill-numbering");
let tables: typeof import("@/lib/table-actions");
let history: typeof import("@/lib/orders-history");

beforeAll(async () => {
  fake = await import("./fakes/fake-dexie");
  server = await import("./fakes/fake-supabase");
  mockModule("dexie", () => ({ default: fake.default }));
  mockModule("@/integrations/supabase/client", () => ({ supabase: server.supabase }));
  try { Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true }); } catch { /* already online */ }
  db = await import("@/lib/db");
  sync = await import("@/lib/cloud-sync");
  numbering = await import("@/lib/restaurant-numbering");
  bills = await import("@/lib/bill-numbering");
  tables = await import("@/lib/table-actions");
  history = await import("@/lib/orders-history");
});

const R = "restaurant-1";
const DEVICES = ["counter", "waiter", "manager"] as const;
type Device = (typeof DEVICES)[number];

beforeEach(async () => {
  fake.fakeDevices.reset();
  server.fakeServer.reset();
  server.fakeServer.versioned = true;
  server.fakeServer.allocator = true;
  sync.resetVersionedServerProbe();
  for (const d of DEVICES) await on(d, () => db.getDb().meta.put({ key: "restaurantId", value: R }));
});

const on = <T>(device: Device, fn: () => Promise<T>) => { fake.fakeDevices.use(device); return fn(); };
const syncNow = (device: Device) => on(device, () => sync.syncCloudData(R));
const syncAll = async () => { for (const d of DEVICES) await syncNow(d); };
const serverRow = (kind: string, id: string) => server.fakeServer.rows.get(`${R}|${kind}|${id}`);
/** What a realtime notice for this cloud row carries. */
const notice = (kind: string, id: string) => ({ eventType: "UPDATE", new: { restaurant_id: R, ...serverRow(kind, id)! } });
/** Deliver the latest cloud change of a record to the other terminals, like the live channel. */
async function broadcast(kind: string, id: string, except: Device) {
  for (const d of DEVICES) if (d !== except) await on(d, () => sync.applyLiveChange(notice(kind, id)));
}

const dish = (itemId: string, qty: number, price: number): CartLine =>
  ({ itemId, name: `Dish ${itemId}`, price, qty, veg: true, gstRate: 0, station: "Indian" }) as CartLine;
const total = (lines: CartLine[]) => lines.reduce((n, l) => n + l.price * l.qty, 0);

function newBill(uid: string, o: Partial<Order>): Order {
  const lines = o.lines ?? [];
  return {
    uid, billNo: "", orderType: "dine-in", lines, subtotal: total(lines), discountPct: 0, discountAmt: 0,
    cgst: 0, sgst: 0, roundOff: 0, total: total(lines), payments: [], status: "held",
    createdAt: Date.parse("2026-11-07T14:00:00Z"), synced: false, ...o,
  } as Order;
}

const localBill = (device: Device, uid: string) => on(device, () => db.getDb().orders.where("uid").equals(uid).first());
const localKots = (device: Device, uid: string) => on(device, () => db.getDb().kots.filter((k) => k.orderUid === uid).toArray());

async function saveBill(o: Order) {
  const d = db.getDb();
  const existing = await d.orders.where("uid").equals(o.uid!).first();
  const id = await d.orders.put(existing?.id !== undefined ? { ...o, id: existing.id } : o);
  await db.markDirty(["order", o.uid!]);
  return Number(id);
}

/** Send the not-yet-sent items to the kitchen: one KOT number per submission, as the counter does. */
async function sendKot(device: Device, uid: string, items: CartLine[], submissionId: string): Promise<string> {
  return on(device, async () => {
    const d = db.getDb();
    const bill = await d.orders.where("uid").equals(uid).first();
    const kotNo = await numbering.allocateRestaurantNumber("KOT", submissionId);
    const numberRequestId = await numbering.allocatedNumberRequestId("KOT", submissionId);
    const kot: Kot = {
      uid: `${submissionId}:Indian`, orderId: bill!.id!, orderUid: uid, tableId: bill!.tableId, tableLabel: bill!.tableLabel,
      tableSection: bill!.tableSection, submissionId, numberRequestId, kotNo, billNo: bill!.billNo, station: "Indian", kind: "order",
      lines: items.map((l) => ({ itemId: l.itemId, name: l.name, qty: l.qty })), status: "new", createdAt: Date.now(),
    };
    await d.kots.put(kot);
    const sent = { ...(bill!.kotSubmittedQty ?? {}) };
    for (const l of items) sent[l.itemId] = (sent[l.itemId] ?? 0) + l.qty;
    await d.orders.put({ ...bill!, kotSubmittedQty: sent, synced: false });
    await db.markDirty(["order", uid], ["kot", kot.uid!]);
    return kotNo;
  });
}

async function settle(device: Device, uid: string, payments: Order["payments"]) {
  await on(device, async () => {
    const d = db.getDb();
    const bill = await d.orders.where("uid").equals(uid).first();
    const numbered = await bills.withBillNumber({ ...bill!, status: "settled", settledAt: Date.now(), payments, synced: false });
    await d.orders.put(numbered);
    const changed = await bills.stampKotsWithBillNo(numbered);
    if (numbered.tableId) {
      const t = await d.restTables.get(numbered.tableId);
      if (t) await d.restTables.put({ ...t, status: "free", runningTotal: 0 });
      await db.markDirty(["table", numbered.tableId]);
    }
    await db.markDirty(["order", uid], ...changed);
  });
}

async function expectClean() {
  for (const d of DEVICES) {
    expect(await on(d, () => sync.listSyncConflicts()), `${d} conflicts`).toEqual([]);
    expect(await on(d, () => db.getDb().outbox.count()), `${d} unsent`).toBe(0);
    expect((await on(d, () => db.getDb().meta.get("syncError")))?.value ?? "", `${d} sync error`).toBe("");
  }
}

const D2: RestaurantTable = { id: "D2", label: "D2", section: "Dine-in", seats: 4, status: "free", runningTotal: 0 };
const ROOM: RestaurantTable = { id: "ROOM-3", label: "Room 3", section: "Rooms", seats: 2, status: "free", runningTotal: 0 };

describe("end-to-end service across counter, waiter and Business Manager", () => {
  it("dine-in, room and takeaway bills stay in step everywhere, with unbroken POS and KOT series", async () => {
    // Floor set up on the counter and shared.
    await on("counter", async () => {
      await db.getDb().restTables.bulkPut([D2, ROOM]);
      await db.markDirty(["table", "D2"], ["table", "ROOM-3"]);
    });
    await syncAll();

    // 1. Waiter opens D2 with guest details and sends the first KOT.
    const biryani = dish("biryani", 2, 280), soup = dish("soup", 1, 120);
    await on("waiter", () => saveBill(newBill("bill-d2", {
      tableId: "D2", tableLabel: "D2", tableSection: "Dine-in", lines: [biryani, soup],
      customer: { name: "Test Guest", phone: "9000000001" }, guestCount: 2,
    })));
    expect(await sendKot("waiter", "bill-d2", [biryani, soup], "sub-1")).toBe("KOT/0001");
    await syncNow("waiter");
    await broadcast("order", "bill-d2", "waiter");
    await broadcast("kot", "sub-1:Indian", "waiter");
    for (const d of ["counter", "manager"] as const) {
      const b = await localBill(d, "bill-d2");
      expect(b?.customer, `${d} guest`).toEqual({ name: "Test Guest", phone: "9000000001" });
      expect(b?.guestCount, `${d} guests`).toBe(2);
      expect(b?.total, `${d} total`).toBe(680);
      expect((await localKots(d, "bill-d2")).map((k) => k.kotNo), `${d} KOT`).toEqual(["KOT/0001"]);
    }
    // A running bill has no POS number until it is printed or settled.
    expect((await localBill("counter", "bill-d2"))?.billNo).toBe("");

    // 2. Business Manager corrects the guest count; the counter shows it from the notice alone.
    await on("manager", async () => { const b = await localBill("manager", "bill-d2"); await saveBill({ ...b!, guestCount: 3 }); });
    await syncNow("manager");
    await broadcast("order", "bill-d2", "manager");
    expect((await localBill("counter", "bill-d2"))?.guestCount).toBe(3);
    expect((await localBill("waiter", "bill-d2"))?.guestCount).toBe(3);

    // 3. Room 3 opened on the counter (a room bill), first KOT.
    const chai = dish("chai", 2, 60);
    await on("counter", () => saveBill(newBill("bill-room3", {
      tableId: "ROOM-3", tableLabel: "Room 3", tableSection: "Rooms", lines: [chai],
      customer: { name: "Room Guest", phone: "9000000002" }, guestCount: 1,
    })));
    expect(await sendKot("counter", "bill-room3", [chai], "sub-2")).toBe("KOT/0002");

    // 4. The counter adds to D2 and sends a second KOT; both terminals see 3 items and two KOTs.
    await syncNow("counter");
    await on("counter", async () => {
      const b = await localBill("counter", "bill-d2");
      const lines = [...b!.lines, dish("naan", 2, 60)];
      await saveBill({ ...b!, lines, subtotal: total(lines), total: total(lines) });
    });
    expect(await sendKot("counter", "bill-d2", [dish("naan", 2, 60)], "sub-3")).toBe("KOT/0003");
    await syncNow("counter");
    for (const [kind, id] of [["order", "bill-d2"], ["order", "bill-room3"], ["kot", "sub-2:Indian"], ["kot", "sub-3:Indian"]] as const) {
      await broadcast(kind, id, "counter");
    }
    for (const d of ["waiter", "manager"] as const) {
      expect((await localBill(d, "bill-d2"))?.total, `${d} D2 total`).toBe(800);
      expect((await localKots(d, "bill-d2")).map((k) => k.kotNo).sort(), `${d} D2 KOTs`).toEqual(["KOT/0001", "KOT/0003"]);
      expect((await localBill(d, "bill-room3"))?.customer?.name, `${d} room guest`).toBe("Room Guest");
    }
    // Opening a table finds its bill on every terminal (what the Tables card and Counter orders card open).
    for (const d of DEVICES) expect((await on(d, () => tables.latestHeldOrder("D2")))?.uid, `${d} opens D2`).toBe("bill-d2");

    // 5. The counter prints D2: it gets POS/0001 now and keeps it; its KOTs carry the bill number.
    const printed = await on("counter", async () => bills.numberBillForPrint((await localBill("counter", "bill-d2"))!));
    expect(printed.billNo).toBe("POS/0001");
    await syncNow("counter");
    await syncAll();
    for (const d of DEVICES) {
      expect((await localBill(d, "bill-d2"))?.billNo, `${d} D2 number`).toBe("POS/0001");
      expect((await localKots(d, "bill-d2")).every((k) => k.billNo === "POS/0001"), `${d} KOTs stamped`).toBe(true);
    }

    // 6. A takeaway on the waiter, paid by UPI straight away: it takes the next number, POS/0002.
    const coffee = dish("coffee", 1, 200);
    await on("waiter", () => saveBill(newBill("bill-ta", { orderType: "takeaway", lines: [coffee], customer: { name: "Walk In", phone: "9000000003" } })));
    expect(await sendKot("waiter", "bill-ta", [coffee], "sub-4")).toBe("KOT/0004");
    await settle("waiter", "bill-ta", [{ mode: "upi", amount: 200 }]);
    await syncNow("waiter");

    // 7. The counter settles D2 in cash: it keeps POS/0001 (no new number); Room 3 settles as POS/0003.
    await syncNow("counter");
    await settle("counter", "bill-d2", [{ mode: "cash", amount: 800 }]);
    await settle("counter", "bill-room3", [{ mode: "upi", amount: 120 }]);
    await syncNow("counter");
    await syncAll();

    // Every terminal: the same three settled bills, numbers in order with no gaps, tables free.
    for (const d of DEVICES) {
      const all = await on(d, () => db.getDb().orders.toArray());
      const numbers = all.map((o) => o.billNo).sort();
      expect(numbers, `${d} POS series`).toEqual(["POS/0001", "POS/0002", "POS/0003"]);
      expect(all.every((o) => o.status === "settled"), `${d} all settled`).toBe(true);
      const kots = (await on(d, () => db.getDb().kots.toArray())).map((k) => k.kotNo).sort();
      expect(kots, `${d} KOT series`).toEqual(["KOT/0001", "KOT/0002", "KOT/0003", "KOT/0004"]);
      const floor = await on(d, () => db.getDb().restTables.toArray());
      expect(floor.every((t) => t.status === "free"), `${d} tables free`).toBe(true);

      // Orders → History on this terminal: settled bills with the right Cash / UPI split.
      const settled = history.historyBills(all, "settled");
      expect(settled.map((o) => o.billNo).sort(), `${d} history`).toEqual(["POS/0001", "POS/0002", "POS/0003"]);
      expect(settled.filter((o) => history.paidBy(o, "cash")).map((o) => o.billNo), `${d} cash`).toEqual(["POS/0001"]);
      expect(settled.filter((o) => history.paidBy(o, "upi")).map((o) => o.billNo).sort(), `${d} UPI`).toEqual(["POS/0002", "POS/0003"]);
    }
    // The cloud holds the same and recorded each payment once.
    expect((serverRow("order", "bill-d2")!.payload as Order).billNo).toBe("POS/0001");
    expect(server.fakeServer.payments.size).toBe(3);
    await expectClean();
  });

  it("a bill deleted in the cloud disappears from every terminal and its numbers are reused next", async () => {
    await on("counter", () => saveBill(newBill("bill-gone", { tableId: "D2", tableLabel: "D2", lines: [dish("tea", 1, 40)], customer: { name: "X", phone: "9000000009" }, guestCount: 1 })));
    expect(await sendKot("counter", "bill-gone", [dish("tea", 1, 40)], "sub-gone")).toBe("KOT/0001");
    await syncNow("counter");
    await syncAll();
    expect(await localBill("waiter", "bill-gone")).toBeDefined();

    // Office cleanup (as done for Room 12): tombstone the bill and KOT and roll the KOT series back.
    for (const [kind, id] of [["order", "bill-gone"], ["kot", "sub-gone:Indian"]] as const) {
      const row = serverRow(kind, id)!;
      server.fakeServer.rows.set(`${R}|${kind}|${id}`, { ...row, deleted: true, version: (row.version ?? 1) + 1, updated_at: new Date(server.fakeServer.now += 1000).toISOString() });
    }
    server.fakeServer.sequences.set(`${R}|KOT`, 0);
    await syncAll();
    for (const d of DEVICES) {
      expect(await localBill(d, "bill-gone"), `${d} bill gone`).toBeUndefined();
      expect(await localKots(d, "bill-gone"), `${d} KOT gone`).toEqual([]);
    }
    // The next KOT takes the freed number.
    await on("waiter", () => saveBill(newBill("bill-next", { tableId: "D2", tableLabel: "D2", lines: [dish("tea", 1, 40)], customer: { name: "Y", phone: "9000000008" }, guestCount: 1 })));
    expect(await sendKot("waiter", "bill-next", [dish("tea", 1, 40)], "sub-next")).toBe("KOT/0001");
    await syncNow("waiter");
    await syncAll();
    await expectClean();
  });
});
