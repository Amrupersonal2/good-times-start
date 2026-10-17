import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IndianRupee, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAdmin } from "@/lib/use-account";
import { FEATURE_LABELS, STATUS_LABELS, monthlyRevenue, type AccountStatus, type Plan, type PlanFeature } from "@/lib/saas-logic";
import { formatINR } from "@/lib/billing";
import { Dropdown } from "@/components/Dropdown";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — XTSY POS" }, { name: "robots", content: "noindex" }] }),
  component: AdminPage,
});

interface AdminAccount {
  id: string; name: string; planId: string; status: AccountStatus; trialEndsAt: string | null; paidUntil: string | null;
  billingEmail: string; billingPhone: string; billingGstin: string; notes: string; createdAt: string; live: boolean;
  ownerEmail: string | null; outlets: { id: string; name: string; slug: string | null; city: string }[];
  staff: number; lastActivity: string | null; bills30d: number;
}

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm";
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fromDate = (d: string) => (d ? new Date(`${d}T23:59:59+05:30`).toISOString() : null);
const shortDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit" }) : "—");
const STATUS_TONE: Record<AccountStatus, string> = {
  trialing: "bg-gold/20 text-gold-foreground", active: "bg-primary-tint text-primary", past_due: "bg-destructive/10 text-destructive",
  suspended: "bg-destructive/10 text-destructive", cancelled: "bg-secondary text-muted-foreground",
};

