import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { placeName, withOpenBills } from "@/lib/table-logic";
import { toast } from "sonner";
import { ArrowRightLeft, Combine, MoreHorizontal, Pencil, Plus, ReceiptText, ShoppingBag, Trash2, Users, QrCode } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { COUNTER_TYPES } from "@/lib/bill-entry";
import { holdLabel } from "@/lib/table-hold";
import type { Order } from "@/lib/types";
import { openQrRequests } from "@/components/GuestOrders";
import { AppShell } from "@/components/AppShell";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDb } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { formatINR } from "@/lib/billing";
import { deleteTable, mergeTables, moveTable, saveTable, setTableStatus, tableIdFor } from "@/lib/table-actions";
import type { RestaurantTable, TableStatus } from "@/lib/types";
import { ConfirmButton } from "@/components/ConfirmButton";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import { useReservations } from "@/lib/use-reservations";
import { withReservations } from "@/lib/reservations";
import { startReservationOrder } from "@/lib/reservation-actions";
import { boardTables } from "@/lib/table-board";
import { dayBounds, dateLabel } from "@/lib/orders-history";
import { BillPrintButton } from "@/components/BillPrintButton";
import { reportOrders } from "@/lib/report-orders";
import { hasBillNumber, shortBillNo } from "@/lib/bill-numbering";

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [
      { title: "Tables — TAB Bistro by XTSY" },
      { name: "description", content: "Live floor plan: open bills, move or merge tables, and arrange sections." }, { property: "og:title", content: "Tables — XTSY POS" }, { property: "og:description", content: "Live floor plan: open bills, move or merge tables, and arrange sections." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },],
  }),
  component: TablesPage,
});

const STATUS: Record<TableStatus, { label: string; cls: string }> = {
  free: { label: "Free", cls: "border-border bg-card" },
  occupied: { label: "Occupied", cls: "border-primary bg-primary-tint" },
  billed: { label: "Bill printed", cls: "border-gold bg-gold/15" },
  reserved: { label: "Reserved", cls: "border-dashed border-gold bg-card" },
};
const DEFAULT_SECTIONS = ["Rooms", "Dine-in"];

