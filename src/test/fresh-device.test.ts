import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * A brand-new device opens with an empty local menu until its first sync.
 * It must never treat that as "this restaurant has no menu": on 23 Oct the
 * sample menu was added from such a device and mixed into the live menu.
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

describe("a fresh device and the sample menu", () => {
  it("refuses the sample menu before the device has loaded the restaurant", async () => {
    await expect(on("new-counter", () => db.loadSampleData())).rejects.toThrow(/still loading/);
    expect(await on("new-counter", () => db.getDb().menu.count())).toBe(0);
  });

  it("never adds the sample on top of a real menu once loaded", async () => {
    await on("owner", async () => {
      await db.getDb().menu.put({ id: "tab-black-tea", name: "Black Tea", category: "Assam Tea & Coffee", price: 40, veg: true, gstRate: 5, station: "Beverages", available: true });
      await db.markDirty(["menu", "tab-black-tea"]);
      await sync.syncCloudData(R);
    });
    await on("new-counter", () => sync.syncCloudData(R));
    await on("new-counter", () => db.loadSampleData());
    const names = (await on("new-counter", () => db.getDb().menu.toArray())).map((m) => m.name);
    expect(names).toEqual(["Black Tea"]);
  });

  it("still lets a genuinely empty restaurant start from the sample, once loaded", async () => {
    await on("first-device", () => sync.syncCloudData(R));
    await on("first-device", () => db.loadSampleData());
    expect(await on("first-device", () => db.getDb().menu.count())).toBeGreaterThan(5);
  });
});
