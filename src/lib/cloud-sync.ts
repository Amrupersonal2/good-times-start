import { supabase } from "@/integrations/supabase/client";
import { allocateRestaurantNumber, allocatedNumberRequestId } from "@/lib/restaurant-numbering";
import { SyncScheduler } from "./sync-scheduler";
import type { Json } from "@/integrations/supabase/types";
import { applyEntryToLevels, getDb, getSettings, markDirty, onLocalChange, type OutboxEntry } from "@/lib/db";
import { deductInventory } from "@/lib/inventory";
import { withCustomerId } from "@/lib/customer-logic";
import { recordSaleConsumption } from "@/lib/stock-actions";
import {
  RECORD_KINDS,
  isCustomerPayload,
  isDayClosePayload,
  isMaterialPayload,
  isStockEntryPayload,
  isSupplierPayload,
  isInventoryPayload,
  isKotPayload,
  isMenuPayload,
  isOrderPayload,
  isSettingsPayload,
  isTablePayload,
  outboxKey,
  pullStartFrom,
  toSharedPayload,
  type RecordKind,
} from "@/lib/sync-core";
import type { InventoryItem, Kot, Order } from "@/lib/types";
import {
  baseKey,
  buildUnits,
  isMissingRpc,
  isPushResults,
  keepsBasePayload,
  mergeOrder,
  parseBase,
  parseConflicts,
  type PushResult,
  type SyncConflict,
  type UnitRow,
} from "@/lib/record-versions";

/**
 * Live sync for a restaurant's devices.
 *
 * IndexedDB stays the source of truth for the screen, so billing and the kitchen
 * board keep working offline. Local edits go into the outbox (see markDirty);
 * a sync pushes them to restaurant_records, then pulls everything newer than
 * the last cursor. A realtime ping from Postgres triggers a pull, so a KOT sent
 * from the counter shows on the kitchen screen within seconds.
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 500;

interface RemoteRow {
  kind: string;
  record_id: string;
  payload: Json;
  deleted: boolean;
  updated_at: string;
  /** Server-owned version (migration 0020); absent on servers without it. */
  version?: number;
}

/**
 * null = not probed yet, true = push_restaurant_records is deployed, false =
 * legacy server: keep the old upsert path so this build can ship before the migration.
 */
let versionedServer: boolean | null = null;
/** Test hook. */
export function resetVersionedServerProbe() { versionedServer = null; }

const CONFLICTS_KEY = "syncConflicts";
const MAX_MERGES_PER_SYNC = 3;

async function readConflicts(): Promise<SyncConflict[]> {
  return parseConflicts((await getDb().meta.get(CONFLICTS_KEY))?.value);
}

async function writeConflicts(list: SyncConflict[]) {
  if (list.length) await getDb().meta.put({ key: CONFLICTS_KEY, value: JSON.stringify(list) });
  else await getDb().meta.delete(CONFLICTS_KEY);
}

async function readBaseVersion(kind: RecordKind, recordId: string) {
  return parseBase((await getDb().meta.get(baseKey(kind, recordId)))?.value);
}

async function writeBase(kind: RecordKind, recordId: string, version: number, payload: unknown) {
  await getDb().meta.put({ key: baseKey(kind, recordId), value: JSON.stringify(keepsBasePayload(kind) ? { version, payload } : { version }) });
}

const isKind = (kind: string): kind is RecordKind => (RECORD_KINDS as readonly string[]).includes(kind);

async function readLocal(kind: RecordKind, recordId: string): Promise<unknown> {
  const db = getDb();
  switch (kind) {
    case "settings": {
      const settings = await getSettings();
      return settings.name ? settings : undefined;
    }
    case "menu": return db.menu.get(recordId);
    case "table": return db.restTables.get(recordId);
    case "inventory": return db.inventory.get(recordId);
    case "order": return db.orders.where("uid").equals(recordId).first();
    case "kot": return db.kots.where("uid").equals(recordId).first();
    case "material": return db.materials.get(recordId);
    case "supplier": return db.suppliers.get(recordId);
    case "stock_entry": return db.stockEntries.get(recordId);
    case "customer": return db.customers.get(recordId);
    case "day_close": return db.dayCloses.get(recordId);
  }
}