function minutesSince(since?: number) {
  if (!since) return "";
  const m = Math.max(0, Math.round((Date.now() - since) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function TableForm({ table, sections, taken, onDone, newSection = false }: { table: RestaurantTable | null; sections: string[]; taken: string[]; onDone: () => void; newSection?: boolean }) {
  const [label, setLabel] = useState(table?.label ?? "");
  const [section, setSection] = useState(newSection ? "" : table?.section ?? sections[0] ?? "Dine-in");
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const n = Number(seats);
    if (!label.trim()) { setError("Enter a table name, like T7."); return; }
    if (!section.trim()) { setError("Enter a section, like Rooms or Dine-in."); return; }
    if (!Number.isInteger(n) || n < 1 || n > 50) { setError("Seats must be between 1 and 50."); return; }
    if (newSection && sections.some((s) => s.toLowerCase() === section.trim().toLowerCase())) { setError("This section already exists. Use Add table to add a table to it."); return; }
    try {
      await saveTable({ id: table?.id ?? tableIdFor(label, taken), label: label.trim().slice(0, 12), section: section.trim().slice(0, 30), seats: n });
      toast.success(newSection ? `${section.trim()} created with ${label.trim()}` : table ? `${label.trim()} updated` : `${label.trim()} added`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save this table.");
    }
  };
  const remove = async () => {
    if (!table) return;
    try {
      await deleteTable(table.id);
      toast.success(`${table.label} deleted`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete this table.");
    }
  };

  return (
    <form className="space-y-3" onSubmit={(event) => void submit(event)}>
      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-1 block text-sm font-medium">{newSection ? "First table" : "Name"}
          <input autoFocus required maxLength={12} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="T7" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
        </label>
        <label className="col-span-1 block text-sm font-medium">Section
          <input list="floor-sections" maxLength={30} value={section} onChange={(e) => setSection(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
        </label>
        <label className="col-span-1 block text-sm font-medium">Seats
          <input inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
        </label>
      </div>
      <datalist id="floor-sections">{sections.map((s) => <option key={s} value={s} />)}</datalist>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex gap-2">
        <Button type="submit">{newSection ? "Create section & table" : table ? "Save table" : "Add table"}</Button>
        <Button type="button" variant="ghost" onClick={onDone}>Cancel</Button>
        {table ? <ConfirmButton id={`delete-table-${table.id}`} className={cn(buttonVariants({ variant: "ghost" }), "ml-auto text-destructive hover:text-destructive")} armedClassName="!bg-destructive !text-destructive-foreground"
          onConfirm={remove} confirm={<><Trash2 />Tap again to delete</>}><Trash2 />Delete</ConfirmButton> : null}
      </div>
    </form>
  );
}

function TableActions({ table, tables, onDone }: { table: RestaurantTable; tables: RestaurantTable[]; onDone: () => void }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"menu" | "move" | "merge">("menu");
  const busy = table.status === "occupied" || table.status === "billed";
  const free = tables.filter((t) => t.id !== table.id && (t.status === "free" || t.status === "reserved"));
  const occupied = tables.filter((t) => t.id !== table.id && (t.status === "occupied" || t.status === "billed"));

  const run = async (action: () => Promise<void>, done: string) => {
    try {
      await action();
      toast.success(done);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That didn't work. Try again.");
    }
  };

  if (mode !== "menu") {
    const targets = mode === "move" ? free : occupied;
    return (
      <div>
        <p className="text-sm text-muted-foreground">{mode === "move" ? `Move ${table.label}'s bill to:` : `Add ${table.label}'s items to the bill on:`}</p>
        {targets.length ? (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {targets.map((t) => (
              <button key={t.id} type="button" className="rounded-lg border border-border px-2 py-3 text-center font-bold hover:border-primary"
                onClick={() => void run(
                  () => (mode === "move" ? moveTable(table.id, t.id) : mergeTables(table.id, t.id)),
                  mode === "move" ? `Moved to ${t.label}` : `${table.label} merged into ${t.label}`,
                )}>
                {t.label}
              </button>
            ))}
          </div>
        ) : <p className="mt-3 rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{mode === "move" ? "No free tables right now." : "No other table has a running bill."}</p>}
        <Button variant="ghost" className="mt-3" onClick={() => setMode("menu")}>Back</Button>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <Button className="justify-start" onClick={() => { onDone(); void navigate({ to: "/", search: { table: table.id } }); }}><ReceiptText />{busy ? "Open the bill" : "Start a bill"}</Button>
      {busy ? <>
        <Button variant="outline" className="justify-start" onClick={() => setMode("move")}><ArrowRightLeft />Move to another table</Button>
        <Button variant="outline" className="justify-start" onClick={() => setMode("merge")}><Combine />Merge into another table</Button>
      </> : null}
      {table.status === "free" ? <Button variant="outline" className="justify-start" onClick={() => void run(() => setTableStatus(table.id, "reserved"), `${table.label} reserved`)}>Reserve</Button> : null}
      {table.status !== "free" ? <ConfirmButton id={`free-${table.id}`} className={cn(buttonVariants({ variant: "ghost" }), "justify-start")} armedClassName="!bg-gold/20"
        onConfirm={() => run(() => setTableStatus(table.id, "free"), `${table.label} is free`)} confirm="Tap again to free the table">Mark as free</ConfirmButton> : null}
    </div>
  );
}

function TablesPage() {
  const navigate = useNavigate();
  const bookings = useReservations();
  const floorTables = useLiveQuery(async () => {
    const db = getDb();
    const [floor, held, closed, drafts] = await Promise.all([
      db.restTables.toArray(),
      db.orders.where("status").equals("held").toArray(),
      db.orders.where("status").anyOf("settled", "void").toArray(),
      db.drafts.toArray(),
    ]);
    const newDraftTables = drafts.filter((d) => !d.orderUid && d.lines.length && d.tableId).map((d) => d.tableId).filter((id): id is string => !!id);
    return withOpenBills(floor, held, closed, newDraftTables);
  }, [], []);
  const [start, end] = dayBounds(dateLabel());
  const activity = useLiveQuery(async () => {
    const db = getDb();
    const [records, cancelled] = await Promise.all([reportOrders({ from: start, to: end - 1 }), db.orders.where("status").equals("void").toArray()]);
    return { closed: [...new Map([...records, ...cancelled].map((o) => [o.uid ?? o.id ?? o.billNo, o])).values()] };
  }, [start, end], { closed: [] });
  const tables = boardTables(withReservations(floorTables, bookings.rows, Date.now()), activity.closed, start, end);
  // Running bills with no table: takeaway, delivery, app and guest pickup orders.
  const counterBills = useLiveQuery(async () => (await getDb().orders.where("status").equals("held").toArray())
    .sort((a, b) => a.createdAt - b.createdAt), [], [] as Order[]);
  const qrBills = tables.filter((t) => t.qrBill).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const { user } = useStaff();
  const canEdit = can(user, "tables.edit");
  const canBill = can(user, "bill.create");
  const openBill = async (t: (typeof tables)[number]) => {
    try {
      if (t.booking && t.status === "reserved") await startReservationOrder(t.booking);
      await navigate({ to: "/", search: { table: t.id } });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not open this table."); }
  };
  const [editing, setEditing] = useState(false);
  const visibleTables = tables;
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState<RestaurantTable | "new" | "section" | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const sections = useMemo(() => {
    const used = [...new Set(tables.map((t) => t.section))];
    return [...DEFAULT_SECTIONS.filter((s) => used.includes(s)), ...used.filter((s) => !DEFAULT_SECTIONS.includes(s)).sort()];
  }, [tables]);
  const live = selected ? tables.find((t) => t.id === selected.id) ?? null : null;
  const counts = [
    { label: "free", count: tables.filter((t) => t.status === "free").length, tone: "text-success" },
    { label: "occupied", count: tables.filter((t) => t.status === "occupied" || t.status === "billed").length, tone: "text-primary" },
    { label: "booked", count: tables.filter((t) => t.booking || t.status === "reserved").length, tone: "text-warning" },
    { label: "settled today", count: tables.filter((t) => t.settledAt !== undefined).length, tone: "text-success" },
  ];

  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Tables</h1>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Table summary">
              {counts.filter((c) => c.count > 0 || c.label === "free").map((c) => <span key={c.label} className={c.tone}><strong className="text-lg tabular-nums">{c.count}</strong> {c.label}</span>)}
            </div>
          </div>
          {canEdit ? (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setForm("section")}><Plus />Add section</Button>
              <Button variant="outline" onClick={() => setForm("new")}><Plus />Add table</Button>
              <Button variant={editing ? "default" : "outline"} onClick={() => setEditing(!editing)}><Pencil />{editing ? "Done" : "Edit floor"}</Button>
            </div>
          ) : null}
        </div>

        {canBill ? (
          <section className="mb-7" aria-label="Counter orders">
            <h2 className="mb-3 text-base font-bold">Counter orders</h2>
            <div className="flex flex-wrap gap-2">
              {COUNTER_TYPES.map((t) => (
                <Button key={t.v} variant="outline" asChild><Link to="/" search={{ type: t.v }}><Plus />{t.l}</Link></Button>
              ))}
              <Button variant="outline" onClick={openQrRequests}><QrCode />QR Scan & Order</Button>
            </div>
            <div className="mt-3 grid auto-rows-fr grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {counterBills.map((o) => (
                <div key={o.uid ?? o.billNo} className="flex min-h-16 min-w-0 items-center gap-2"><Button variant="outline" className="grid h-full min-h-16 min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] justify-start border-primary/40 bg-primary-tint py-2 text-left" asChild>
                  <Link to="/" search={{ bill: o.uid ?? "" }} title={hasBillNumber(o) ? `Running bill ${o.billNo}` : "Running bill"}>
                    <ShoppingBag className="shrink-0" /><span className="min-w-0 whitespace-normal"><span className="block font-bold">{o.tableId ? `${o.tableSection ?? tables.find((t) => t.id === o.tableId)?.section ?? ""} · ${o.tableLabel ?? tables.find((t) => t.id === o.tableId)?.label ?? o.tableId}` : o.customer?.name ?? COUNTER_TYPES.find((c) => c.v === o.orderType)?.l ?? "Counter"}</span><span className="block text-xs text-muted-foreground">{o.guestCodes?.[0] ?? (shortBillNo(o) || `${o.lines.reduce((n, l) => n + l.qty, 0)} items`)}{o.tableId && o.customer?.name ? ` · ${o.customer.name}` : ""}</span></span>
                    <span className="shrink-0 font-bold">{formatINR(o.total, 0)}</span>
                  </Link>
                </Button><BillPrintButton order={o} className="shrink-0" /></div>
              ))}
              {tables.filter((t) => t.booking && !counterBills.some((o) => o.tableId === t.id)).map((t) => (
                <Button key={`allotted-${t.id}`} variant="outline" className="grid h-full min-h-16 w-full grid-cols-[auto_minmax(0,1fr)] justify-start border-gold bg-gold/15 py-2 text-left" onClick={() => void openBill(t)}>
                  <Users className="shrink-0" /><span className="min-w-0 whitespace-normal"><span className="block font-bold">{t.section} · {t.label}</span><span className="block text-xs">{t.booking?.guest_name} · Table allotted</span></span>
                </Button>
              ))}
            </div>
            {qrBills.length ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="QR bills">
                <span className="text-sm font-semibold text-muted-foreground">QR bills</span>
                {qrBills.map((t) => (
                  <div key={t.qrBill} className="flex items-center gap-2"><Button variant="secondary" asChild>
                    <Link to="/" search={{ bill: t.qrBill ?? "" }} title={`QR bill for ${t.label}: guests' scanned orders, settled separately`}>
                      <QrCode />{t.label}<span className="font-normal text-muted-foreground">{formatINR(t.qrTotal ?? 0, 0)}</span>
                    </Link>
                  </Button>{counterBills.find((o) => o.uid === t.qrBill) ? <BillPrintButton order={counterBills.find((o) => o.uid === t.qrBill) as Order} /> : null}</div>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {tables.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="font-semibold">No tables yet</p>
            {!canEdit ? <p className="mt-1 text-sm text-muted-foreground">Ask the owner or a manager to set up the floor.</p> : null}
          </div>
        ) : null}
        {tables.length > 0 && visibleTables.length === 0 ? <p className="mb-7 text-sm text-muted-foreground">No tables with this status.</p> : null}

        {sections.filter((sec) => visibleTables.some((t) => t.section === sec)).map((sec) => (
          <section key={sec} className="mb-7">
            <h2 className="mb-3 text-base font-bold">{sec}</h2>
            <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {groupTables(visibleTables.filter((t) => t.section === sec).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))).map((g) => g.length > 1 && !editing ? (
                <TableGroup key={g[0]?.id} tables={g} onPick={(t) => (canBill ? openBill(t) : setSelected(t))} />
              ) : g.map((t) => (
                <div key={t.id} className="relative h-full min-w-0">
                <button type="button" aria-label={`Table ${t.label}${t.status === "free" ? "" : `, ${STATUS[t.status].label}`}`}
                  onClick={() => (editing ? setForm(t) : canBill ? openBill(t) : setSelected(t))}
                  className={`relative flex h-full min-h-40 w-full flex-col items-center justify-center rounded-lg border-2 p-3 text-center transition-colors hover:border-primary ${STATUS[t.status].cls}`}>
                  <span className="max-w-full break-words text-base font-extrabold leading-snug">{t.label}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3" />{t.seats}</span>
                  {t.settledAt !== undefined ? <span className="mt-1 text-xs font-semibold leading-relaxed text-success">Settled · <span className="inline-block whitespace-nowrap">{new Date(t.settledAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></span> : null}
                  {t.cancelledAt !== undefined ? <span className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">Last order cancelled by restaurant</span> : null}
                  {t.closedWithoutPaymentAt !== undefined ? <span className="mt-1 text-xs font-semibold leading-relaxed text-muted-foreground">Last bill closed without payment</span> : null}
                  {(t.status === "occupied" || t.status === "billed") && (t.runningTotal > 0 || !t.qrTotal) ? (
                    <span className="mt-1 text-xs font-bold">{formatINR(t.runningTotal, 0)}<span className="block font-normal text-muted-foreground">{minutesSince(t.since)}</span></span>
                  ) : t.status === "reserved" ? <span className="mt-1 text-xs font-semibold text-gold-foreground">Booked</span> : null}
                  {t.booking ? <><span className="mt-1 max-w-full break-words text-sm font-bold text-primary">{t.booking.guest_name}</span><span className="text-xs font-semibold text-success">Table allotted</span><span className="text-xs text-muted-foreground">{new Date(t.booking.arrival_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></> : null}
                  {t.qrTotal ? <span className="mt-0.5 rounded bg-primary/15 px-1.5 text-[10px] font-bold text-primary">QR {formatINR(t.qrTotal, 0)}</span> : null}
                  {holdLabel(t, Date.now()) ? <span className="mt-0.5 max-w-full truncate text-[10px] font-semibold text-primary">{holdLabel(t, Date.now())}</span> : null}
                  {editing ? <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground" /> : null}
                </button>
                {!editing ? (
                  <button type="button" aria-label={`More for table ${t.label}`} title="Move, merge, reserve or free"
                    onClick={() => setSelected(t)} className="absolute right-1 top-1 grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground">
                    <MoreHorizontal className="size-4" />
                  </button>
                ) : null}
                </div>
              )))}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={!!live} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-sm">
          {live ? <>
            <DialogTitle>{placeName(live.label)}</DialogTitle>
            <p className="-mt-2 text-sm text-muted-foreground">{STATUS[live.status].label}{live.status === "occupied" || live.status === "billed" ? `, ${formatINR(live.runningTotal, 0)}, ${minutesSince(live.since)}` : ""}</p>
            <TableActions key={live.id} table={live} tables={tables} onDone={() => setSelected(null)} />
          </> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={form !== null} onOpenChange={(open) => { if (!open) setForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{form === "section" ? "Add section" : form === "new" ? "Add table" : form ? `Edit ${form.label}` : ""}</DialogTitle>
          {form !== null ? (
            <TableForm key={typeof form === "string" ? form : form.id} table={typeof form === "string" ? null : form} sections={sections} newSection={form === "section"}
              taken={tables.map((t) => t.id)} onDone={() => setForm(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** Tables like 2A, 2B … 2F share one tile with a picker, so big floors scroll less. */
function groupTables<T extends RestaurantTable>(list: T[]): T[][] {
  const out: T[][] = [];
  const byPrefix = new Map<string, T[]>();
  for (const t of list) {
    const m = /^(.*?\d+)\s*-?\s*([a-z])$/i.exec(t.label.trim());
    if (!m) { out.push([t]); continue; }
    const key = m[1] ?? "";
    const g = byPrefix.get(key);
    if (g) g.push(t); else { const n = [t]; byPrefix.set(key, n); out.push(n); }
  }
  return out;
}

const RANK: Record<TableStatus, number> = { free: 0, reserved: 1, occupied: 2, billed: 3 };

function TableGroup<T extends RestaurantTable & { runningTotal: number; booking?: import("@/lib/reservations").Reservation }>({ tables, onPick }: { tables: T[]; onPick: (t: T) => void }) {
  const firstTable = tables[0], lastTable = tables[tables.length - 1];
  if (!firstTable || !lastTable) return null;
  const first = firstTable.label, last = lastTable.label;
  const top = tables.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
  const busy = tables.filter((t) => t.status === "occupied" || t.status === "billed");
  const total = busy.reduce((n, t) => n + t.runningTotal, 0);
  return (
    <label className={`relative flex h-full min-h-40 min-w-0 w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 p-3 text-center hover:border-primary focus-within:ring-2 focus-within:ring-ring ${STATUS[top.status].cls}`}>
      <span className="max-w-full break-words text-base font-extrabold leading-snug">{first}–{last.slice(-1)}</span>
      <span className="text-xs leading-relaxed text-muted-foreground">{busy.length}/{tables.length} busy{total ? <span className="inline-block whitespace-nowrap"> · {formatINR(total, 0)}</span> : null}</span>
      {tables.some((t) => t.booking) ? <span className="text-xs font-semibold text-primary">{tables.filter((t) => t.booking).length} booked</span> : null}
      <span className="mt-1 text-[11px] font-semibold text-primary">Choose table ▾</span>
      <select aria-label={`Choose a table from ${first} to ${last}`} value=""
        onChange={(e) => { const t = tables.find((x) => x.id === e.target.value); if (t) onPick(t); }}
        className="absolute inset-0 cursor-pointer opacity-0">
        <option value="" disabled>Choose a table</option>
        {tables.map((t) => <option key={t.id} value={t.id}>{t.label} — {STATUS[t.status].label}{t.booking ? ` · ${new Date(t.booking.arrival_at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}{t.runningTotal ? ` · ${formatINR(t.runningTotal, 0)}` : ""}</option>)}
      </select>
    </label>
  );
}
