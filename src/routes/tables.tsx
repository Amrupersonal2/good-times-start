import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowRightLeft, Combine, Pencil, Plus, ReceiptText, Trash2, Users } from "lucide-react";
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

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [
      { title: "Tables — XTSY POS" },
      { name: "description", content: "Live floor plan: open bills, move or merge tables, and arrange sections." },
    ],
  }),
  component: TablesPage,
});

const STATUS: Record<TableStatus, { label: string; cls: string }> = {
  free: { label: "Free", cls: "border-border bg-card" },
  occupied: { label: "Occupied", cls: "border-primary bg-primary-tint" },
  billed: { label: "Bill printed", cls: "border-gold bg-gold/15" },
  reserved: { label: "Reserved", cls: "border-dashed border-gold bg-card" },
};
const DEFAULT_SECTIONS = ["AC", "Non-AC", "Rooftop"];

function minutesSince(since?: number) {
  if (!since) return "";
  const m = Math.max(0, Math.round((Date.now() - since) / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

function TableForm({ table, sections, taken, onDone }: { table: RestaurantTable | null; sections: string[]; taken: string[]; onDone: () => void }) {
  const [label, setLabel] = useState(table?.label ?? "");
  const [section, setSection] = useState(table?.section ?? sections[0] ?? "AC");
  const [seats, setSeats] = useState(String(table?.seats ?? 4));
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const n = Number(seats);
    if (!label.trim()) { setError("Enter a table name, like T7."); return; }
    if (!section.trim()) { setError("Enter a section, like AC or Rooftop."); return; }
    if (!Number.isInteger(n) || n < 1 || n > 50) { setError("Seats must be between 1 and 50."); return; }
    await saveTable({ id: table?.id ?? tableIdFor(label, taken), label: label.trim().slice(0, 12), section: section.trim().slice(0, 30), seats: n });
    toast.success(table ? `${label.trim()} updated` : `${label.trim()} added`);
    onDone();
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
        <label className="col-span-1 block text-sm font-medium">Name
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
        <Button type="submit">{table ? "Save table" : "Add table"}</Button>
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
      <Button className="justify-start" onClick={() => { onDone(); void navigate({ to: "/", search: { table: table.id } }); }}><ReceiptText />{busy ? "Open running bill" : "Start a bill"}</Button>
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
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const { user } = useStaff();
  const canEdit = can(user, "tables.edit");
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<RestaurantTable | null>(null);
  const [form, setForm] = useState<RestaurantTable | "new" | null>(null);
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
  const counts = (["free", "occupied", "billed", "reserved"] as TableStatus[]).map((s) => [s, tables.filter((t) => t.status === s).length] as const);

  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Floor</h1>
            <p className="text-sm text-muted-foreground">
              {counts.filter(([, n]) => n > 0).map(([s, n]) => `${n} ${STATUS[s].label.toLowerCase()}`).join(", ") || "No tables yet"}
            </p>
          </div>
          {canEdit ? (
            <div className="flex gap-2">
              {editing ? <Button variant="outline" onClick={() => setForm("new")}><Plus />Add table</Button> : null}
              <Button variant={editing ? "default" : "outline"} onClick={() => setEditing(!editing)}><Pencil />{editing ? "Done" : "Edit floor"}</Button>
            </div>
          ) : null}
        </div>

        {tables.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="font-semibold">No tables yet</p>
            <p className="mt-1 text-sm text-muted-foreground">{canEdit ? "Choose Edit floor, then Add table. Takeaway and delivery bills work without tables." : "Ask the owner or a manager to set up the floor."}</p>
          </div>
        ) : null}

        {sections.map((sec) => (
          <section key={sec} className="mb-7">
            <h2 className="mb-3 text-base font-bold">{sec}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6 2xl:grid-cols-8">
              {tables.filter((t) => t.section === sec).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((t) => (
                <button key={t.id} type="button" onClick={() => (editing ? setForm(t) : setSelected(t))}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded-xl border-2 p-2 text-center transition-colors hover:border-primary ${STATUS[t.status].cls}`}>
                  <span className="text-2xl font-extrabold">{t.label}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3" />{t.seats}</span>
                  {t.status === "occupied" || t.status === "billed" ? (
                    <span className="mt-1 text-xs font-bold">{formatINR(t.runningTotal, 0)}<span className="block font-normal text-muted-foreground">{minutesSince(t.since)}</span></span>
                  ) : t.status === "reserved" ? <span className="mt-1 text-xs font-semibold text-gold-foreground">Reserved</span> : null}
                  {editing ? <Pencil className="absolute right-2 top-2 size-3.5 text-muted-foreground" /> : null}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      <Dialog open={!!live} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-w-sm">
          {live ? <>
            <DialogTitle>Table {live.label}</DialogTitle>
            <p className="-mt-2 text-sm text-muted-foreground">{STATUS[live.status].label}{live.status === "occupied" || live.status === "billed" ? `, ${formatINR(live.runningTotal, 0)}, ${minutesSince(live.since)}` : ""}</p>
            <TableActions key={live.id} table={live} tables={tables} onDone={() => setSelected(null)} />
          </> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={form !== null} onOpenChange={(open) => { if (!open) setForm(null); }}>
        <DialogContent className="max-w-md">
          <DialogTitle>{form === "new" ? "Add table" : form ? `Edit ${form.label}` : ""}</DialogTitle>
          {form !== null ? (
            <TableForm key={form === "new" ? "new" : form.id} table={form === "new" ? null : form} sections={sections.length ? sections : DEFAULT_SECTIONS}
              taken={tables.map((t) => t.id)} onDone={() => setForm(null)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
