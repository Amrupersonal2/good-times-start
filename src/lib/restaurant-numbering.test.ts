import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transport = vi.fn();
  const client = {
    rest: { rpc: transport },
    rpc(this: { rest: { rpc: typeof transport } }, name: string, args: Record<string, string>) {
      return this.rest.rpc(name, args);
    },
  };
  return { client, transport, getMeta: vi.fn() };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks.client }));
vi.mock("./db", () => ({ getDb: () => ({ meta: { get: mocks.getMeta } }) }));

import { allocateRestaurantNumber } from "./restaurant-numbering";

describe("restaurant number allocation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMeta.mockResolvedValue({ value: "restaurant-id" });
  });

  it.each(["POS", "KOT"] as const)("keeps the client receiver when allocating %s and retrying the same request", async (series) => {
    mocks.transport.mockResolvedValue({ data: `${series}/0014`, error: null });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(allocateRestaurantNumber(series, "durable-request-id")).resolves.toBe(`${series}/0014`);
    }
    expect(mocks.transport).toHaveBeenCalledTimes(2);
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
});