type PushRow = { restaurant_id: string; kind: string; record_id: string; payload: Json; deleted: boolean };

async function upsert(rows: PushRow[]) {
  if (!rows.length) return null;
  const { error } = await supabase.from("restaurant_records").upsert(rows, { onConflict: "restaurant_id,kind,record_id" });
  return error;
}

/** The cloud said no (a role rule), as opposed to "couldn't reach the cloud". */
export function isRefusal(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42501" || /row-level security|only the owner or a manager|made before launch/i.test(error.message ?? "");
}

/**
 * Upload a batch. If the cloud refuses some rows (a cashier's device holding a
 * menu change, a changed settled bill), find them one by one so every allowed
 * change still goes through. Returns the refused rows; throws on network errors.
 */
type RefusedRow = PushRow & { prelaunch?: boolean };

const UNNUMBERED = /Update the POS app before creating numbered records/i;

/**
 * An older counter version numbered some kitchen tickets itself; the cloud refuses
 * those. Instead of dropping the printed ticket, give its whole submission a cloud
 * number (keeping the printed one for reference) and re-queue it so it reaches history.
 */
async function renumberStuckKot(row: PushRow, message: string | undefined): Promise<boolean> {
  if (row.kind !== "kot" || !UNNUMBERED.test(message ?? "")) return false;
  try {
    const db = getDb();
    const local = await db.kots.where("uid").equals(row.record_id).first();
    if (!local || local.id === undefined) return false;
    const submissionId = local.submissionId && /^[0-9a-f-]{36}$/i.test(local.submissionId) ? local.submissionId : crypto.randomUUID();
    const kotNo = await allocateRestaurantNumber("KOT", submissionId);
    const numberRequestId = await allocatedNumberRequestId("KOT", submissionId);
    const siblings = local.submissionId
      ? await db.kots.filter((k) => k.submissionId === local.submissionId).toArray()
      : [local];
    for (const k of siblings) {
      if (k.id === undefined) continue;
      await db.kots.put({ ...k, submissionId, numberRequestId, kotNo, ...(k.kotNo && k.kotNo !== kotNo ? { printedKotNo: k.printedKotNo ?? k.kotNo } : {}) });
    }
    await markDirty(...siblings.map((k): [RecordKind, string] => ["kot", k.uid ?? ""]));
    return true;
  } catch {
    return false;
  }
}

async function upsertAllowed(rows: PushRow[]): Promise<RefusedRow[]> {
  const error = await upsert(rows);
  if (!error) return [];
  if (!isRefusal(error)) throw error;
  const refused: RefusedRow[] = [];
  for (const row of rows) {
    const one = await upsert([row]);
    if (!one) continue;
    if (!isRefusal(one)) throw one;
    if (await renumberStuckKot(row, one.message)) continue;
    // The launch cut-off refuses bills and tickets made before the restaurant launched.
    refused.push(/made before launch/i.test(one.message ?? "") ? { ...row, prelaunch: true } : row);
  }
  return refused;
}

/** Put this device back in line with the cloud for records the cloud refused. */
async function restoreRefused(restaurantId: string, refused: RefusedRow[]): Promise<void> {
  const byKind = new Map<string, string[]>();
  for (const r of refused) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.record_id]);
  const rows: RemoteRow[] = [];
  for (const [kind, ids] of byKind) {
    const { data, error } = await supabase.from("restaurant_records").select("kind, record_id, payload, deleted, updated_at")
      .eq("restaurant_id", restaurantId).eq("kind", kind).in("record_id", ids);
    if (error) throw error;
    const found = (data ?? []) as RemoteRow[];
    rows.push(...found);
    // Refused new records exist only here: remove them.
    for (const id of ids) if (!found.some((f) => f.record_id === id)) rows.push({ kind, record_id: id, payload: {} as Json, deleted: true, updated_at: new Date(0).toISOString() });
  }
  await applyRemote(rows);
  const db = getDb();
  const prelaunch = refused.filter((r) => r.prelaunch).length;
  await db.meta.put({ key: "syncNotice", value: JSON.stringify({ at: Date.now(), count: refused.length - prelaunch, kinds: [...new Set(refused.filter((r) => !r.prelaunch).map((r) => r.kind))], prelaunch }) });
}

