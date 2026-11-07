import { describe, expect, it } from "vitest";
import { liveKitchenTickets } from "./kitchen-view";
import type { Kot, Order } from "./types";

const ticket = (station: string, kind: Kot["kind"] = "order"): Kot => ({ orderId: 1, orderUid: "room", billNo: "POS/0001", submissionId: "send", station, kind, status: "new", createdAt: 1, lines: [{ name: "Naan", qty: 2 }] });
describe("live kitchen tickets", () => {
  it("retains previous-day open room tickets and every station and cancellation", () => {
    const orders = [{ uid: "room", id: 1, status: "held" }] as Order[];
    const groups = liveKitchenTickets([ticket("Tandoor"), ticket("Beverages"), ticket("Tandoor", "cancel")], orders, 100, 200);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.tickets).toHaveLength(3);
    expect(groups[0]?.tickets[2]?.kind).toBe("cancel");
    expect(liveKitchenTickets([ticket("Tandoor"), ticket("Beverages")], orders, 100, 200, "Tandoor")[0]?.tickets).toHaveLength(1);
  });
  it("removes settled room tickets from live service but retains today's unlinked KOT", () => {
    const orders = [{ uid: "room", id: 1, status: "settled" }] as Order[];
    expect(liveKitchenTickets([ticket("Tandoor")], orders, 100, 200)).toHaveLength(0);
    expect(liveKitchenTickets([{ ...ticket("Tandoor"), orderUid: "incoming", orderId: 0, createdAt: 150 }], orders, 100, 200)).toHaveLength(1);
  });
});