function AdminPage() {
  const admin = usePlatformAdmin();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ["admin-accounts"],
    enabled: admin.data === true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_accounts");
      if (error) throw error;
      return (data ?? []) as unknown as AdminAccount[];
    },
  });
  const plans = useQuery({
    queryKey: ["admin-plans"],
    enabled: admin.data === true,
    queryFn: async () => ((await supabase.from("plans").select("*").order("sort")).data ?? []) as unknown as Plan[],
  });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | AccountStatus>("all");
  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [planEdit, setPlanEdit] = useState<Plan | null>(null);
  const list: AdminAccount[] = accounts.data ?? [];
  const planList: Plan[] = plans.data ?? [];
  const shown = useMemo(() => list.filter((a) => (filter === "all" || a.status === filter) &&
    (!q || [a.name, a.ownerEmail ?? "", a.billingEmail, ...a.outlets.map((o) => `${o.name} ${o.city} ${o.slug}`)].join(" ").toLowerCase().includes(q.toLowerCase()))), [list, filter, q]);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ["admin-accounts"] }); void queryClient.invalidateQueries({ queryKey: ["admin-plans"] }); };

  if (admin.isLoading) return <AppShell><p className="p-8 text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (admin.data !== true) return <AppShell><p className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">This console is for XTSY POS administrators.</p></AppShell>;

  const soon = Date.now() + 7 * 86_400_000;
  const kpis: [string, string][] = [
    ["Accounts", String(list.length)],
    ["Outlets", String(list.reduce((n, a) => n + a.outlets.length, 0))],
    ["Trials ending in 7 days", String(list.filter((a) => a.status === "trialing" && a.trialEndsAt && Date.parse(a.trialEndsAt) < soon && Date.parse(a.trialEndsAt) > Date.now()).length)],
    ["Monthly revenue", formatINR(monthlyRevenue(list, planList), 0)],
  ];

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-8">
        <div className="flex items-center gap-2"><ShieldCheck className="size-6 text-primary" /><h1 className="text-2xl font-bold">XTSY POS admin</h1></div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map(([l, v]) => <div key={l} className="rounded-xl border border-border bg-card p-4"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{accounts.isLoading ? "…" : v}</p></div>)}
        </div>

        <section className="rounded-2xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-60 flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search restaurant, email, city" className="w-full rounded-lg border border-input bg-background py-2 pl-9 pr-3 text-sm" /></div>
            <Dropdown<"all" | AccountStatus> ariaLabel="Status" className="w-44" value={filter} onChange={setFilter}
              options={[{ value: "all", label: "All statuses" }, ...(Object.keys(STATUS_LABELS) as AccountStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))]} />
          </div>
          {accounts.isError ? <p className="mt-3 text-sm text-destructive">{accounts.error instanceof Error ? accounts.error.message : "Couldn't load accounts"}</p> : null}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th className="py-2 font-semibold">Account</th><th className="py-2 font-semibold">Plan</th><th className="py-2 font-semibold">Status</th><th className="py-2 font-semibold">Trial / paid until</th>
                <th className="py-2 text-right font-semibold">Outlets</th><th className="py-2 text-right font-semibold">Staff</th><th className="py-2 text-right font-semibold">Bills 30d</th><th className="py-2 font-semibold">Last active</th><th />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {shown.map((a) => (
                  <tr key={a.id} className={a.live ? "" : "opacity-70"}>
                    <td className="py-2.5"><p className="font-semibold">{a.name}</p><p className="text-xs text-muted-foreground">{a.ownerEmail ?? a.billingEmail}{a.outlets[0]?.city ? ` · ${a.outlets[0].city}` : ""}</p></td>
                    <td className="py-2.5">{planList.find((p) => p.id === a.planId)?.name ?? a.planId}</td>
                    <td className="py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[a.status]}`}>{STATUS_LABELS[a.status]}</span>{!a.live ? <span className="ml-1 text-xs text-destructive">ended</span> : null}</td>
                    <td className="py-2.5 tabular-nums">{a.status === "trialing" ? shortDate(a.trialEndsAt) : a.paidUntil ? shortDate(a.paidUntil) : "Complimentary"}</td>
                    <td className="py-2.5 text-right tabular-nums">{a.outlets.length}</td>
                    <td className="py-2.5 text-right tabular-nums">{a.staff}</td>
                    <td className="py-2.5 text-right tabular-nums">{a.bills30d}</td>
                    <td className="py-2.5 tabular-nums">{shortDate(a.lastActivity)}</td>
                    <td className="py-2.5 text-right"><Button size="sm" variant="outline" onClick={() => setEditing(a)}>Manage</Button></td>
                  </tr>
                ))}
                {!shown.length && !accounts.isLoading ? <tr><td colSpan={9} className="py-8 text-center text-muted-foreground">No accounts match.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="text-base font-bold">Plans</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {planList.map((p) => (
              <button key={p.id} type="button" onClick={() => setPlanEdit(p)} className={`rounded-xl border p-3 text-left hover:border-primary ${p.active ? "border-border" : "border-dashed border-border opacity-60"}`}>
                <p className="font-bold">{p.name} <span className="text-xs font-normal text-muted-foreground">({p.id})</span></p>
                <p className="text-sm">{formatINR(p.monthly_price, 0)}/mo · {formatINR(p.yearly_price, 0)}/yr</p>
                <p className="text-xs text-muted-foreground">{p.max_outlets} outlets · {p.max_staff} staff</p>
                <p className="mt-1 text-xs">{(Object.keys(FEATURE_LABELS) as PlanFeature[]).filter((f) => p.features[f]).map((f) => FEATURE_LABELS[f]).join(", ") || "Billing only"}</p>
              </button>
            ))}
          </div>
        </section>
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
          {editing ? <ManageAccount key={editing.id} account={editing} plans={planList} onSaved={() => { setEditing(null); refresh(); }} /> : null}
        </DialogContent>
      </Dialog>
      <Dialog open={!!planEdit} onOpenChange={(o) => { if (!o) setPlanEdit(null); }}>
        <DialogContent className="max-w-md">
          {planEdit ? <EditPlan key={planEdit.id} plan={planEdit} onSaved={() => { setPlanEdit(null); refresh(); }} /> : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ManageAccount({ account, plans, onSaved }: { account: AdminAccount; plans: Plan[]; onSaved: () => void }) {
  const [plan, setPlan] = useState(account.planId);
  const [status, setStatus] = useState<AccountStatus>(account.status);
  const [trial, setTrial] = useState(dateOnly(account.trialEndsAt));
  const [paid, setPaid] = useState(dateOnly(account.paidUntil));
  const [notes, setNotes] = useState(account.notes);
  const [amount, setAmount] = useState("");
  const [months, setMonths] = useState(1);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_update_account", { _id: account.id, _plan: plan, _status: status, _trial_ends_at: fromDate(trial), _paid_until: fromDate(paid), _notes: notes });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(`${account.name} updated`); onSaved(); }
  };
  const recordPayment = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_record_payment", { _id: account.id, _amount: Number(amount) || 0, _months: months, _reference: reference });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(`Payment recorded. Paid until ${shortDate(data as string)}`); onSaved(); }
  };

  return (
    <div>
      <DialogTitle>{account.name}</DialogTitle>
      <p className="text-sm text-muted-foreground">{account.outlets.map((o) => o.name).join(", ")}</p>
      <p className="mt-1 text-xs text-muted-foreground">Owner {account.ownerEmail ?? "—"} · Joined {shortDate(account.createdAt)}{account.billingGstin ? ` · GSTIN ${account.billingGstin}` : ""}{account.billingPhone ? ` · ${account.billingPhone}` : ""}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium">Plan<Dropdown ariaLabel="Plan" className="mt-1" value={plan} onChange={setPlan} options={plans.map((p) => ({ value: p.id, label: p.name }))} /></label>
        <label className="block text-sm font-medium">Status<Dropdown<AccountStatus> ariaLabel="Status" className="mt-1" value={status} onChange={setStatus} options={(Object.keys(STATUS_LABELS) as AccountStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] }))} /></label>
        <label className="block text-sm font-medium">Trial ends<input type="date" value={trial} onChange={(e) => setTrial(e.target.value)} className={inputClass} /></label>
        <label className="block text-sm font-medium">Paid until<input type="date" value={paid} onChange={(e) => setPaid(e.target.value)} className={inputClass} /><span className="mt-1 block text-xs font-normal text-muted-foreground">Empty with Active = complimentary</span></label>
        <label className="block text-sm font-medium sm:col-span-2">Notes<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></label>
      </div>
      <Button className="mt-3" disabled={busy} onClick={() => void save()}>Save changes</Button>

      <div className="mt-6 border-t border-border pt-4">
        <p className="flex items-center gap-1.5 text-sm font-bold"><IndianRupee className="size-4" />Record a payment</p>
        <p className="text-xs text-muted-foreground">For bank transfer or UPI received outside the app. Sets the account Active and extends the paid period.</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          <input inputMode="decimal" placeholder="Amount ₹" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} className="rounded-lg border border-input bg-card px-3 py-2 text-sm" />
          <Dropdown<number> ariaLabel="Months" value={months} onChange={setMonths} options={[1, 3, 6, 12, 24].map((m) => ({ value: m, label: `${m} month${m === 1 ? "" : "s"}` }))} />
          <input placeholder="Reference" value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className="rounded-lg border border-input bg-card px-3 py-2 text-sm" />
        </div>
        <Button className="mt-2" variant="secondary" disabled={busy || !amount} onClick={() => void recordPayment()}>Record payment</Button>
      </div>
    </div>
  );
}