async function push(restaurantId: string): Promise<void> {
  const db = getDb();
  for (;;) {
    const entries: OutboxEntry[] = await db.outbox.orderBy("at").limit(PUSH_BATCH).toArray();
    if (!entries.length) return;

    const rows: PushRow[] = [];
    for (const entry of entries) {
      const local = await readLocal(entry.kind, entry.recordId);
      if (entry.kind === "settings" && local === undefined) continue;
      rows.push({
        restaurant_id: restaurantId,
        kind: entry.kind,
        record_id: entry.recordId,
        payload: (local === undefined ? {} : toSharedPayload(entry.kind, local)) as Json,
        deleted: local === undefined,
      });
    }

    if (versionedServer !== false) {
      const outcome = await pushVersioned(restaurantId, entries, rows);
      if (outcome === "done") continue;
      if (outcome === "stalled") return;
    }

    // A refused change is dropped and the cloud's copy restored, never retried forever:
    // one change this device isn't allowed to make must not hold up every other change.
    const refused = await upsertAllowed(rows);

    await db.transaction("rw", db.outbox, async () => {
      for (const entry of entries) {
        const current = await db.outbox.get(entry.key);
        if (current && current.at === entry.at) await db.outbox.delete(entry.key);
      }
    });
    if (refused.length) await restoreRefused(restaurantId, refused);
    if (entries.length < PUSH_BATCH) return;
  }
}

const mergeAttempts = new Map<string, number>();

/**
 * Versioned push (migration 0020). Returns "legacy" when the server doesn't have
 * the function yet, "stalled" when nothing could leave the outbox this round
 * (e.g. a unit waiting on a conflict), otherwise "done".
 */
