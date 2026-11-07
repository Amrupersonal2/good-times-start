import type { FloorTable } from "./table-logic";
import type { Reservation } from "./reservations";
import type { Kot, Order } from "./types";
import { kotSubmissions } from "./kot-history";
import type { Table } from "dexie";

/** Existing caches index orderId, not orderUid; include globally linked orphan tickets safely. */
export async function readBoardKots(kots: Table<Kot, number>, open: Order[]): Promise<Kot[]> {
  const ids = open.map((o) => o.id).filter((id): id is number => id !== undefined && id !== 0);
  const uids = new Set(open.map((o) => o.uid).filter(Boolean));
  if (!open.length) return [];
  const [linked, orphans] = await Promise.all([
    ids.length ? kots.where("orderId").anyOf(ids).toArray() : Promise.resolve([]),
    uids.size ? kots.where("orderId").equals(0).toArray() : Promise.resolve([]),
  ]);
  return [...linked, ...orphans.filter((k) => k.orderUid && uids.has(k.orderUid))];
}

export type BoardFilter = "all" | "booked" | "settled" | "occupied" | "free";
export type BoardTable = FloorTable & { booking?: Reservation; settledAt?: number };

/** Settlement is a display annotation, never a new occupancy state or financial write. */
export function boardTables(tables: BoardTable[], closed: Order[], start: number, end: number): BoardTable[] {
  return tables.map((table) => {
    const latest = closed.filter((o) => o.tableId === table.id && o.status === "settled")
      .map((o) => o.settledAt ?? o.createdAt).filter((at) => at >= start && at < end).sort((a, b) => b - a)[0];
    return table.status === "free" && !table.booking && !table.heldDevice && latest !== undefined ? { ...table, settledAt: latest } : table;
  });
}

export function matchesBoard(table: BoardTable, filter: BoardFilter): boolean {
  if (filter === "all") return true;
  if (filter === "booked") return table.status === "reserved" || !!table.booking;
  if (filter === "occupied") return table.status === "occupied" || table.status === "billed";
  if (filter === "settled") return table.settledAt !== undefined;
  return table.status === "free" && table.settledAt === undefined;
}

/** Submitted, unserved tickets on open bills; this does not claim food is being prepared. */
export function boardKots(kots: Kot[], open: Order[]) {
  const uids = new Set(open.filter((o) => o.status === "held").map((o) => o.uid).filter(Boolean));
  const ids = new Set(open.filter((o) => o.status === "held").map((o) => o.id).filter((id) => id !== undefined));
  return kotSubmissions(kots.filter((k) => k.status !== "served" && k.kind !== "cancel" &&
    (k.orderUid ? uids.has(k.orderUid) : ids.has(k.orderId))));
}