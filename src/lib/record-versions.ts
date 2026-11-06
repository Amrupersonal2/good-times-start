import { computeTotals } from "./billing";
import type { CartLine, Order } from "./types";
import type { RecordKind } from "./sync-core";

/**
 * Optimistic concurrency helpers for restaurant_records.
 *
 * The server owns each record's `version` (migration 0020); a device only
 * remembers the last version + payload it saw ("base") so the server can
 * refuse writes made on an older copy and the device can three-way merge.
 */

export interface RecordBase { version: number; payload?: unknown }

export const baseKey = (kind: RecordKind, recordId: string) => `recordBase:${kind}:${recordId}`;

/** Only bills keep their base payload: they are the only records merged line by line. */
export const keepsBasePayload = (kind: RecordKind) => kind === "order";

export function parseBase(value: unknown): RecordBase | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const parsed = JSON.parse(value) as RecordBase;
    return typeof parsed.version === "number" && Number.isFinite(parsed.version) ? parsed : null;
  } catch { return null; }
}

/** Canonical identity keeps portions/add-ons distinct while allowing qty deltas to merge. */
function lineIdentity(line: CartLine): string {
  const addons = [...(line.addons ?? [])].map((a) => [a.name, a.price] as const)
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
  return JSON.stringify([line.itemId, line.menuItemId ?? "", line.variant ?? "", addons]);
}

function lineAttributes(line: CartLine): string {
  const { qty: _qty, addons, ...rest } = line;
  const normalized = {
    ...rest,
    addons: addons ? [...addons].map((a) => ({ name: a.name, price: a.price }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.price - b.price) : undefined,
  };
  return JSON.stringify(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)));
}

const sameLine = (a: CartLine | undefined, b: CartLine | undefined) =>
  a === b || (!!a && !!b && a.qty === b.qty && lineIdentity(a) === lineIdentity(b) && lineAttributes(a) === lineAttributes(b));

function byItem(lines: CartLine[]): Map<string, CartLine> | null {
  const map = new Map<string, CartLine>();
  for (const line of lines) {
    const key = lineIdentity(line);
    if (map.has(key)) return null; // duplicate canonical rows: never guess
    map.set(key, line);
  }
  return map;
}

export interface LineMerge { lines: CartLine[]; conflicts: string[] }

/**
 * Three-way merge of bill lines keyed by dish.
 * - one side changed, the other didn't: take the change (edits and removals survive)
 * - both added the same dish independently: quantities add (two waiters, two naans)
 * - both changed quantity of an existing dish: apply both deltas to the base
 * - edit vs removal, or two different notes/prices: unresolved, staff decide
 */
export function mergeLines(base: CartLine[], local: CartLine[], remote: CartLine[]): LineMerge {
  const b = byItem(base); const l = byItem(local); const r = byItem(remote);
  if (!b || !l || !r) return { lines: remote.map((x) => ({ ...x })), conflicts: ["Bill has repeated dish rows"] };
  const order: string[] = [];
  for (const list of [remote, local]) for (const line of list) { const key = lineIdentity(line); if (!order.includes(key)) order.push(key); }
  for (const line of base) { const key = lineIdentity(line); if (!order.includes(key)) order.push(key); }

  const out: CartLine[] = [];
  const conflicts: string[] = [];
  for (const key of order) {
    const bl = b.get(key); const ll = l.get(key); const rl = r.get(key);
    let pick: CartLine | undefined;
    if (!bl && ll && rl) {
      // Added on both devices since the last common copy: both additions are real orders.
      if (ll.price !== rl.price) { conflicts.push(`${rl.name}: different prices`); pick = rl; }
      else {
        const note = joinNotes(rl.note, ll.note);
        pick = { ...rl, qty: rl.qty + ll.qty };
        if (note) pick.note = note;
      }
    } else if (sameLine(ll, rl)) pick = rl;
    else if (sameLine(ll, bl)) pick = rl;
    else if (sameLine(rl, bl)) pick = ll;
    else if (bl && ll && rl) {
      const qty = rl.qty + (ll.qty - bl.qty);
      const localAttributesChanged = lineAttributes(ll) !== lineAttributes(bl);
      const remoteAttributesChanged = lineAttributes(rl) !== lineAttributes(bl);
      if (localAttributesChanged && remoteAttributesChanged && lineAttributes(ll) !== lineAttributes(rl)) {
        conflicts.push(`${rl.name}: conflicting line details (price, tax, station, options or note)`);
        pick = { ...rl, qty: Math.max(0, rl.qty) };
      } else {
        // Preserve an independent metadata edit while adding the other device's quantity delta.
        const attributes = localAttributesChanged ? ll : rl;
        pick = qty > 0 ? { ...rl, ...attributes, qty } : undefined;
      }
    } else {
      // One side removed the dish, the other edited it.
      const edited = ll ?? rl;
      conflicts.push(`${edited?.name ?? key}: removed on one device, changed on another`);
      pick = rl;
    }
    if (pick && pick.qty > 0) out.push({ ...pick });
  }
  return { lines: out, conflicts };
}

function joinNotes(a?: string, b?: string): string | undefined {
  if (!a) return b; if (!b || a === b) return a;
  return `${a}; ${b}`;
}