async function pushVersioned(restaurantId: string, entries: OutboxEntry[], rows: PushRow[]): Promise<"legacy" | "stalled" | "done"> {
  const db = getDb();
  const unitRows: UnitRow[] = [];
  for (const row of rows) {
    const base = await readBaseVersion(row.kind as RecordKind, row.record_id);
    unitRows.push({ kind: row.kind as RecordKind, record_id: row.record_id, payload: row.payload, deleted: row.deleted, base_version: base?.version ?? null });
  }
  const grouped = buildUnits(unitRows);
  const units = grouped.map((unit) => ({ rows: unit }));
  const siblingsOf = new Map<string, string[]>();
  for (const unit of grouped) {
    const keys = unit.map((r) => outboxKey(r.kind, r.record_id));
    for (const k of keys) siblingsOf.set(k, keys.filter((x) => x !== k));
  }
  const rowByKey = new Map(rows.map((r) => [outboxKey(r.kind as RecordKind, r.record_id), r]));
  const { data, error } = await supabase.rpc("push_restaurant_records" as never, { _restaurant_id: restaurantId, _units: units } as never);
  if (error && isMissingRpc(error)) { versionedServer = false; return "legacy"; }
  if (error) throw error;
  if (!isPushResults(data)) { versionedServer = false; return "legacy"; }
  versionedServer = true;

  const results = data as PushResult[];
  const done = new Set<string>();
  const refused: RefusedRow[] = [];
  const conflicts = await readConflicts();
  let progressed = false;

  for (const result of results) {
    if (!isKind(result.kind)) continue;
    const key = outboxKey(result.kind, result.record_id);
    const sent = rows.find((r) => r.kind === result.kind && r.record_id === result.record_id);
    switch (result.status) {
      case "applied":
        await writeBase(result.kind, result.record_id, result.version, sent?.payload);
        done.add(key);
        mergeAttempts.delete(key);
        break;
      case "duplicate": {
        // The kitchen already has this ticket from an earlier attempt: drop the local copy.
        const local = await db.kots.where("uid").equals(result.record_id).first();
        if (local?.id !== undefined) await db.kots.delete(local.id);
        done.add(key);
        break;
      }
      case "rolled_back":
        break; // stays queued; retried with its unit
      case "error":
        if (!isRefusal(result)) throw Object.assign(new Error(result.message ?? "Sync failed"), { code: result.code });
        if (sent && await renumberStuckKot(sent, result.message)) { done.add(key); break; }
        if (sent) refused.push(/made before launch/i.test(result.message ?? "") ? { ...sent, prelaunch: true } : sent);
        done.add(key);
        // A settlement unit is all-or-nothing: its stock entry and table go back to the cloud copy too.
        for (const sib of siblingsOf.get(key) ?? []) { const r = rowByKey.get(sib); if (r) { refused.push(r); done.add(sib); } }
        break;
      case "conflict": {
        if (result.race || typeof result.version !== "number") break; // insert race: just retry
        const remote = { version: result.version, payload: result.payload ?? {}, deleted: !!result.deleted };
        const attempts = (mergeAttempts.get(key) ?? 0) + 1;
        mergeAttempts.set(key, attempts);
        const resolved = attempts <= MAX_MERGES_PER_SYNC && await tryAutoMerge(result.kind, result.record_id, remote);
        if (resolved) { progressed = true; break; } // re-queued against the new base
        const local = await readLocal(result.kind, result.record_id);
        const reasons = result.kind === "order" && isOrderPayload(local) && isOrderPayload(remote.payload)
          ? mergeOrder(parseBaseOrder(await readBaseVersion(result.kind, result.record_id)), local, remote.payload).conflicts
          : [`${result.kind} changed on another device`];
        const label = result.kind === "order" && isOrderPayload(local) ? `Bill ${local.billNo}` : `${result.kind} ${result.record_id}`;
        const next = conflicts.filter((c) => c.key !== key);
        const related = siblingsOf.get(key) ?? [];
        next.push({ key, kind: result.kind, recordId: result.record_id, label, reasons: reasons.length ? reasons : ["Changed on another device"], local: local ?? null, remote, at: Date.now(), ...(related.length ? { related } : {}) });
        for (const sib of related) done.add(sib); // held back with the bill so stock/table never commit without it
        conflicts.splice(0, conflicts.length, ...next);
        done.add(key); // leaves the outbox; local copy is kept and shown in the conflict alert
        break;
      }
    }
  }
  await writeConflicts(conflicts);

  await db.transaction("rw", db.outbox, async () => {
    for (const entry of entries) {
      if (!done.has(entry.key)) continue;
      const current = await db.outbox.get(entry.key);
      if (current && current.at === entry.at) await db.outbox.delete(entry.key);
    }
  });
  if (refused.length) await restoreRefused(restaurantId, refused);
  return done.size || progressed ? "done" : "stalled";
}

function parseBaseOrder(base: { payload?: unknown } | null): Order | undefined {
  return base && isOrderPayload(base.payload) ? base.payload : undefined;
}

/** Merge a running bill edited on two devices; on success the merged copy is queued again. */
async function tryAutoMerge(kind: RecordKind, recordId: string, remote: { version: number; payload: unknown; deleted: boolean }): Promise<boolean> {
  const db = getDb();
  if (kind !== "order") {
    // Tables, menu, stock and other records keep their established last-writer-wins rule,
    // now applied explicitly on top of the newest server version instead of blindly.
    await writeBase(kind, recordId, remote.version, undefined);
    await markDirty([kind, recordId]);
    return true;
  }
  if (remote.deleted || !isOrderPayload(remote.payload)) return false;
  const local = await db.orders.where("uid").equals(recordId).first();
  if (!local) return false;
  const base = parseBaseOrder(await readBaseVersion(kind, recordId));
  const { order } = mergeOrder(base, local, { ...remote.payload, uid: recordId });
  if (!order) return false;
  await db.orders.put({ ...order, ...(local.id !== undefined ? { id: local.id } : {}), uid: recordId, synced: false });
  await writeBase(kind, recordId, remote.version, remote.payload);
  await markDirty(["order", recordId]);
  return true;
}

/**
 * Staff decision on a conflict. "mine" re-sends this device's copy on top of the
 * latest cloud version; "cloud" discards the local copy and shows the cloud's.
 */
