import { fakeDevices } from "./fake-dexie";

/**
 * In-memory stand-in for the restaurant_records table and the bits of the
 * Supabase client sync uses. Like Postgres, the server stamps updated_at
 * itself; tests can move its clock, take it offline, or give a device a
 * role whose settings writes are refused (row level security).
 */

interface ServerRow {
  restaurant_id: string;
  kind: string;
  record_id: string;
  payload: unknown;
  deleted: boolean;
  updated_at: string;
  version?: number;
}

export const fakeServer = {
  rows: new Map<string, ServerRow>(),
  /** Server clock (ms). Each write moves it on by `stepMs`, like rows committing over time. */
  now: Date.parse("2026-10-17T09:00:00.000Z"),
  stepMs: 1000,
  offline: false,
  claimFails: false,
  /** Devices whose role can't change restaurant settings (cashier, captain, kitchen). */
  staffOnly: new Set<string>(),
  /** Like migration 0012: bills, tickets and stock made before this moment are refused. */
  launchedAt: null as number | null,
  requests: { upsert: 0, select: 0, rowsReturned: 0, rpc: 0 } as { upsert: number; select: number; rowsReturned: number; rpc?: number },
  /** Like migration 0020 being applied: push_restaurant_records exists and rows carry versions. */
  versioned: false,
  /** (restaurant|submission|station|kind) -> canonical KOT record id. */
  kotLedger: new Map<string, string>(),
  /** (restaurant|order|paymentKey) -> payment. Unique like bill_payments. */
  payments: new Map<string, { mode: string; amount: number }>(),
  /** Called before each row of a push is applied; tests use it to inject a concurrent write. */
  beforeRow: null as null | ((row: { kind: string; record_id: string }) => void),
  reset() {
    this.versioned = false;
    this.kotLedger.clear();
    this.payments.clear();
    this.beforeRow = null;
    this.rows.clear();
    this.now = Date.parse("2026-10-17T09:00:00.000Z");
    this.stepMs = 1000;
    this.offline = false;
    this.claimFails = false;
    this.staffOnly.clear();
    this.launchedAt = null;
    this.requests = { upsert: 0, select: 0, rowsReturned: 0, rpc: 0 };
  },
  /** Write a row directly with a chosen timestamp (e.g. one that committed late). */
  insertAt(row: Omit<ServerRow, "updated_at">, at: number) {
    this.rows.set(`${row.restaurant_id}|${row.kind}|${row.record_id}`, { ...structuredClone(row), updated_at: new Date(at).toISOString() });
  },
};

const offlineError = { message: "Failed to fetch", code: "NETWORK" };

type InRow = Omit<ServerRow, "updated_at" | "version">;
const rowKey = (r: { restaurant_id: string; kind: string; record_id: string }) => `${r.restaurant_id}|${r.kind}|${r.record_id}`;

/** Server-side write shared by both paths: versions bump, duplicate KOT tickets are skipped. */
function writeRow(r: InRow): number | null {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  if (fakeServer.versioned && r.kind === "kot" && !r.deleted && typeof p["submissionId"] === "string" && !fakeServer.rows.has(rowKey(r))) {
    const k = `${r.restaurant_id}|${p["submissionId"]}|${String(p["station"] ?? "")}|${String(p["kind"] ?? "new")}`;
    const canonical = fakeServer.kotLedger.get(k);
    if (canonical && canonical !== r.record_id) return null;
    fakeServer.kotLedger.set(k, r.record_id);
  }
  fakeServer.now += fakeServer.stepMs;
  const prev = fakeServer.rows.get(rowKey(r));
  const version = prev ? (prev.version ?? 1) + 1 : 1;
  fakeServer.rows.set(rowKey(r), { ...structuredClone(r), updated_at: new Date(fakeServer.now).toISOString(), version });
  return version;
}

function prelaunchRefusal(r: InRow): string | null {
  if (fakeServer.launchedAt === null || r.deleted || !["order", "kot", "stock_entry", "day_close"].includes(r.kind)) return null;
  const at = Number((r.payload as Record<string, unknown>)?.["createdAt"] ?? (r.payload as Record<string, unknown>)?.["at"] ?? Infinity);
  return at < fakeServer.launchedAt ? `Made before launch: ${r.kind} ${r.record_id} is a pre-launch record and is not kept.` : null;
}

