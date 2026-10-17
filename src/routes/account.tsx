import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, Copy, MapPin, Plus, Send, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useStaff } from "@/lib/auth-context";
import { useAccount, type AccountView } from "@/lib/use-account";
import { FEATURE_LABELS, STATUS_LABELS, accountState, canAddOutlet, type PlanFeature } from "@/lib/saas-logic";
import { createOutlet, outletSales, prepareOutletSwitch, pushMenu, type OutletDay } from "@/lib/outlet-actions";
import { formatINR } from "@/lib/billing";
import { gstinError, emailError } from "@/lib/validation";
import { Segmented } from "@/components/Segmented";

export const Route = createFileRoute("/account")({
  head: () => ({ meta: [{ title: "Business — XTSY POS" }, { name: "description", content: "Your plan, outlets and sales across outlets." }] }),
  component: AccountPage,
});

/** Where plan changes and renewals go until online subscription payments are switched on. */
const SALES_EMAIL = "admin@xtsy.one";
const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm disabled:bg-secondary";

function Card({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-base font-bold">{title}</h2>{description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}</div>
        {action}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function AccountPage() {
  const query = useAccount();
  const view = query.data;
  return (
    <AppShell>
      <div className="mx-auto max-w-6xl space-y-5 p-4 lg:p-8">
        <div>
          <h1 className="text-2xl font-bold">Business</h1>
          <p className="text-sm text-muted-foreground">Your XTSY POS plan, your outlets and how they're doing together.</p>
        </div>
        {query.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p>
          : !view ? <p className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">This page needs an internet connection and a signed-in owner or manager.</p>
          : <>
            <OutletSales view={view} />
            <div className="grid gap-5 lg:grid-cols-2">
              <Outlets view={view} />
              <PlanCard view={view} />
            </div>
            <PushMenu view={view} />
            <BillingDetails view={view} />
          </>}
      </div>
    </AppShell>
  );
}

/* ---------------- plan ---------------- */

function PlanCard({ view }: { view: AccountView }) {
  const { account, plan, plans } = view;
  const state = accountState(account);
  const features = Object.keys(FEATURE_LABELS) as PlanFeature[];
  const paid = plans.filter((p) => p.active && p.id !== "trial");
  const ask = (planName: string) => `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`XTSY POS: ${account?.name ?? view.outlet.name} → ${planName}`)}&body=${encodeURIComponent(`Account: ${account?.name ?? ""}\nAccount id: ${account?.id ?? ""}\nPlan wanted: ${planName}\nOutlets: ${view.outlets.length}\n`)}`;
  return (
    <Card title="Plan" description={account ? `${STATUS_LABELS[account.status]} · ${state.label}` : "No plan on this outlet"}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-2xl font-extrabold">{plan?.name ?? "—"}</p>
        <p className="text-sm text-muted-foreground">{view.outlets.length} of {plan?.max_outlets ?? 1} outlet{(plan?.max_outlets ?? 1) === 1 ? "" : "s"} · up to {plan?.max_staff ?? 5} staff</p>
      </div>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {features.map((f) => {
          const on = Boolean(plan?.features[f]);
          return <li key={f} className={`flex items-center gap-2 text-sm ${on ? "" : "text-muted-foreground line-through"}`}>{on ? <Check className="size-4 text-success" /> : <X className="size-4" />}{FEATURE_LABELS[f]}</li>;
        })}
      </ul>
      {!state.live ? <p className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Billing keeps working. Guest ordering and new outlets pause until you renew.</p> : null}
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {paid.map((p) => {
          const current = p.id === plan?.id;
          return (
            <div key={p.id} className={`rounded-xl border p-3 ${current ? "border-primary bg-primary-tint" : "border-border"}`}>
              <p className="font-bold">{p.name}</p>
              <p className="text-lg font-extrabold">{formatINR(p.monthly_price, 0)}<span className="text-xs font-medium text-muted-foreground"> /outlet/month</span></p>
              <p className="text-xs text-muted-foreground">or {formatINR(p.yearly_price, 0)} a year · plus GST</p>
              <p className="mt-1 text-xs">{p.max_outlets} outlet{p.max_outlets === 1 ? "" : "s"}, {p.max_staff} staff{p.features.qr_ordering ? ", QR + online orders" : ""}</p>
              {current ? <p className="mt-2 text-xs font-semibold text-primary">Your plan</p>
                : <a href={ask(p.name)} className="mt-2 inline-block text-xs font-semibold text-primary">Ask to switch</a>}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">To renew or change plan, write to {SALES_EMAIL}. Your plan updates as soon as the payment is confirmed.</p>
    </Card>
  );
}

/* ---------------- outlets ---------------- */

function Outlets({ view }: { view: AccountView }) {
  const { user, switchRestaurant, refresh } = useStaff();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [copy, setCopy] = useState(true);
  const [busy, setBusy] = useState(false);
  const memberOf = new Set(user?.memberships.map((m) => m.restaurantId));
  const roomForMore = canAddOutlet(view.plan, view.outlets.length) && accountState(view.account).live;
  const owner = user?.role === "owner";

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!view.account || !name.trim()) return;
    setBusy(true);
    try {
      await createOutlet(view.account.id, name.trim(), city.trim(), copy ? view.outlet.id : null);
      toast.success(`${name.trim()} added${copy ? " with this outlet's menu, stock items and details" : ""}`);
      setAdding(false); setName(""); setCity("");
      await refresh();
      void queryClient.invalidateQueries({ queryKey: ["account"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the outlet");
    } finally { setBusy(false); }
  };
  const switchTo = async (id: string) => {
    const problem = await prepareOutletSwitch(id);
    if (problem) { toast.error(problem); return; }
    switchRestaurant(id);
    toast.success("This device now works for that outlet");
  };

  return (
    <Card title="Outlets" description="Each outlet keeps its own prices, tables, stock and bills."
      action={owner && view.account ? <Button size="sm" variant="outline" disabled={!roomForMore} onClick={() => setAdding(true)} title={roomForMore ? undefined : "Upgrade your plan to add outlets"}><Plus />Add outlet</Button> : undefined}>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {view.outlets.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Building2 className="size-5 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{o.name}{o.id === view.outlet.id ? <span className="ml-2 rounded bg-primary-tint px-1.5 py-0.5 text-[11px] font-semibold text-primary">This device</span> : null}</p>
              <p className="truncate text-xs text-muted-foreground">{o.city ? <><MapPin className="mr-0.5 inline size-3" />{o.city} · </> : null}/order/{o.slug}</p>
            </div>
            {o.id !== view.outlet.id && memberOf.has(o.id) ? <Button size="sm" variant="ghost" onClick={() => void switchTo(o.id)}>Use on this device</Button> : null}
          </li>
        ))}
      </ul>
      {!roomForMore && owner ? <p className="mt-2 text-xs text-muted-foreground">Your plan has room for {view.plan?.max_outlets ?? 1} outlet{(view.plan?.max_outlets ?? 1) === 1 ? "" : "s"}. The Chain plan runs up to 5.</p> : null}
      {adding ? (
        <form className="mt-4 space-y-3 rounded-xl bg-secondary/60 p-4" onSubmit={(e) => void add(e)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Outlet name<input required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="TAB Bistro Police Bazar" className={inputClass} /></label>
            <label className="block text-sm font-medium">City or area<input maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Shillong" className={inputClass} /></label>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={copy} onChange={(e) => setCopy(e.target.checked)} />
            <span>Start with {view.outlet.name}'s menu, stock items, suppliers and bill details<span className="block text-xs text-muted-foreground">Tables, bills and stock levels start empty.</span></span></label>
          <p className="text-xs text-muted-foreground">Give the new outlet's counters their own bill codes (e.g. P1, P2) in Settings → This device.</p>
          <div className="flex gap-2"><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Adding…" : "Add outlet"}</Button><Button type="button" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      ) : null}
    </Card>
  );
}

function PushMenu({ view }: { view: AccountView }) {
  const { user } = useStaff();
  const others = view.outlets.filter((o) => o.id !== view.outlet.id && user?.memberships.some((m) => m.restaurantId === o.id && (m.role === "owner" || m.role === "manager")));
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!others.length || !(user?.role === "owner" || user?.role === "manager")) return null;
  const push = async () => {
    if (!window.confirm(`Send ${view.outlet.name}'s menu to ${picked.length} outlet${picked.length === 1 ? "" : "s"}? Dishes with the same name and id are replaced there, including prices and availability.`)) return;
    setBusy(true);
    try {
      const n = await pushMenu(view.outlet.id, picked);
      toast.success(`Menu sent: ${n} dishes and stock items updated. Their devices pick it up within seconds.`);
      setPicked([]);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't send the menu"); } finally { setBusy(false); }
  };
  return (
    <Card title="Send this menu to other outlets" description={`Copies ${view.outlet.name}'s dishes, portions, add-ons, recipes and stock items. Dishes that exist only at the other outlet stay.`}>
      <div className="flex flex-wrap gap-2">
        {others.map((o) => {
          const on = picked.includes(o.id);
          return <button key={o.id} type="button" aria-pressed={on} onClick={() => setPicked((p) => (on ? p.filter((x) => x !== o.id) : [...p, o.id]))}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${on ? "border-primary bg-primary-tint text-primary" : "border-border"}`}>{on ? <Check className="mr-1 inline size-3.5" /> : null}{o.name}</button>;
        })}
      </div>
      <Button className="mt-3" disabled={!picked.length || busy} onClick={() => void push()}><Copy />{busy ? "Sending…" : "Send menu"}</Button>
    </Card>
  );
}

/* ---------------- sales across outlets ---------------- */

const RANGES = [{ v: 1, l: "Today" }, { v: 7, l: "7 days" }, { v: 30, l: "30 days" }] as const;

function OutletSales({ view }: { view: AccountView }) {
  const { user } = useStaff();
  const [days, setDays] = useState<number>(7);
  const outlets = useMemo(() => view.outlets.filter((o) => user?.memberships.some((m) => m.restaurantId === o.id)), [view.outlets, user?.memberships]);
  const ids = outlets.map((o) => o.id);
  const range = useMemo(() => {
    const to = new Date(); to.setHours(24, 0, 0, 0);
    const from = new Date(to.getTime() - days * 86_400_000);
    return { from, to };
  }, [days]);
  const sales = useQuery({
    queryKey: ["outlet-sales", ids.join(","), days],
    enabled: ids.length > 0,
    queryFn: () => outletSales(ids, range.from, range.to),
    refetchInterval: 60_000,
  });
  const rows = sales.data ?? [];
  const total = (pick: (r: OutletDay) => number, list = rows) => list.reduce((s, r) => s + pick(r), 0);
  const net = total((r) => r.net);
  const bills = total((r) => r.bills);
  const guest = total((r) => r.guest_ordered);
  const byOutlet = outlets.map((o) => {
    const mine = rows.filter((r) => r.restaurant_id === o.id);
    return { o, net: total((r) => r.net, mine), bills: total((r) => r.bills, mine), dine: total((r) => r.dine_in, mine), take: total((r) => r.takeaway + r.delivery, mine), agg: total((r) => r.aggregator, mine), guest: total((r) => r.guest_ordered, mine) };
  }).sort((a, b) => b.net - a.net);
  const best = Math.max(1, ...byOutlet.map((x) => x.net));
  const dayTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.day, (map.get(r.day) ?? 0) + r.net);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);
  const bestDay = Math.max(1, ...dayTotals.map(([, v]) => v));

  return (
    <Card title={outlets.length > 1 ? "All outlets" : "Sales"} description={`Settled bills from the cloud, ${outlets.length} outlet${outlets.length === 1 ? "" : "s"}. Bills still on a device appear once it syncs.`}
      action={<Segmented<number> ariaLabel="Period" size="sm" value={days} onChange={setDays} options={RANGES.map((r) => ({ value: r.v, label: r.l }))} />}>
      {sales.isError ? <p className="text-sm text-destructive">Couldn't load sales. Check the internet connection.</p> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Net sales", formatINR(net, 0)], ["Bills", bills.toLocaleString("en-IN")], ["Average bill", formatINR(bills ? net / bills : 0, 0)], ["Ordered by guests", net ? `${Math.round((guest / net) * 100)}%` : "0%"]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-border p-3"><p className="text-xs text-muted-foreground">{l}</p><p className="mt-1 text-2xl font-extrabold tabular-nums">{sales.isLoading ? "…" : v}</p></div>
        ))}
      </div>
      {days > 1 && dayTotals.length ? (
        <div className="mt-5">
          <p className="text-xs font-semibold text-muted-foreground">Net sales by day</p>
          <div className="mt-2 flex h-28 items-end gap-1" role="img" aria-label="Net sales by day">
            {dayTotals.map(([d, v]) => (
              <div key={d} className="group relative flex-1">
                <div className="rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(2, (v / bestDay) * 100)}%` }} />
                <span className="pointer-events-none absolute -top-6 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] text-background group-hover:block">{d.slice(8)}/{d.slice(5, 7)} {formatINR(v, 0)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {outlets.length > 1 ? (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-2 font-semibold">Outlet</th><th className="py-2 text-right font-semibold">Bills</th><th className="py-2 text-right font-semibold">Avg bill</th><th className="py-2 text-right font-semibold">Dine-in</th><th className="py-2 text-right font-semibold">Takeaway</th><th className="py-2 text-right font-semibold">Swiggy/Zomato</th><th className="w-44 py-2 text-right font-semibold">Net</th></tr></thead>
            <tbody className="divide-y divide-border">
              {byOutlet.map((x) => (
                <tr key={x.o.id}>
                  <td className="py-2.5 font-semibold">{x.o.name}</td>
                  <td className="py-2.5 text-right tabular-nums">{x.bills}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(x.bills ? x.net / x.bills : 0, 0)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(x.dine, 0)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(x.take, 0)}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(x.agg, 0)}</td>
                  <td className="py-2.5"><div className="flex items-center justify-end gap-2"><div className="h-2 flex-1 rounded-full bg-secondary"><div className="h-2 rounded-full bg-primary" style={{ width: `${(x.net / best) * 100}%` }} /></div><span className="w-20 text-right font-bold tabular-nums">{formatINR(x.net, 0)}</span></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </Card>
  );
}

/* ---------------- billing details ---------------- */

function BillingDetails({ view }: { view: AccountView }) {
  const { user } = useStaff();
  const queryClient = useQueryClient();
  const account = view.account;
  const [form, setForm] = useState({ name: "", email: "", phone: "", gstin: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (account) setForm({ name: account.name, email: account.billing_email, phone: account.billing_phone, gstin: account.billing_gstin });
  }, [account]);
  if (!account || user?.role !== "owner") return null;
  const errors = { email: form.email ? emailError(form.email) : "", gstin: form.gstin ? gstinError(form.gstin) : "" };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (errors.email || errors.gstin) return;
    setBusy(true);
    const { error } = await supabase.rpc("update_account_billing", { _account: account.id, _name: form.name, _email: form.email, _phone: form.phone, _gstin: form.gstin });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success("Billing details saved"); void queryClient.invalidateQueries({ queryKey: ["account"] }); }
  };
  return (
    <Card title="Subscription billing details" description="Who we invoice for your plan. Guest-bill GST details are in Settings.">
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => void save(e)}>
        <label className="block text-sm font-medium">Business name<input required maxLength={160} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></label>
        <label className="block text-sm font-medium">GSTIN for invoices<input maxLength={15} value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} className={`${inputClass} uppercase`} />{errors.gstin ? <span className="mt-1 block text-xs text-destructive">{errors.gstin}</span> : null}</label>
        <label className="block text-sm font-medium">Billing email<input type="email" maxLength={160} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />{errors.email ? <span className="mt-1 block text-xs text-destructive">{errors.email}</span> : null}</label>
        <label className="block text-sm font-medium">Phone<input type="tel" maxLength={20} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} /></label>
        <div className="sm:col-span-2"><Button type="submit" disabled={busy}><Send />{busy ? "Saving…" : "Save billing details"}</Button></div>
      </form>
    </Card>
  );
}
