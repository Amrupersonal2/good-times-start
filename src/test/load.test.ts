import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Kot, Order } from "@/lib/types";

/**
 * Load tests: a Friday-night rush across many devices, run through the app's
 * real sync code against the in-memory device database and server. They check
 * that nothing is lost or doubled under volume and a flaky connection, and
 * that sync stays fast enough to keep up.
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
});

const R = "restaurant-1";
const on = <T>(device: string, fn: () => Promise<T>) => { fake.fakeDevices.use(device); return fn(); };
const trySync = async (device: string) => { try { await on(device, () => sync.syncCloudData(R)); return true; } catch { return false; } };

/** Small deterministic random numbers, so a failing run can be replayed exactly. */
function seeded(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

function bill(device: string, n: number, settled: boolean): Order {
  const qty = 1 + (n % 3);
  const price = 120 + (n % 7) * 30;
  const subtotal = qty * price;
  return {
    uid: `${device}-${n}`, billNo: `${device.toUpperCase()}/26-27/${String(n).padStart(4, "0")}`, orderType: n % 4 === 0 ? "takeaway" : "dine-in",
    lines: [{ itemId: `d${n % 40}`, name: `Dish ${n % 40}`, price, qty, veg: n % 2 === 0, gstRate: 5, station: n % 3 ? "Kitchen" : "Bar" }],
    subtotal, discountPct: 0, discountAmt: 0, cgst: subtotal * 0.025, sgst: subtotal * 0.025, roundOff: 0, total: subtotal * 1.05,
    payments: settled ? [{ mode: "cash", amount: subtotal * 1.05 }] : [], status: settled ? "settled" : "held",
    createdAt: Date.parse("2026-10-17T13:00:00Z") + n * 1000, synced: false,
  };
}

async function ring(device: string, n: number) {
  const o = bill(device, n, n % 5 !== 0);
  const d = db.getDb();
  const id = Number(await d.orders.add(o));
  const kot: Kot = { uid: `${device}-k${n}`, orderId: id, orderUid: o.uid ?? "", billNo: o.billNo, station: o.lines[0]!.station, kind: "order", lines: [{ name: o.lines[0]!.name, qty: o.lines[0]!.qty }], status: "new", createdAt: o.createdAt };
  await d.kots.add(kot);
  await db.markDirty(["order", o.uid ?? ""], ["kot", kot.uid ?? ""]);
}

async function snapshot(device: string) {
  return on(device, async () => {
    const orders = await db.getDb().orders.toArray();
    const kots = await db.getDb().kots.toArray();
    return {
      orders: orders.length,
      uniqueOrders: new Set(orders.map((o) => o.uid)).size,
      kots: kots.length,
      revenue: Math.round(orders.filter((o) => o.status === "settled").reduce((s, o) => s + o.total, 0) * 100) / 100,
      outbox: await db.getDb().outbox.count(),
    };
  });
}

describe("load: Friday-night rush", () => {
  it("7 devices ring 1,050 bills with KOTs in waves; every device ends with the same, complete set", async () => {
    const devices = ["c1", "c2", "c3", "c4", "w1", "w2", "w3"];
    const perDevice = 150;
    const waves = 6;
    const started = performance.now();
    for (let wave = 0; wave < waves; wave += 1) {
      for (const d of devices) {
        for (let n = wave * (perDevice / waves); n < (wave + 1) * (perDevice / waves); n += 1) await on(d, () => ring(d, n));
      }
      for (const d of devices) await trySync(d);
    }
    for (const d of [...devices, "kitchen"]) await trySync(d);
    for (const d of devices) await trySync(d);
    const elapsed = performance.now() - started;

    const expected = devices.length * perDevice;
    const expectedRevenue = Math.round(devices.flatMap((d) => Array.from({ length: perDevice }, (_, n) => bill(d, n, n % 5 !== 0)))
      .filter((o) => o.status === "settled").reduce((s, o) => s + o.total, 0) * 100) / 100;
    for (const d of [...devices, "kitchen"]) {
      const s = await snapshot(d);
      expect({ device: d, ...s }).toEqual({ device: d, orders: expected, uniqueOrders: expected, kots: expected, revenue: expectedRevenue, outbox: 0 });
    }
    expect(server.fakeServer.rows.size).toBe(expected * 2);
    expect(elapsed).toBeLessThan(30_000);
  });

  it("survives a flaky connection: random outages during the rush lose nothing and double nothing", async () => {
    const rand = seeded(42);
    const devices = ["c1", "c2", "w1", "w2"];
    let outages = 0;
    for (let round = 0; round < 40; round += 1) {
      server.fakeServer.offline = rand() < 0.35;
      if (server.fakeServer.offline) outages += 1;
      const d = devices[Math.floor(rand() * devices.length)]!;
      for (let k = 0; k < 5; k += 1) await on(d, () => ring(d, round * 5 + k));
      await trySync(devices[Math.floor(rand() * devices.length)]!);
    }
    server.fakeServer.offline = false;
    for (const d of [...devices, ...devices]) await trySync(d);

    expect(outages).toBeGreaterThan(8); // the outages really happened
    const first = await snapshot(devices[0]!);
    expect(first.orders).toBe(200);
    for (const d of devices) expect(await snapshot(d)).toEqual(first);
  });

  it("brings a brand-new kitchen screen up to date with 4,000 records in a few pages", async () => {
    for (let n = 0; n < 2000; n += 1) await on("c1", () => ring("c1", n));
    await trySync("c1");
    const before = server.fakeServer.requests.select;
    const started = performance.now();
    expect(await trySync("kitchen")).toBe(true);
    const elapsed = performance.now() - started;
    const s = await snapshot("kitchen");
    expect(s.orders).toBe(2000);
    expect(s.kots).toBe(2000);
    expect(server.fakeServer.requests.select - before).toBeLessThan(20);
    expect(elapsed).toBeLessThan(20_000);
  });
});