function EditPlan({ plan, onSaved }: { plan: Plan; onSaved: () => void }) {
  const [form, setForm] = useState(plan);
  const [busy, setBusy] = useState(false);
  const num = (key: "monthly_price" | "yearly_price" | "max_outlets" | "max_staff") => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: Number(e.target.value.replace(/[^0-9]/g, "")) || 0 }));
  const save = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("admin_save_plan", { _id: form.id, _name: form.name, _monthly: form.monthly_price, _yearly: form.yearly_price, _max_outlets: Math.max(1, form.max_outlets), _max_staff: Math.max(1, form.max_staff), _features: form.features as never, _active: form.active });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Plan saved"); onSaved(); }
  };
  return (
    <div>
      <DialogTitle>Plan: {plan.id}</DialogTitle>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm font-medium sm:col-span-2">Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></label>
        <label className="block text-sm font-medium">Monthly ₹ per outlet<input inputMode="numeric" value={form.monthly_price} onChange={num("monthly_price")} className={inputClass} /></label>
        <label className="block text-sm font-medium">Yearly ₹ per outlet<input inputMode="numeric" value={form.yearly_price} onChange={num("yearly_price")} className={inputClass} /></label>
        <label className="block text-sm font-medium">Outlets<input inputMode="numeric" value={form.max_outlets} onChange={num("max_outlets")} className={inputClass} /></label>
        <label className="block text-sm font-medium">Staff logins<input inputMode="numeric" value={form.max_staff} onChange={num("max_staff")} className={inputClass} /></label>
      </div>
      <div className="mt-3 space-y-1.5">
        {(Object.keys(FEATURE_LABELS) as PlanFeature[]).map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!form.features[f]} onChange={(e) => setForm({ ...form, features: { ...form.features, [f]: e.target.checked } })} />{FEATURE_LABELS[f]}</label>
        ))}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Offered to restaurants</label>
      </div>
      <Button className="mt-4" disabled={busy || !form.name.trim()} onClick={() => void save()}>Save plan</Button>
    </div>
  );
}
