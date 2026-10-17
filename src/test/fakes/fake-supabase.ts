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
}

export const fakeServer = {
  rows: new Map<string, ServerRow>(),
  /** Server clock (ms). Each write moves it on by `stepMs`, like rows committing over time. */
  now: Date.parse("2026-10-17T09:00:00.000Z"),
  stepMs: 1000,
  offline: false,
  /** Devices whose role can't change restaurant settings (cashier, captain, kitchen). */
  staffOnly: new Set<string>(),
  requests: { upsert: 0, select: 0, rowsReturned: 0 },
  reset() {
    this.rows.clear();
    this.now = Date.parse("2026-10-17T09:00:00.000Z");
    this.stepMs = 1000;
    this.offline = false;
    this.staffOnly.clear();
    this.requests = { upsert: 0, select: 0, rowsReturned: 0 };
  },
  /** Write a row directly with a chosen timestamp (e.g. one that committed late). */
  insertAt(row: Omit<ServerRow, "updated_at">, at: number) {
    this.rows.set(`${row.restaurant_id}|${row.kind}|${row.record_id}`, { ...structuredClone(row), updated_at: new Date(at).toISOString() });
  },
};

const offlineError = { message: "Failed to fetch", code: "NETWORK" };

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
  private filters: ((r: ServerRow) => boolean)[] = [];
  private max = Infinity;
  eq(col: keyof ServerRow, v: unknown) { this.filters.push((r) => r[col] === v); return this; }
  gte(col: keyof ServerRow, v: string) { this.filters.push((r) => String(r[col]) >= v); return this; }
  gt(col: keyof ServerRow, v: string) { this.filters.push((r) => String(r[col]) > v); return this; }
  in(col: keyof ServerRow, values: unknown[]) { this.filters.push((r) => values.includes(r[col])); return this; }
  order() { return this; }
  limit(n: number) { this.max = n; return this; }
  then<A, B>(ok?: ((v: { data: ServerRow[] | null; error: { message: string } | null }) => A | PromiseLike<A>) | null, fail?: ((e: unknown) => B | PromiseLike<B>) | null) {
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
        for (const r of rows) {
          fakeServer.now += fakeServer.stepMs;
          fakeServer.rows.set(`${r.restaurant_id}|${r.kind}|${r.record_id}`, { ...structuredClone(r), updated_at: new Date(fakeServer.now).toISOString() });
        }
        return { error: null };
      },
      select(_cols: string) { return new Query(); },
    };
  },
  auth: { async getUser() { return { data: { user: { id: `user-${fakeDevices.current}`, email: `${fakeDevices.current}@test` } }, error: null }; } },
  channel() { const c = { on: () => c, subscribe: () => c }; return c; },
  async removeChannel() { return "ok"; },
  async rpc() { return { data: null, error: null }; },
};
