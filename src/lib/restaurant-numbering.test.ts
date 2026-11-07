import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transport = vi.fn();
  const client = {
    rest: { rpc: transport },
    rpc(this: { rest: { rpc: typeof transport } }, name: string, args: Record<string, string>) {
      return this.rest.rpc(name, args);
    },
  };
  const rows = new Map<string, { key: string; value: string }>();
  let tail = Promise.resolve();
  const meta = {
    get: vi.fn(async (key: string) => key === "restaurantId" ? { value: "restaurant-id" } : rows.get(key)),
    put: vi.fn(async (row: { key: string; value: string }) => { rows.set(row.key, row); }),
  };
  const transaction = vi.fn((_mode: string, _table: unknown, work: () => Promise<unknown>) => {
    const result = tail.then(work);
    tail = result.then(() => undefined, () => undefined);
    return result;
  });
  return { client, transport, meta, rows, transaction };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks.client }));
vi.mock("./db", () => ({ getDb: () => ({ meta: mocks.meta, transaction: mocks.transaction }) }));

import { allocateRestaurantNumber, allocatedNumberRequestId, prepareOfflineNumbers } from "./restaurant-numbering";

describe("restaurant number allocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rows.clear();
    vi.stubGlobal("navigator", { onLine: true });
  });

  it.each(["POS", "KOT"] as const)("keeps the client receiver when allocating %s and retrying the same request", async (series) => {
    mocks.transport.mockResolvedValue({ data: `${series}/0014`, error: null });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(allocateRestaurantNumber(series, "durable-request-id")).resolves.toBe(`${series}/0014`);
    }
    expect(mocks.transport).toHaveBeenCalledTimes(1);
    expect(mocks.transport).toHaveBeenLastCalledWith("allocate_restaurant_number", {
      _restaurant_id: "restaurant-id", _series: series, _request_id: "durable-request-id",
    });
  });

  it("preserves server allocation failures without fabricating a ticket", async () => {
    mocks.transport.mockResolvedValue({ data: null, error: { message: "Permission denied" } });
    await expect(allocateRestaurantNumber("KOT", "request-id")).rejects.toThrow("Couldn't allocate a KOT number: Permission denied");
  });

  it("rejects invalid server numbers", async () => {
    mocks.transport.mockResolvedValue({ data: "POS/0014", error: null });
    await expect(allocateRestaurantNumber("KOT", "request-id")).rejects.toThrow("invalid KOT number");
  });

  it.each(["POS", "KOT"] as const)("continues %s offline with the cloud reservation identity and stable retry", async (series) => {
    mocks.rows.set(`reservedNumbers:restaurant-id:${series}`, { key: `reservedNumbers:restaurant-id:${series}`, value: JSON.stringify({ available: [{ requestId: "cloud-reservation", number: `${series}/0019` }], assigned: {}, pending: [] }) });
    vi.stubGlobal("navigator", { onLine: false });
    await expect(allocateRestaurantNumber(series, "local-submission")).resolves.toBe(`${series}/0019`);
    await expect(allocateRestaurantNumber(series, "local-submission")).resolves.toBe(`${series}/0019`);
    await expect(allocatedNumberRequestId(series, "local-submission")).resolves.toBe("cloud-reservation");
    expect(mocks.transport).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
    await expect(allocateRestaurantNumber(series, "local-submission")).resolves.toBe(`${series}/0019`);
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it("does not duplicate reserved numbers for simultaneous local submissions", async () => {
    mocks.rows.set("reservedNumbers:restaurant-id:KOT", { key: "reservedNumbers:restaurant-id:KOT", value: JSON.stringify({ available: [{ requestId: "a", number: "KOT/0019" }, { requestId: "b", number: "KOT/0020" }], assigned: {}, pending: [] }) });
    vi.stubGlobal("navigator", { onLine: false });
    expect(await Promise.all([allocateRestaurantNumber("KOT", "one"), allocateRestaurantNumber("KOT", "two")])).toEqual(["KOT/0019", "KOT/0020"]);
  });

  it("refuses exhaustion without inventing or consuming another number", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(allocateRestaurantNumber("POS", "new")).rejects.toThrow("reserved offline numbers");
    expect(mocks.transport).not.toHaveBeenCalled();
  });

  it("reserves distinct official numbers while online and reuses uncertain reservation requests", async () => {
    let n = 18;
    mocks.transport.mockImplementation(async (_name, args) => ({ data: `${args._series}/${String(++n).padStart(4, "0")}`, error: null }));
    await prepareOfflineNumbers();
    expect(mocks.transport).toHaveBeenCalledTimes(40);
    await prepareOfflineNumbers();
    expect(mocks.transport).toHaveBeenCalledTimes(40);
    const cache = JSON.parse(mocks.rows.get("reservedNumbers:restaurant-id:KOT")?.value ?? "{}");
    expect(cache.available).toHaveLength(20);
    expect(new Set(cache.available.map((x: { requestId: string }) => x.requestId)).size).toBe(20);
  });

  it("retains a refill request after a network failure for the next reconnect", async () => {
    mocks.transport.mockRejectedValueOnce(new Error("Network unavailable"));
    await expect(prepareOfflineNumbers()).rejects.toThrow("Network unavailable");
    const first = mocks.transport.mock.calls[0]?.[1]._request_id;
    let n = 18;
    mocks.transport.mockImplementation(async (_name, args) => ({ data: `${args._series}/${String(++n).padStart(4, "0")}`, error: null }));
    await prepareOfflineNumbers();
    expect(mocks.transport.mock.calls[1]?.[1]._request_id).toBe(first);
  });
});