export async function resolveSyncConflict(key: string, choice: "mine" | "cloud"): Promise<void> {
  const conflicts = await readConflicts();
  const conflict = conflicts.find((c) => c.key === key);
  if (!conflict) return;
  await writeConflicts(conflicts.filter((c) => c.key !== key));
  const related = (conflict.related ?? []).map((k) => { const at = k.indexOf(":"); return [k.slice(0, at), k.slice(at + 1)] as [RecordKind, string]; });
  if (choice === "mine") {
    if (conflict.remote) await writeBase(conflict.kind, conflict.recordId, conflict.remote.version, conflict.remote.payload);
    await markDirty([conflict.kind, conflict.recordId], ...related);
    return;
  }
  if (conflict.remote) {
    await applyRemote([{ kind: conflict.kind, record_id: conflict.recordId, payload: conflict.remote.payload as Json, deleted: conflict.remote.deleted, updated_at: new Date().toISOString(), version: conflict.remote.version }]);
  }
  // Held-back stock entry / table: replace with the cloud's copies (local-only ones are removed).
  const restaurantId = (await getDb().meta.get("restaurantId"))?.value;
  if (related.length && typeof restaurantId === "string" && restaurantId) {
    await restoreRefused(restaurantId, related.map(([kind, record_id]) => ({ restaurant_id: restaurantId, kind, record_id, payload: {} as Json, deleted: false })));
  }
}

export async function listSyncConflicts(): Promise<SyncConflict[]> { return readConflicts(); }

async function applyRemote(rows: RemoteRow[]): Promise<void> {
  const db = getDb();
  // The outbox is read inside the same transaction, so a local edit can't slip in between the check and the write.
  await db.transaction("rw", [db.outbox, db.menu, db.restTables, db.inventory, db.orders, db.kots, db.meta, db.materials, db.suppliers, db.stockEntries, db.customers, db.dayCloses, db.materialLevels], async () => {
    const pending = new Set((await db.outbox.toCollection().primaryKeys()).map(String));
    const conflicted = new Set(parseConflicts((await db.meta.get(CONFLICTS_KEY))?.value).map((c) => c.key));
    for (const row of rows) {
      if (!isKind(row.kind)) continue;
      const key = outboxKey(row.kind, row.record_id);
      // Local edits that haven't been pushed yet win; they'll be pushed against their recorded base version.
      // Records awaiting a staff conflict decision keep this device's copy on screen.
      if (pending.has(key) || conflicted.has(key)) continue;
      if (typeof row.version === "number") {
        await db.meta.put({ key: baseKey(row.kind, row.record_id), value: JSON.stringify(keepsBasePayload(row.kind) ? { version: row.version, payload: row.payload } : { version: row.version }) });
      }
      const payload: unknown = row.payload;
      const id = row.record_id;

      switch (row.kind) {
        case "settings":
          if (!row.deleted && isSettingsPayload(payload)) await db.meta.put({ key: "restaurantSettings", value: JSON.stringify(payload) });
          break;
        case "menu":
          if (row.deleted) await db.menu.delete(id);
          else if (isMenuPayload(payload)) await db.menu.put({ ...payload, id });
          break;
        case "table":
          if (row.deleted) await db.restTables.delete(id);
          else if (isTablePayload(payload)) await db.restTables.put({ ...payload, id });
          break;
        case "inventory":
          if (row.deleted) await db.inventory.delete(id);
          else if (isInventoryPayload(payload)) {
            const item: InventoryItem = { ...payload, id, synced: true };
            await db.inventory.put(item);
          }
          break;
        case "order": {
          const existing = await db.orders.where("uid").equals(id).first();
          if (row.deleted) {
            if (existing?.id !== undefined) await db.orders.delete(existing.id);
            break;
          }
          if (!isOrderPayload(payload)) break;
          const { id: _ignored, ...rest } = payload;
          // Bills from older app versions may lack the guest index; add it so guest lookups stay indexed.
          const order: Order = withCustomerId(existing?.id !== undefined
            ? { ...rest, id: existing.id, uid: id, synced: true }
            : { ...rest, uid: id, synced: true });
          const orderId = Number(await db.orders.put(order));
          // Tickets can arrive before their bill (they are older); link them now, otherwise
          // the counter would treat already-sent items as "not sent" and offer to send them again.
          await db.kots.where("orderId").equals(0).filter((k) => k.orderUid === id)
            .modify((k) => { k.orderId = orderId; });
          break;
        }
        case "kot": {
          const existing = await db.kots.where("uid").equals(id).first();
          if (row.deleted) {
            if (existing?.id !== undefined) await db.kots.delete(existing.id);
            break;
          }
          if (!isKotPayload(payload)) break;
          const parent = payload.orderUid ? await db.orders.where("uid").equals(payload.orderUid).first() : undefined;
          const { id: _ignored, ...rest } = payload;
          const kot: Kot = existing?.id !== undefined
            ? { ...rest, id: existing.id, uid: id, orderId: parent?.id ?? existing.orderId }
            : { ...rest, uid: id, orderId: parent?.id ?? 0 };
          await db.kots.put(kot);
          break;
        }
        case "material":
          if (row.deleted) await db.materials.delete(id);
          else if (isMaterialPayload(payload)) await db.materials.put({ ...payload, id });
          break;
        case "supplier":
          if (row.deleted) await db.suppliers.delete(id);
          else if (isSupplierPayload(payload)) await db.suppliers.put({ ...payload, id });
          break;
        case "stock_entry":
          // Ledger entries also move the cached stock levels; re-applying the same entry is a no-op.
          if (row.deleted) {
            await applyEntryToLevels(db, id, null);
            await db.stockEntries.delete(id);
          } else if (isStockEntryPayload(payload)) {
            const entry = { ...payload, id };
            await applyEntryToLevels(db, id, entry);
            await db.stockEntries.put(entry);
          }
          break;
        case "customer":
          if (row.deleted) await db.customers.delete(id);
          else if (isCustomerPayload(payload)) await db.customers.put({ ...payload, id });
          break;
        case "day_close":
          if (row.deleted) await db.dayCloses.delete(id);
          else if (isDayClosePayload(payload)) await db.dayCloses.put({ ...payload, id });
          break;
      }
    }
  });
}

