import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Download, Search, Star } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getDb } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { formatINR } from "@/lib/billing";
import { customerStats, normalisePhone, ordersByCustomer, type CustomerStats } from "@/lib/customer-logic";
import { adjustPoints, recordDuePayment, updateCustomer } from "@/lib/customer-actions";
import { guestsWorkbook } from "@/lib/report-excel";
import { downloadXlsx } from "@/lib/xlsx";
import type { Customer, Order, PaymentMode } from "@/lib/types";

export const Route = createFileRoute("/customers")({
  head: () => ({
    meta: [
      { title: "Customers — XTSY POS" },
      { name: "description", content: "Guests, visits, loyalty points, dues and feedback from every bill." },
    ],
  }),
  component: CustomersPage,
});

type Filter = "all" | "due" | "points" | "feedback";
const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";

function formatPhone(id: string) {
  return id.length === 10 ? `${id.slice(0, 5)} ${id.slice(5)}` : id;
}

function CustomerDetail({ customer, stats, orders, loyaltyOn, onClose }: { customer: Customer; stats: CustomerStats; orders: Order[]; loyaltyOn: boolean; onClose: () => void }) {
  const { user } = useStaff();
  const admin = !user || isAdmin(user);
  const [name, setName] = useState(customer.name ?? "");
  const [note, setNote] = useState(customer.note ?? "");
  const [amount, setAmount] = useState(stats.due ? String(stats.due) : "");
  const [mode, setMode] = useState<PaymentMode>("cash");
  const [points, setPoints] = useState("");
  const visits = orders.filter((o) => o.status === "settled" && normalisePhone(o.customer?.phone) === customer.id).sort((a, b) => b.createdAt - a.createdAt);

  const saveDetails = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await updateCustomer({ ...customer, ...(name.trim() ? { name: name.trim() } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
    toast.success("Guest details saved");
  };
  const collect = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || value > stats.due) { toast.error(`Enter an amount up to ${formatINR(stats.due)}`); return; }
    await recordDuePayment(customer.id, value, mode, user?.displayName);
    toast.success(`${formatINR(value)} received`);
    onClose();
  };
  const changePoints = async () => {
    const value = Math.round(Number(points));
    if (!Number.isFinite(value) || value === 0) return;
    await adjustPoints(customer.id, value);
    toast.success(value > 0 ? `${value} points added` : `${-value} points removed`);
    setPoints("");
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-border p-2"><div className="text-xs text-muted-foreground">Visits</div><div className="text-lg font-bold">{stats.visits}</div></div>
        <div className="rounded-lg border border-border p-2"><div className="text-xs text-muted-foreground">Spent</div><div className="text-lg font-bold">{formatINR(stats.spent, 0)}</div></div>
        <div className="rounded-lg border border-border p-2"><div className="text-xs text-muted-foreground">{loyaltyOn ? "Points" : "Rating"}</div><div className="text-lg font-bold">{loyaltyOn ? stats.points : stats.averageRating ?? "None"}</div></div>
      </div>

      {stats.due > 0 ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <h3 className="text-sm font-semibold">{formatINR(stats.due)} due</h3>
          <div className="mt-2 flex gap-2">
            <input aria-label="Amount received" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-28 rounded-lg border border-input bg-card px-2 py-2 text-right text-sm" />
            <select aria-label="Paid by" value={mode} onChange={(e) => setMode(e.target.value as PaymentMode)} className="rounded-lg border border-input bg-card px-2 py-2 text-sm">
              <option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option>
            </select>
            <Button onClick={() => void collect()}>Record payment</Button>
          </div>
        </section>
      ) : null}

      <form className="space-y-3" onSubmit={(event) => void saveDetails(event)}>
        <label className="block text-sm font-medium">Name<input maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Note<input maxLength={160} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Allergic to nuts, likes the window table…" className={inputClass} /></label>
        <Button type="submit" variant="secondary">Save details</Button>
      </form>

      {loyaltyOn && admin ? (
        <div className="flex items-end gap-2">
          <label className="block text-sm font-medium">Add or remove points
            <input inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^0-9-]/g, ""))} placeholder="e.g. 50 or -20" className={inputClass} />
          </label>
          <Button variant="outline" onClick={() => void changePoints()}>Apply</Button>
        </div>
      ) : null}

      <section>
        <h3 className="text-sm font-semibold">Visits</h3>
        {visits.length ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {visits.slice(0, 30).map((o) => (
              <li key={o.uid ?? o.billNo} className="px-3 py-2 text-sm">
                <div className="flex justify-between"><span>{new Date(o.createdAt).toLocaleDateString("en-IN")} <span className="text-muted-foreground">{o.billNo}</span></span><span className="font-semibold">{formatINR(o.total, 0)}</span></div>
                <div className="truncate text-xs text-muted-foreground">{o.lines.map((l) => `${l.qty} ${l.name}`).join(", ")}</div>
                {o.feedback ? <div className="mt-0.5 text-xs"><span className="font-semibold text-gold-foreground">{o.feedback.rating}/5</span>{o.feedback.comment ? ` "${o.feedback.comment}"` : ""}</div> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-1 text-sm text-muted-foreground">No settled bills yet.</p>}
      </section>
    </div>
  );
}

function CustomersPage() {
  const settings = useRestaurantSettings();
  const loyaltyPct = settings.loyaltyPct ?? 0;
  const customers = useLiveQuery(() => getDb().customers.toArray(), [], []);
  const orders = useLiveQuery(() => getDb().orders.where("status").equals("settled").toArray(), [], []);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [openId, setOpenId] = useState<string | null>(null);

  // One pass over bills for every guest (not every guest against every bill).
  const rows = useMemo(() => {
    const byGuest = ordersByCustomer(orders);
    return customers.map((c) => ({ customer: c, stats: customerStats(c, byGuest.get(c.id) ?? [], loyaltyPct) }));
  }, [customers, orders, loyaltyPct]);
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, "");
  const shown = rows
    .filter(({ customer }) => !term || (customer.name ?? "").toLowerCase().includes(term) || (digits.length >= 3 && customer.id.includes(digits)))
    .filter(({ stats }) => filter === "all" || (filter === "due" && stats.due > 0) || (filter === "points" && stats.points > 0) || (filter === "feedback" && stats.averageRating !== null))
    .sort((a, b) => (b.stats.lastVisit ?? 0) - (a.stats.lastVisit ?? 0));
  const totalDue = rows.reduce((s, r) => s + r.stats.due, 0);
  const rated = rows.filter((r) => r.stats.averageRating !== null);
  const open = rows.find((r) => r.customer.id === openId) ?? null;

  const filters: { v: Filter; l: string }[] = [
    { v: "all", l: "All" },
    { v: "due", l: "Owe money" },
    ...(loyaltyPct > 0 ? [{ v: "points" as const, l: "Have points" }] : []),
    { v: "feedback", l: "Gave feedback" },
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Guests</h1>
          <Button variant="outline" size="sm" disabled={!rows.length} onClick={() => downloadXlsx(`guests-${new Date().toISOString().slice(0, 10)}`, guestsWorkbook(rows, settings.name), { title: "Guests" })}><Download />Excel</Button>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {rows.length} guests{totalDue > 0 ? `, ${formatINR(totalDue, 0)} owed to you` : ""}
          {rated.length ? `, rated ${(rated.reduce((s, r) => s + (r.stats.averageRating ?? 0), 0) / rated.length).toFixed(1)} on average` : ""}.
          {loyaltyPct > 0 ? ` Guests earn ${loyaltyPct}% back as points.` : ""}
        </p>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or phone" className="w-full rounded-lg border border-input bg-card py-2.5 pl-9 pr-3 text-sm" />
          </div>
          <div className="flex gap-1.5">
            {filters.map((f) => (
              <button key={f.v} onClick={() => setFilter(f.v)} className={`rounded-full px-3 py-1.5 text-xs font-semibold ${filter === f.v ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{f.l}</button>
            ))}
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="font-semibold">No guests yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a guest's phone number on a bill and they appear here, with their visits and points.</p>
          </div>
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {shown.map(({ customer, stats }) => (
              <li key={customer.id}>
                <button type="button" onClick={() => setOpenId(customer.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-secondary/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{customer.name || "Guest"} <span className="font-normal text-muted-foreground">{formatPhone(customer.id)}</span></div>
                    <div className="text-xs text-muted-foreground">
                      {stats.visits} visit{stats.visits === 1 ? "" : "s"}, {formatINR(stats.spent, 0)} spent
                      {stats.lastVisit ? `, last ${new Date(stats.lastVisit).toLocaleDateString("en-IN")}` : ""}
                    </div>
                  </div>
                  {stats.averageRating !== null ? <span className="flex items-center gap-0.5 text-xs font-semibold"><Star className="size-3.5 fill-gold text-gold" />{stats.averageRating}</span> : null}
                  {loyaltyPct > 0 && stats.points > 0 ? <span className="rounded bg-primary-tint px-1.5 py-0.5 text-xs font-semibold">{stats.points} pts</span> : null}
                  {stats.due > 0 ? <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-semibold text-destructive">{formatINR(stats.due, 0)} due</span> : null}
                </button>
              </li>
            ))}
            {shown.length === 0 ? <li className="px-4 py-8 text-center text-sm text-muted-foreground">No guests match.</li> : null}
          </ul>
        )}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          {open ? <>
            <DialogTitle>{open.customer.name || "Guest"}, {formatPhone(open.customer.id)}</DialogTitle>
            <CustomerDetail key={open.customer.id} customer={open.customer} stats={open.stats} orders={orders} loyaltyOn={loyaltyPct > 0} onClose={() => setOpenId(null)} />
          </> : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