class UnitFailure extends Error { constructor(public result: Record<string, unknown>) { super("unit failed"); } }

/** Mirrors public.push_restaurant_records in migration 0020. */
function pushRecords(restaurantId: string, units: { rows: (InRow & { base_version: number | null })[] }[]) {
  const results: Record<string, unknown>[] = [];
  for (const unit of units) {
    // Concurrent sessions commit independently, before this unit's transaction takes its row locks.
    for (const raw of unit.rows) fakeServer.beforeRow?.({ kind: raw.kind, record_id: raw.record_id });
    const snapshotRows = new Map([...fakeServer.rows].map(([k, v]) => [k, structuredClone(v)]));
    const snapshotLedger = new Map(fakeServer.kotLedger);
    const snapshotPayments = new Map(fakeServer.payments);
    const snapshotNow = fakeServer.now;
    const unitResults: Record<string, unknown>[] = [];
    try {
      for (const raw of unit.rows) {
        const r: InRow = { restaurant_id: restaurantId, kind: raw.kind, record_id: raw.record_id, payload: raw.payload, deleted: raw.deleted };
        const id = { kind: r.kind, record_id: r.record_id };
        const p = (r.payload ?? {}) as Record<string, unknown>;
        if (r.kind === "kot" && !r.deleted && typeof p["submissionId"] === "string") {
          const canonical = fakeServer.kotLedger.get(`${restaurantId}|${p["submissionId"]}|${String(p["station"] ?? "")}|${String(p["kind"] ?? "new")}`);
          if (canonical && canonical !== r.record_id) { unitResults.push({ ...id, status: "duplicate", canonical_record_id: canonical }); continue; }
        }
        if (fakeServer.staffOnly.has(fakeDevices.current) && refusedForStaff(r)) throw new UnitFailure({ ...id, status: "error", code: "42501", message: "new row violates row-level security policy" });
        const pre = prelaunchRefusal(r);
        if (pre) throw new UnitFailure({ ...id, status: "error", code: "42501", message: pre });
        const cur = fakeServer.rows.get(rowKey(r));
        let version: number;
        if (cur) {
          const same = JSON.stringify(cur.payload) === JSON.stringify(r.payload) && cur.deleted === r.deleted;
          const stale = (raw.base_version !== null && (cur.version ?? 1) !== raw.base_version) || (raw.base_version === null && r.kind === "order");
          if (stale && !same) throw new UnitFailure({ ...id, status: "conflict", version: cur.version ?? 1, payload: structuredClone(cur.payload), deleted: cur.deleted });
          version = same ? (cur.version ?? 1) : (writeRow(r) as number);
        } else {
          const v = writeRow(r);
          if (v === null) throw new UnitFailure({ ...id, status: "conflict", race: true });
          version = v;
        }
        if (r.kind === "order" && !r.deleted && p["status"] === "settled" && Array.isArray(p["payments"])) {
          (p["payments"] as { mode: string; amount: number }[]).forEach((pay, i) => {
            const k = `${restaurantId}|${r.record_id}|${i}:${pay.mode}`;
            if (!fakeServer.payments.has(k)) fakeServer.payments.set(k, { mode: pay.mode, amount: pay.amount });
          });
        }
        unitResults.push({ ...id, status: "applied", version });
      }
      results.push(...unitResults);
    } catch (e) {
      if (!(e instanceof UnitFailure)) throw e;
      fakeServer.rows = snapshotRows; fakeServer.kotLedger = snapshotLedger; fakeServer.payments = snapshotPayments; fakeServer.now = snapshotNow;
      for (const raw of unit.rows) {
        if (raw.kind === e.result["kind"] && raw.record_id === e.result["record_id"]) results.push(e.result);
        else results.push({ kind: raw.kind, record_id: raw.record_id, status: "rolled_back" });
      }
    }
  }
  return results;
}