async function pull(restaurantId: string): Promise<void> {
  const db = getDb();
  const stored = (await db.meta.get("pullCursor"))?.value;
  const cursor = typeof stored === "string" && stored ? stored : null;
  let newest = cursor;
  let from = pullStartFrom(cursor);
  let firstPage = true;

  for (;;) {
    let query = supabase
      .from("restaurant_records")
      .select(versionedServer === false ? "kind,record_id,payload,deleted,updated_at" : "kind,record_id,payload,deleted,updated_at,version")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: true })
      .limit(PULL_PAGE);
    if (from) query = firstPage ? query.gte("updated_at", from) : query.gt("updated_at", from);
    const { data, error } = await query;
    if (error && error.code === "42703" && versionedServer !== false) { versionedServer = false; continue; } // column not deployed yet
    if (error) throw error;
    const rows = (data ?? []) as unknown as RemoteRow[];
    if (rows.length) {
      await applyRemote(rows);
      const last = rows[rows.length - 1]!.updated_at;
      if (!newest || last > newest) newest = last;
      from = last;
    }
    firstPage = false;
    if (rows.length < PULL_PAGE) break;
  }
  if (newest) await db.meta.put({ key: "pullCursor", value: newest });
}

async function syncOnce(restaurantId: string): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("No internet connection. Orders remain safely stored on this device.");
  }
  const db = getDb();
  const bound = (await db.meta.get("restaurantId"))?.value;
  if (typeof bound === "string" && bound && bound !== restaurantId) {
    throw new Error("This device holds another restaurant's data. An owner can reset this device in Settings to switch restaurants.");
  }
  if (!bound) await db.meta.put({ key: "restaurantId", value: restaurantId });

  // Fetch owner-issued numbering before pushing so old offline copies cannot
  // put the retained invoice back under its previous number.
  const numbering = await supabase.from("counter_numbering").select("*").eq("restaurant_id", restaurantId);
  if (numbering.error) throw numbering.error;
  for (const rule of numbering.data ?? []) {
    await db.transaction("rw", db.meta, db.orders, db.kots, async () => {
      const key = `billSeries:${rule.source_series}:${rule.financial_year}`;
      const already = (await db.meta.get(key))?.value;
      const source = (await db.meta.get("deviceCode"))?.value;
      await db.meta.put({ key, value: rule.series });
      if (source === rule.source_series || source === rule.series) {
        await db.meta.put({ key: `billSeries:${rule.series}:${rule.financial_year}`, value: rule.series });
        const seq = (await db.meta.get("billSeq"))?.value;
        await db.meta.put({ key: "billSeq", value: already ? Math.max(typeof seq === "number" ? seq : 0, rule.last_sequence) : rule.last_sequence });
      }
      if (rule.retained_uid) {
        const billNo = `${rule.series}/${rule.financial_year}/0001`;
        await db.orders.where("uid").equals(rule.retained_uid).modify({ billNo });
        await db.kots.toCollection().filter((kot) => kot.orderUid === rule.retained_uid).modify({ billNo });
      }
    });
  }

  await push(restaurantId);
  await pull(restaurantId);
  await db.meta.put({ key: "lastSyncAt", value: Date.now() });
  await db.meta.put({ key: "syncError", value: "" });
}

