import type { RestaurantTable } from "./types";

/**
 * Holding a table: the first person to add a dish to a table with no running
 * bill holds it, so a second waiter or the counter can't start another bill
 * there. Once the order reaches the kitchen the bill is shared and anyone can
 * add to it. A hold left idle this long lapses, so a forgotten tablet can't
 * block a table all evening.
 */
export const HOLD_MINUTES = 20;

export interface HeldBy { by: string; minutes: number }

/** Someone else's live hold on this table, or null if this device may take the order. */
export function holdByOther(table: RestaurantTable | undefined, myDevice: string, hasSharedBill: boolean, now: number): HeldBy | null {
  if (!table?.heldDevice || !myDevice || table.heldDevice === myDevice) return null;
  if (hasSharedBill || table.status !== "occupied") return null;
  const age = now - (table.heldAt ?? 0);
  if (age > HOLD_MINUTES * 60_000) return null;
  return { by: table.heldBy?.trim() || "another device", minutes: Math.max(0, Math.round(age / 60_000)) };
}

/** The table's record while this device is taking its first order. */
export function heldTable(table: RestaurantTable, myDevice: string, name: string, runningTotal: number, now: number): RestaurantTable {
  return { ...table, status: "occupied", runningTotal, since: table.since ?? now, heldBy: name, heldDevice: myDevice, heldAt: now };
}

/** The same table with no hold (the order reached the kitchen, or the table was freed). */
export function withoutHold(table: RestaurantTable): RestaurantTable {
  const { heldBy: _by, heldDevice: _device, heldAt: _at, ...rest } = table;
  return rest;
}

/** Shown on table tiles: "Taking order · Waiter". */
export function holdLabel(table: RestaurantTable, now: number): string {
  if (!table.heldDevice || table.status !== "occupied" || now - (table.heldAt ?? 0) > HOLD_MINUTES * 60_000) return "";
  return `Taking order · ${table.heldBy?.trim() || "staff"}`;
}