const ADMIN_KINDS = ["settings", "menu", "material", "supplier"];
function refusedForStaff(row: Omit<ServerRow, "updated_at">): boolean {
  if (ADMIN_KINDS.includes(row.kind)) return true;
  if (row.kind !== "order") return false;
  const before = fakeServer.rows.get(`${row.restaurant_id}|${row.kind}|${row.record_id}`)?.payload as { status?: string; total?: number; lines?: unknown } | undefined;
  if (!before || (before.status !== "settled" && before.status !== "void")) return false;
  const after = row.payload as { status?: string; total?: number; lines?: unknown };
  return row.deleted || after.status !== before.status || after.total !== before.total || JSON.stringify(after.lines) !== JSON.stringify(before.lines);
}

class Query implements PromiseLike<{ data: ServerRow[] | null; error: { message: string } | null }> {
  constructor(private table: string = "restaurant_records") {}
  private filters: ((r: ServerRow) => boolean)[] = [];
  private max = Infinity;
  eq(col: keyof ServerRow, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  gte(col: keyof ServerRow, v: string) { this.filters.push((r) => String(r[col]) >= v); return this; }
  gt(col: keyof ServerRow, v: string) { this.filters.push((r) => String(r[col]) > v); return this; }
  in(col: keyof ServerRow, values: unknown[]) { this.filters.push((r) => values.includes(r[col])); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  then<A, B>(ok?: ((v: { data: ServerRow[] | null; error: { message: string } | null }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
    if (this.table === "counter_numbering") {
      return Promise.resolve({ data: [], error: fakeServer.offline ? offlineError : null }).then(ok, fail);
    }
    fakeServer.requests.select += 1;
    const result = fakeServer.offline
      ? { data: null, error: offlineError }
      : {
          data: [...fakeServer.rows.values()].filter((r) => this.filters.every((f) => f(r)))
            .sort((a, b) => (a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : 0))
            .slice(0, this.max).map((r) => structuredClone(r)),
          error: null,
        };
    fakeServer.requests.rowsReturned += result.data?.length ?? 0;
    return Promise.resolve(result).then(ok, fail);
  }
}

export const supabase = {
  from(_table: string) {
    return {
      async upsert(rows: Omit<ServerRow, "updated_at">[]) {
        fakeServer.requests.upsert += 1;
        if (fakeServer.offline) return { error: offlineError };
        // Like the database rules (0008): staff can't change settings, menu, materials or suppliers,
        // or alter a settled or cancelled bill. One refused row fails the whole request.
        if (fakeServer.staffOnly.has(fakeDevices.current) && rows.some((r) => refusedForStaff(r))) {
          return { error: { message: 'new row violates row-level security policy for table "restaurant_records"', code: "42501" } };
        }
        const prelaunch = rows.map(prelaunchRefusal).find(Boolean);
        if (prelaunch) return { error: { message: prelaunch, code: "42501" } };
        for (const r of rows) writeRow(r);
        return { error: null };
      },
      select(_cols: string) { return new Query(_table); },
    };
  },
  auth: { async getUser() { return { data: { user: { id: `user-${fakeDevices.current}`, email: `${fakeDevices.current}@test` } }, error: null }; } },
  channel() { const c = { on: () => c, subscribe: () => c }; return c; },
  async removeChannel() { return "ok"; },
  async rpc(name?: string, args?: { _restaurant_id: string; _units: { rows: (InRow & { base_version: number | null })[] }[] }) {
    if (name === "claim_offline_number" && fakeServer.claimFails) return { data: null, error: { code: "P0001", message: "claim service unavailable" } };
    if (name !== "push_restaurant_records") return { data: null, error: null };
    fakeServer.requests.rpc = (fakeServer.requests.rpc ?? 0) + 1;
    if (fakeServer.offline) return { data: null, error: offlineError };
    if (!fakeServer.versioned) return { data: null, error: { code: "PGRST202", message: "Could not find the function public.push_restaurant_records" } };
    return { data: pushRecords(args!._restaurant_id, args!._units), error: null };
  },
};