export interface OrderMerge { order: Order | null; conflicts: string[] }

/** Merge a running bill edited on two devices. Settled/cancelled bills never auto-merge. */
export function mergeOrder(base: Order | undefined, local: Order, remote: Order): OrderMerge {
  if (local.status !== "held" || remote.status !== "held") {
    const samePayments = JSON.stringify(local.payments ?? []) === JSON.stringify(remote.payments ?? []);
    if (local.status === remote.status && samePayments && local.total === remote.total) return { order: local.id !== undefined ? { ...remote, id: local.id } : { ...remote }, conflicts: [] };
    return { order: null, conflicts: [remote.status !== "held" ? `Bill ${remote.billNo} was ${remote.status === "settled" ? "settled" : "cancelled"} on another device` : `Bill ${remote.billNo} changed on another device after it was settled here`] };
  }
  if (!base) return { order: null, conflicts: [`Bill ${remote.billNo} changed on another device`] };
  const merged = mergeLines(base.lines, local.lines, remote.lines);
  if (merged.conflicts.length) return { order: null, conflicts: merged.conflicts };

  // Scalar fields: local wins only where this device changed them.
  const result: Order = { ...remote };
  for (const key of Object.keys(local) as (keyof Order)[]) {
    if (key === "lines" || key === "id") continue;
    if (JSON.stringify(local[key]) !== JSON.stringify(base[key])) (result as unknown as Record<string, unknown>)[key] = local[key];
  }
  result.lines = merged.lines;
  if (local.kotSubmittedQty || remote.kotSubmittedQty) result.kotSubmittedQty = mergeCounts(base.kotSubmittedQty, local.kotSubmittedQty, remote.kotSubmittedQty);
  const t = computeTotals(result.lines, result.discountPct ?? 0, result.serviceChargePct ?? 0, result.tax ?? {});
  Object.assign(result, { subtotal: t.subtotal, discountAmt: t.discountAmt, serviceCharge: t.serviceCharge, cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total, taxable: t.taxable });
  if (local.id !== undefined) result.id = local.id;
  return { order: result, conflicts: [] };
}

function mergeCounts(base: Record<string, number> = {}, local: Record<string, number> = {}, remote: Record<string, number> = {}) {
  const out: Record<string, number> = {};
  for (const key of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    out[key] = Math.max(0, (remote[key] ?? 0) + (local[key] ?? 0) - (base[key] ?? 0));
  }
  return out;
}

/* ---------------- push units ---------------- */

export interface UnitRow { kind: RecordKind; record_id: string; payload: unknown; deleted: boolean; base_version: number | null }

/**
 * Group a push batch into all-or-nothing units: a settled bill travels with its
 * sale stock entry and its table, so payment, stock and table release commit together.
 */
export function buildUnits(rows: UnitRow[]): UnitRow[][] {
  const used = new Set<number>();
  const units: UnitRow[][] = [];
  const index = (kind: string, id: string) => rows.findIndex((r, i) => !used.has(i) && r.kind === kind && r.record_id === id);
  rows.forEach((row, i) => {
    if (used.has(i) || row.kind !== "order" || row.deleted) return;
    const payload = row.payload as Partial<Order> | null;
    if (payload?.status !== "settled") return;
    used.add(i);
    const unit = [row];
    const stock = index("stock_entry", `sale:${row.record_id}`);
    if (stock >= 0) { used.add(stock); unit.push(rows[stock]!); }
    if (payload.tableId) {
      const table = index("table", payload.tableId);
      if (table >= 0) { used.add(table); unit.push(rows[table]!); }
    }
    units.push(unit);
  });
  rows.forEach((row, i) => { if (!used.has(i)) units.push([row]); });
  return units;
}

export type PushResult =
  | { kind: string; record_id: string; status: "applied"; version: number }
  | { kind: string; record_id: string; status: "duplicate"; canonical_record_id: string }
  | { kind: string; record_id: string; status: "conflict"; version?: number; payload?: unknown; deleted?: boolean; race?: boolean }
  | { kind: string; record_id: string; status: "rolled_back" }
  | { kind: string; record_id: string; status: "error"; code?: string; message?: string };

export function isPushResults(value: unknown): value is PushResult[] {
  return Array.isArray(value) && value.every((r) => r && typeof r === "object" && typeof (r as PushResult).status === "string" && typeof (r as PushResult).record_id === "string");
}

/** The versioned push function isn't deployed yet (migration 0020 not applied). */
export function isMissingRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function|push_restaurant_records.*does not exist/i.test(error.message ?? "");
}

/* ---------------- staff-visible conflicts ---------------- */

export interface SyncConflict {
  key: string;
  kind: RecordKind;
  recordId: string;
  label: string;
  reasons: string[];
  /** This device's unsynced copy, kept until staff decide. */
  local: unknown;
  remote: { version: number; payload: unknown; deleted: boolean } | null;
  at: number;
  /** Outbox keys held back with this record (a settled bill's stock entry and table). */
  related?: string[];
}

export function parseConflicts(value: unknown): SyncConflict[] {
  if (typeof value !== "string" || !value) return [];
  try { const list = JSON.parse(value) as unknown; return Array.isArray(list) ? (list as SyncConflict[]) : []; } catch { return []; }
}
