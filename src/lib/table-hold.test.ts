import { describe, expect, it } from "vitest";
import { HOLD_MINUTES, heldTable, holdByOther, holdLabel, withoutHold } from "./table-hold";
import type { RestaurantTable } from "./types";

const free: RestaurantTable = { id: "R3", label: "R3", section: "Rooftop", seats: 6, status: "free", runningTotal: 0 };
const now = 1_800_000_000_000;

describe("table holds", () => {
  it("lets the first device hold a table and blocks everyone else", () => {
    const held = heldTable(free, "tablet-a", "Waiter", 200, now);
    expect(held).toMatchObject({ status: "occupied", runningTotal: 200, heldBy: "Waiter", heldDevice: "tablet-a", heldAt: now, since: now });
    expect(holdByOther(held, "tablet-a", false, now)).toBeNull();
    expect(holdByOther(held, "counter", false, now + 3 * 60_000)).toEqual({ by: "Waiter", minutes: 3 });
  });

  it("opens the table to everyone once the order is with the kitchen", () => {
    const held = heldTable(free, "tablet-a", "Waiter", 200, now);
    expect(holdByOther(held, "counter", true, now)).toBeNull();
  });

  it("lets a forgotten hold lapse", () => {
    const held = heldTable(free, "tablet-a", "Waiter", 200, now);
    expect(holdByOther(held, "counter", false, now + (HOLD_MINUTES + 1) * 60_000)).toBeNull();
    expect(holdLabel(held, now + (HOLD_MINUTES + 1) * 60_000)).toBe("");
  });

  it("ignores holds on free tables and clears cleanly", () => {
    const held = heldTable(free, "tablet-a", "", 200, now);
    expect(holdLabel(held, now)).toBe("Taking order · staff");
    expect(holdByOther({ ...held, status: "free" }, "counter", false, now)).toBeNull();
    expect(withoutHold(held)).not.toHaveProperty("heldDevice");
    expect(holdByOther(held, "", false, now)).toBeNull();
  });
});
