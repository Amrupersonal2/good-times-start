/**
 * In-memory stand-in for the parts of Dexie the app uses, for sync tests.
 *
 * Every table operation is routed to the "current device" (fakeDevices.use),
 * so one test can play several tills and kitchen screens against one fake
 * server while running the real app modules. Values are cloned on the way in
 * and out, like IndexedDB.
 */

type Row = Record<string, unknown>;
type Key = string | number;

interface Store { rows: Map<string, Row>; autoInc: number }

const stores = new Map<string, Store>();
export const fakeDevices = {
  current: "A",
  use(device: string) { this.current = device; },
  reset() { stores.clear(); this.current = "A"; },
};

const clone = <T>(v: T): T => structuredClone(v);
const keyOf = (k: unknown) => JSON.stringify(k);

function pathValue(row: Row, path: string): unknown {
  if (path.startsWith("[")) return path.slice(1, -1).split("+").map((p) => pathValue(row, p));
  let v: unknown = row;
  for (const part of path.split(".")) v = v && typeof v === "object" ? (v as Row)[part] : undefined;
  return v;
}

function compare(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) { const c = compare(a[i], b[i]); if (c) return c; }
    return 0;
  }
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

class FakeCollection {
  constructor(private source: () => Row[], private pk: string) {}
  private wrap(fn: (rows: Row[]) => Row[]) { return new FakeCollection(() => fn(this.source()), this.pk); }
  filter(fn: (r: Row) => boolean) { return this.wrap((rows) => rows.filter((r) => fn(clone(r)))); }
  and(fn: (r: Row) => boolean) { return this.filter(fn); }
  limit(n: number) { return this.wrap((rows) => rows.slice(0, n)); }
  offset(n: number) { return this.wrap((rows) => rows.slice(n)); }
  reverse() { return this.wrap((rows) => [...rows].reverse()); }
  async toArray() { return this.source().map(clone); }
  async first() { const r = this.source()[0]; return r ? clone(r) : undefined; }
  async last() { const rows = this.source(); const r = rows[rows.length - 1]; return r ? clone(r) : undefined; }
  async count() { return this.source().length; }
  async sortBy(path: string) { return this.source().map(clone).sort((a, b) => compare(pathValue(a, path), pathValue(b, path))); }
  async primaryKeys() { return this.source().map((r) => r[this.pk] as Key); }
  async modify(fn: (r: Row) => void) { const rows = this.source(); for (const r of rows) fn(r); return rows.length; }
  async delete() { return 0; }
}

class FakeWhere {
  constructor(private table: FakeTable, private index: string) {}
  private by(test: (v: unknown) => boolean) {
    return new FakeCollection(() => this.table.allRows().filter((r) => test(pathValue(r, this.index))).sort((a, b) => compare(pathValue(a, this.index), pathValue(b, this.index))), this.table.pk);
  }
  equals(v: unknown) { return this.by((x) => compare(x, v) === 0); }
  anyOf(vs: unknown[]) { return this.by((x) => vs.some((v) => compare(x, v) === 0)); }
  above(v: unknown) { return this.by((x) => x !== undefined && compare(x, v) > 0); }
  aboveOrEqual(v: unknown) { return this.by((x) => x !== undefined && compare(x, v) >= 0); }
  below(v: unknown) { return this.by((x) => x !== undefined && compare(x, v) < 0); }
  belowOrEqual(v: unknown) { return this.by((x) => x !== undefined && compare(x, v) <= 0); }
  between(lo: unknown, hi: unknown, incLo = true, incHi = false) {
    return this.by((x) => x !== undefined && (incLo ? compare(x, lo) >= 0 : compare(x, lo) > 0) && (incHi ? compare(x, hi) <= 0 : compare(x, hi) < 0));
  }
}

export class FakeTable {
  readonly pk: string;
  private readonly auto: boolean;
  constructor(private dbName: string, readonly name: string, schema: string) {
    const first = schema.split(",")[0]!.trim();
    this.auto = first.startsWith("++");
    this.pk = first.replace(/^\+\+/, "");
  }
  private store(): Store {
    const k = `${fakeDevices.current}/${this.dbName}/${this.name}`;
    let s = stores.get(k);
    if (!s) { s = { rows: new Map(), autoInc: 0 }; stores.set(k, s); }
    return s;
  }
  allRows(): Row[] { return [...this.store().rows.values()].sort((a, b) => compare(a[this.pk], b[this.pk])); }
  async get(key: Key) { const r = this.store().rows.get(keyOf(key)); return r ? clone(r) : undefined; }
  async put(obj: Row) {
    const s = this.store();
    const row = clone(obj);
    if (row[this.pk] === undefined) {
      if (!this.auto) throw new Error(`${this.name}: missing key ${this.pk}`);
      s.autoInc += 1;
      row[this.pk] = s.autoInc;
    } else if (this.auto && typeof row[this.pk] === "number") s.autoInc = Math.max(s.autoInc, row[this.pk] as number);
    s.rows.set(keyOf(row[this.pk]), row);
    return row[this.pk] as Key;
  }
  async add(obj: Row) {
    if (obj[this.pk] !== undefined && this.store().rows.has(keyOf(obj[this.pk]))) throw new Error(`${this.name}: key exists`);
    return this.put(obj);
  }
  async bulkPut(objs: Row[]) { let last: Key | undefined; for (const o of objs) last = await this.put(o); return last; }
  async bulkAdd(objs: Row[]) { let last: Key | undefined; for (const o of objs) last = await this.add(o); return last; }
  async bulkGet(keys: Key[]) { return Promise.all(keys.map((k) => this.get(k))); }
  async bulkDelete(keys: Key[]) { for (const k of keys) this.store().rows.delete(keyOf(k)); }
  async update(key: Key, changes: Row) {
    const r = this.store().rows.get(keyOf(key));
    if (!r) return 0;
    for (const [k, v] of Object.entries(clone(changes))) { if (v === undefined) delete r[k]; else r[k] = v; }
    return 1;
  }
  async delete(key: Key) { this.store().rows.delete(keyOf(key)); }
  async clear() { this.store().rows.clear(); }
  async count() { return this.store().rows.size; }
  async toArray() { return this.allRows().map(clone); }
  where(index: string) { return new FakeWhere(this, index); }
  orderBy(index: string) { return new FakeCollection(() => this.allRows().sort((a, b) => compare(pathValue(a, index), pathValue(b, index))), this.pk); }
  toCollection() { return new FakeCollection(() => this.allRows(), this.pk); }
  filter(fn: (r: Row) => boolean) { return this.toCollection().filter(fn); }
  limit(n: number) { return this.toCollection().limit(n); }
}

export default class FakeDexie {
  [table: string]: unknown;
  constructor(private readonly dbName: string) {}
  version(_n: number) {
    const self = this;
    const v = {
      stores(schema: Record<string, string | null>) {
        for (const [name, def] of Object.entries(schema)) if (def) self[name] = new FakeTable(self.dbName, name, def);
        return v;
      },
      upgrade() { return v; },
    };
    return v;
  }
  table(name: string) { return this[name]; }
  async transaction(_mode: string, ...args: unknown[]) {
    const fn = args[args.length - 1] as () => unknown;
    return fn();
  }
}

export type Table = FakeTable;
