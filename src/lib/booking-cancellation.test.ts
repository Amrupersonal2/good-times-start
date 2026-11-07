import { beforeEach, expect, it, vi } from "vitest";
import type { Reservation } from "./reservations";
const mocks = vi.hoisted(() => ({ entries: new Map<string, { key: string; value: string }>(), rpc: vi.fn(), read: vi.fn() }));
vi.mock("./db", () => ({ getDb: () => ({ transaction: async (_mode: string, _table: unknown, fn: () => Promise<void>) => fn(), meta: {
  get: async (key: string) => mocks.entries.get(key), put: async (entry: { key: string; value: string }) => mocks.entries.set(entry.key, entry), delete: async (key: string) => mocks.entries.delete(key),
  where: () => ({ startsWith: (prefix: string) => ({ toArray: async () => [...mocks.entries.values()].filter((e) => e.key.startsWith(prefix)) }) }),
} }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.read }) }) }) } }));
import { applyBookingCancellations, flushBookingCancellations, queueBillBookingCancellation } from "./booking-cancellation";
const rows = [{ id: "current", table_id: "r1", status: "confirmed" }, { id: "later", table_id: "r1", status: "confirmed" }] as Reservation[];
beforeEach(() => { mocks.entries.clear(); vi.clearAllMocks(); mocks.entries.set("reservations:r", { key: "reservations:r", value: JSON.stringify({ rows, at: 1 }) }); });
it("clears the cancelled booking locally offline while preserving later bookings", async () => {
  await queueBillBookingCancellation("r", { status: "void", tableId: "r1", reservationId: "current" } as import("./types").Order);
  expect((await applyBookingCancellations("r", rows)).map((r) => r.status)).toEqual(["cancelled", "confirmed"]);
  expect(await applyBookingCancellations("other", rows)).toEqual(rows);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("retains cleanup intent on server failure", async () => {
  await queueBillBookingCancellation("r", { status: "void", tableId: "r1", reservationId: "current" } as import("./types").Order);
  mocks.rpc.mockResolvedValue({ error: { message: "offline" } });
  await expect(flushBookingCancellations("r")).rejects.toThrow("waiting");
  expect(mocks.entries.has("bookingCancel:r:current")).toBe(true);
});
it("updates cache and removes intent only after guest status reads back cancelled", async () => {
  await queueBillBookingCancellation("r", { status: "void", tableId: "r1", reservationId: "current" } as import("./types").Order);
  mocks.rpc.mockResolvedValue({ error: null }); mocks.read.mockResolvedValue({ error: null, data: { status: "cancelled" } });
  await flushBookingCancellations("r");
  expect(mocks.rpc).toHaveBeenCalledWith("manage_guest_reservation", { _id: "current", _status: "cancelled" });
  expect(mocks.entries.has("bookingCancel:r:current")).toBe(false);
  expect(JSON.parse(mocks.entries.get("reservations:r")?.value ?? "{}").rows.map((r: Reservation) => r.status)).toEqual(["cancelled", "confirmed"]);
});