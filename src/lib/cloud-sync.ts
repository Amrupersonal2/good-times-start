import { supabase } from "@/integrations/supabase/client";
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

async function upsertAllowed(rows: PushRow[]): Promise<RefusedRow[]> {
  const error = await upsert(rows);
  if (!error) return [];
  if (!isRefusal(error)) throw error;
  const refused: RefusedRow[] = [];
  for (const row of rows) {
    const one = await upsert([row]);
    if (!one) continue;
    if (!isRefusal(one)) throw one;
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

async function applyRemote(rows: RemoteRow[]): Promise<void> {
  const db = getDb();
  // The outbox is read inside the same transaction, so a local edit can't slip in between the check and the write.
  await db.transaction("rw", [db.outbox, db.menu, db.restTables, db.inventory, db.orders, db.kots, db.meta, db.materials, db.suppliers, db.stockEntries, db.customers, db.dayCloses, db.materialLevels], async () => {
    const pending = new Set((await db.outbox.toCollection().primaryKeys()).map(String));
    for (const row of rows) {
      if (!isKind(row.kind)) continue;
      // Local edits that haven't been pushed yet win; they'll overwrite the cloud copy next push.
      if (pending.has(outboxKey(row.kind, row.record_id))) continue;
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
          await db.orders.put(order);
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
      .select("kind,record_id,payload,deleted,updated_at")
      .eq("restaurant_id", restaurantId)
      .order("updated_at", { ascending: true })
      .limit(PULL_PAGE);
    if (from) query = firstPage ? query.gte("updated_at", from) : query.gt("updated_at", from);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as RemoteRow[];
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

  const stopLocal = onLocalChange(() => scheduler.request(800));
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
      .on("postgres_changes", { event: "*", schema: "public", table: "restaurant_records", filter: `restaurant_id=eq.${restaurantId}` }, () => scheduler.request(250));
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