let inFlight: Promise<void> | null = null;
let queued = false;

/**
 * One sync at a time per device. Tabs share this device's database, so a Web
 * Lock keeps two open tabs from pushing and pulling over each other.
 */
function withDeviceLock<T>(restaurantId: string, work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: { request: (name: string, cb: () => Promise<T>) => Promise<T> } }).locks : undefined;
  return locks ? locks.request(`xtsy-sync-${restaurantId}`, work) : work();
}

/** Push local changes and pull the latest restaurant data. Concurrent calls share one run. */
export function syncCloudData(restaurantId: string): Promise<void> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }
  inFlight = (async () => {
    try {
      do {
        queued = false;
        await withDeviceLock(restaurantId, () => syncOnce(restaurantId));
      } while (queued);
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/* ---------- live connection status, for the sync chip ---------- */

export type LiveStatus = "connecting" | "live" | "reconnecting" | "off";
let liveStatus: LiveStatus = "off";
const liveListeners = new Set<() => void>();
function setLiveStatus(next: LiveStatus) {
  if (next === liveStatus) return;
  liveStatus = next;
  for (const l of liveListeners) l();
}
export function getLiveStatus(): LiveStatus { return liveStatus; }
export function onLiveStatus(listener: () => void): () => void {
  liveListeners.add(listener);
  return () => { liveListeners.delete(listener); };
}

/**
 * Keeps this device in step with the restaurant. Syncs on start; within two
 * seconds of local edits (however busy the counter is); within a quarter
 * second of a change on another device; when the connection returns or the
 * app comes back to the screen; after failures with growing retry gaps; and
 * by polling (every 15 s while the live connection is down, 60 s while up).
 * The live connection reconnects itself. Returns a stop function.
 */
export function startLiveSync(restaurantId: string): () => void {
  let stopped = false;
  const scheduler = new SyncScheduler(
    async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("offline");
      try {
        await syncCloudData(restaurantId);
      } catch (error) {
        await saveSyncError(error);
        throw error;
      }
    },
    { now: () => Date.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (h) => window.clearTimeout(h as number) },
  );

  // Kitchen tickets push at once so the kitchen screen updates instantly; offline they stay in the outbox until "online" fires.
  const stopLocal = onLocalChange((kinds) => scheduler.request(kinds.includes("kot") ? 0 : 800));
  const wake = () => scheduler.request(0);
  const onVisible = () => { if (document.visibilityState === "visible") wake(); };
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("pageshow", wake);
  document.addEventListener("visibilitychange", onVisible);

  // Realtime: a change on another device triggers a pull. If the socket drops, resubscribe with growing gaps.
  let channel: ReturnType<typeof supabase.channel> | null = null;
  let reconnectTimer: number | undefined;
  let attempts = 0;
  const connect = () => {
    if (stopped) return;
    setLiveStatus(attempts ? "reconnecting" : "connecting");
    const current = supabase
      .channel(`restaurant-records-${restaurantId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_records", filter: `restaurant_id=eq.${restaurantId}` }, () => scheduler.request(0));
    channel = current;
    current.subscribe((status: string) => {
      if (stopped || channel !== current) return;
      if (status === "SUBSCRIBED") {
        attempts = 0;
        setLiveStatus("live");
        scheduler.setLive(true);
        scheduler.request(0); // catch up on anything missed while disconnected
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        scheduler.setLive(false);
        setLiveStatus("reconnecting");
        attempts += 1;
        window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(() => {
          if (stopped || channel !== current) return;
          void supabase.removeChannel(current);
          connect();
        }, Math.min(30_000, 1_000 * 2 ** Math.min(attempts, 5)));
      }
    });
  };
  connect();
  scheduler.request(0);

  return () => {
    stopped = true;
    scheduler.stop();
    window.clearTimeout(reconnectTimer);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    window.removeEventListener("pageshow", wake);
    document.removeEventListener("visibilitychange", onVisible);
    stopLocal();
    if (channel) void supabase.removeChannel(channel);
    channel = null;
    setLiveStatus("off");
  };
}

/**
 * Deduct stock for a settled bill: portions of dishes counted directly, and
 * raw materials from each dish's recipe (as a ledger entry tied to the bill).
 */
export async function applyLocalStockSale(soldLines: Order["lines"], ref?: { orderUid: string; billNo: string; by?: string | undefined }): Promise<void> {
  const db = getDb();
  const items = await db.inventory.toArray();
  const changed = deductInventory(soldLines, items).filter((item) => item.synced === false);
  if (changed.length) {
    await db.inventory.bulkPut(changed);
    await markDirty(...changed.map((item): [RecordKind, string] => ["inventory", item.id]));
  }
  if (ref) await recordSaleConsumption(soldLines, ref);
}

export async function getSyncSnapshot() {
  const db = getDb();
  const [total, pendingOrders, lastSync, error, notice] = await Promise.all([
    db.outbox.count(),
    db.outbox.where("kind").equals("order").count(),
    db.meta.get("lastSyncAt"),
    db.meta.get("syncError"),
    db.meta.get("syncNotice"),
  ]);
  return {
    pendingOrders,
    pendingStock: total - pendingOrders,
    lastSyncAt: typeof lastSync?.value === "number" ? lastSync.value : null,
    error: typeof error?.value === "string" ? error.value : "",
    notice: describeNotice(notice?.value),
  };
}

const KIND_WORDS: Record<string, string> = { settings: "restaurant details", menu: "menu", material: "stock items", supplier: "suppliers", order: "settled bills" };

/** Plain words for changes the cloud refused and this device put back. */
export function describeNotice(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const n = JSON.parse(value) as { count?: number; kinds?: string[]; prelaunch?: number };
    const parts: string[] = [];
    if (n.prelaunch) parts.push(`${n.prelaunch} test record${n.prelaunch === 1 ? "" : "s"} from before launch (old bills or kitchen tickets) ${n.prelaunch === 1 ? "was" : "were"} removed from this device. They are not part of the restaurant's books.`);
    if (n.count) {
      const what = (n.kinds ?? []).map((k) => KIND_WORDS[k] ?? k).join(", ");
      parts.push(`${n.count} change${n.count === 1 ? "" : "s"} to ${what || "records"} ${n.count === 1 ? "was" : "were"} undone: only the owner or a manager can make ${n.count === 1 ? "it" : "them"}.`);
    }
    return parts.length ? `${parts.join(" ")} Everything else synced normally.` : "";
  } catch { return ""; }
}

export async function clearSyncNotice() { await getDb().meta.delete("syncNotice"); }

export async function saveSyncError(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof (error as { message: unknown }).message === "string"
      ? (error as { message: string }).message
      : "Sync could not be completed.";
  await getDb().meta.put({ key: "syncError", value: message.slice(0, 500) });
}
