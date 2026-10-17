import { useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Ban, BadgePercent, Clock, Gift, HandCoins, IndianRupee, Package, Receipt, ShoppingBag, Smartphone, Store, UtensilsCrossed, XCircle } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { Dropdown } from "@/components/Dropdown";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { useAccount, type AccountView } from "@/lib/use-account";
import { accountState, STATUS_LABELS } from "@/lib/saas-logic";
import { PRESET_LABELS, businessOverview, dashboardRange, liveStatus, salesByDay, type Preset } from "@/lib/dashboard-logic";
import type { Range } from "@/lib/report-logic";
import { cn } from "@/lib/utils";
import { PRIVATE_EDITION } from "@/lib/edition";

export const Route = createFileRoute("/dashboard")({
  validateSearch: (search: Record<string, unknown>): { tab?: "overview" | "live" } => (search["tab"] === "live" ? { tab: "live" } : {}),
  head: () => ({ meta: [{ title: "Dashboard — XTSY POS" }, { name: "description", content: "Sales, leakage, payments and live tables at a glance." }] }),
  component: DashboardPage,
});

const money = (n: number) => formatINR(n, 0);
const timeOf = (at: number) => new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" });

function DashboardPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = search.tab ?? "overview";
  return (
    <AppShell>
      <div className="min-h-full">
        <div className="sticky top-[57px] z-10 border-b border-border bg-card/90 px-4 backdrop-blur-xl lg:px-8">
          <nav className="flex gap-6" aria-label="Dashboard">
            {([["overview", "Business overview"], ["live", "Live status"]] as const).map(([v, l]) => (
              <button key={v} type="button" aria-current={tab === v ? "page" : undefined} onClick={() => void navigate({ search: v === "live" ? { tab: "live" } : {}, replace: true })}
                className={cn("-mb-px border-b-2 py-3 text-sm font-semibold transition-colors", tab === v ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
            ))}
          </nav>
        </div>
        <div className="mx-auto max-w-[96rem] p-4 lg:p-8">{tab === "live" ? <LiveStatus /> : <Overview />}</div>
      </div>
    </AppShell>
  );
}

/* ---------------- business overview ---------------- */

const CHART_PRESETS: Preset[] = ["thisWeek", "lastWeek", "last15", "thisMonth", "lastMonth"];
const PERIOD_PRESETS: Preset[] = ["today", "yesterday", "thisWeek", "lastWeek", "last15", "thisMonth", "lastMonth"];
const toInput = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const fromInput = (v: string) => { const [y, m, d] = v.split("-").map(Number); return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime(); };

function Overview() {
  const settings = useRestaurantSettings();
  const [preset, setPreset] = useState<Preset | "custom">("today");
  const [custom, setCustom] = useState<Range>(() => dashboardRange("today"));
  const range = preset === "custom" ? custom : dashboardRange(preset);
  const [chartPreset, setChartPreset] = useState<Preset>("last15");
  const chartRange = dashboardRange(chartPreset);
  const span = { from: Math.min(range.from, chartRange.from), to: Math.max(range.to, chartRange.to) };

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [orders, kots, stock, lastSync] = await Promise.all([
      db.orders.where("createdAt").between(span.from, span.to, true, false).toArray(),
      db.kots.where("createdAt").between(range.from, range.to, true, false).toArray(),
      db.stockEntries.where("at").between(range.from, range.to, true, false).toArray(),
      db.meta.get("lastSyncAt"),
    ]);
    return { orders, kots, stock, lastSync: typeof lastSync?.value === "number" ? lastSync.value : null };
  }, [span.from, span.to, range.from, range.to]);

  const o = useMemo(() => (data ? businessOverview(data.orders, data.kots, data.stock, range) : null), [data, range.from, range.to]);
  const days = useMemo(() => (data ? salesByDay(data.orders, chartRange) : []), [data, chartRange.from, chartRange.to]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{settings.name ? `Welcome, ${settings.name}` : "Dashboard"}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{data?.lastSync ? `Last synced ${timeOf(data.lastSync)}` : "Not synced yet"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown<Preset | "custom"> ariaLabel="Period" className="w-40" value={preset} onChange={setPreset}
            options={[...PERIOD_PRESETS.map((p) => ({ value: p, label: PRESET_LABELS[p] })), { value: "custom", label: "Custom dates" }]} />
          {preset === "custom" ? (
            <div className="flex items-center gap-1.5 text-sm">
              <input type="date" aria-label="From" value={toInput(custom.from)} max={toInput(custom.to - 1)} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, from: fromInput(e.target.value) }))} className="h-10 rounded-[10px] border border-input bg-card px-2" />
              <span className="text-muted-foreground">to</span>
              <input type="date" aria-label="To" value={toInput(custom.to - 1)} min={toInput(custom.from)} onChange={(e) => e.target.value && setCustom((c) => ({ ...c, to: fromInput(e.target.value) + 86_400_000 }))} className="h-10 rounded-[10px] border border-input bg-card px-2" />
            </div>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Kpi label="Total sales" value={o ? money(o.net) : "…"} note={o && o.breakup.guest ? `${money(o.breakup.guest)} from guest orders` : "Billing + guest orders"} icon={IndianRupee} tone="bg-primary-tint text-primary" />
            <Kpi label="Bills" value={o ? o.bills.toLocaleString("en-IN") : "…"} note="Settled bills" icon={Receipt} tone="bg-gold/15 text-warning" />
            <Kpi label="Average bill" value={o ? money(o.average) : "…"} note="Sales ÷ bills" icon={HandCoins} tone="bg-success/10 text-success" />
            <Kpi label="Purchases" value={o ? money(o.purchases) : "…"} note="Stock bought" icon={Package} tone="bg-secondary text-foreground" />
          </div>

          <Card title="Sales by order type">
            <div className="grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
              {(o?.channels ?? []).map((c) => (
                <div key={c.key} className="px-2 py-3 text-center sm:px-4">
                  <p className="text-xs font-medium text-muted-foreground">{c.label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{money(c.net)}</p>
                  <p className="text-sm text-muted-foreground">{c.bills} bill{c.bills === 1 ? "" : "s"}</p>
                  <div className="mx-auto mt-2 h-1.5 w-24 rounded-full bg-secondary" aria-hidden="true"><div className="h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(c.share * 100)}%` }} /></div>
                  <p className="mt-1 text-xs font-semibold text-primary">{Math.round(c.share * 100)}%</p>
                </div>
              ))}
            </div>
          </Card>

          <Card title={`Sales, ${PRESET_LABELS[chartPreset].toLowerCase()}`} action={
            <div className="no-scrollbar flex gap-1 overflow-x-auto">
              {CHART_PRESETS.map((p) => (
                <button key={p} type="button" aria-pressed={chartPreset === p} onClick={() => setChartPreset(p)}
                  className={cn("shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors", chartPreset === p ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent")}>{PRESET_LABELS[p]}</button>
              ))}
            </div>
          }>
            <DailyBars days={days} />
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card title="Revenue leakage" icon={<AlertTriangle className="size-4 text-destructive" />}>
              <div className="grid grid-cols-2 gap-x-6">
                <Leak icon={XCircle} label="Bills cancelled" value={o?.leakage.cancelledBills} note={o?.leakage.cancelledValue ? money(o.leakage.cancelledValue) : undefined} />
                <Leak icon={Ban} label="Items cancelled after KOT" value={o?.leakage.cancelledKots} />
                <Leak icon={BadgePercent} label="Discounted bills" value={o?.leakage.discountedBills} />
                <Leak icon={Gift} label="Complimentary bills" value={o?.leakage.complimentaryBills} />
                <Leak icon={Clock} label="Unpaid (due) bills" value={o?.leakage.dueBills} note={o?.leakage.dueValue ? money(o.leakage.dueValue) : undefined} />
              </div>
            </Card>
            <Card title="Discounts and taxes">
              <dl className="divide-y divide-border">
                <Row label="Discounts" value={money(o?.discounts.total ?? 0)} sub={[["Billing", money(o?.discounts.pos ?? 0)], ["Guest orders", money(o?.discounts.guest ?? 0)]]} />
                <Row label="GST collected" value={formatINR(o?.taxes.total ?? 0)} sub={[["CGST", formatINR(o?.taxes.cgst ?? 0)], ["SGST", formatINR(o?.taxes.sgst ?? 0)]]} />
              </dl>
              <Link to="/reports" className="mt-3 inline-block text-sm font-semibold text-primary">GST report and GSTR-1</Link>
            </Card>
          </div>
        </div>

        <aside className="space-y-6">
          {PRIVATE_EDITION ? null : <PlanCard />}
          <Card title="Sales breakup">
            <dl className="divide-y divide-border">
              <Line icon={Store} label="Billing counter" value={money(o?.breakup.pos ?? 0)} />
              <Line icon={Smartphone} label="Guest orders (QR + online)" value={money(o?.breakup.guest ?? 0)} />
            </dl>
          </Card>
          <Card title="Payment breakup">
            {o && o.payments.length ? (
              <ul className="space-y-3">
                {o.payments.map((p) => (
                  <li key={p.mode}>
                    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="font-medium">{p.label}</span><span className="font-semibold tabular-nums">{money(p.amount)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-secondary" aria-hidden="true"><div className="h-1.5 rounded-full bg-primary/80" style={{ width: `${Math.max(2, Math.round(p.share * 100))}%` }} /></div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">No payments in this period.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Card({ title, icon, action, children }: { title: string; icon?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-border/70">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">{icon}{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, note, icon: Icon, tone }: { label: string; value: string; note: string; icon: typeof Store; tone: string }) {
  return (
    <div className="rounded-2xl bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-border/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-[26px] font-bold leading-tight tracking-tight tabular-nums">{value}</p>
        </div>
        <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", tone)}><Icon className="size-5" /></span>
      </div>
      <p className="mt-3 truncate text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function Leak({ icon: Icon, label, value, note }: { icon: typeof Store; label: string; value: number | undefined; note?: string | undefined }) {
  const bad = (value ?? 0) > 0;
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <span className={cn("h-8 w-1 rounded-full", bad ? "bg-destructive" : "bg-success")} aria-hidden="true" />
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-sm font-medium">{label}{note ? <span className="block text-xs font-normal text-muted-foreground">{note}</span> : null}</span>
      <span className="text-lg font-bold tabular-nums">{value ?? "…"}</span>
    </div>
  );
}

function Row({ label, value, sub }: { label: string; value: string; sub: [string, string][] }) {
  return (
    <div className="py-3 first:pt-0">
      <div className="flex items-baseline justify-between"><dt className="text-sm font-semibold">{label}</dt><dd className="text-xl font-bold tabular-nums">{value}</dd></div>
      <div className="mt-1 flex gap-4 text-xs text-muted-foreground">{sub.map(([k, v]) => <span key={k}>{k} {v}</span>)}</div>
    </div>
  );
}

function Line({ icon: Icon, label, value }: { icon: typeof Store; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <Icon className="size-4 text-muted-foreground" />
      <dt className="flex-1 text-sm font-medium">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function PlanCard() {
  const view: AccountView | null | undefined = useAccount().data;
  if (!view?.account) return null;
  const state = accountState(view.account);
  return (
    <Link to="/account" className="block rounded-2xl bg-sidebar p-5 text-sidebar-foreground shadow-sm ring-1 ring-sidebar-border">
      <p className="text-xs font-medium text-sidebar-foreground/60">Your plan</p>
      <p className="mt-1 text-xl font-bold">{view.plan?.name ?? "—"}</p>
      <p className="mt-0.5 text-sm text-sidebar-foreground/80">{STATUS_LABELS[view.account.status]}{state.label ? `, ${state.label.charAt(0).toLowerCase()}${state.label.slice(1)}` : ""}</p>
      <p className="mt-4 text-xs text-sidebar-foreground/60">{view.outlets.length} outlet{view.outlets.length === 1 ? "" : "s"} · up to {view.plan?.max_staff ?? "—"} staff</p>
    </Link>
  );
}

/** Daily net sales: one bar per day, hover or focus a bar to read it. */
function DailyBars({ days }: { days: { day: number; net: number; bills: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.net), 0);
  const step = max > 0 ? niceStep(max / 4) : 1000;
  const top = Math.max(step * 4, step * Math.ceil(max / step));
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step).reverse();
  const total = days.reduce((s, d) => s + d.net, 0);
  if (!days.length) return null;
  const shown = active !== null ? days[active] : undefined;
  return (
    <div>
      <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">
        {shown ? <>{new Date(shown.day).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}: <strong className="text-foreground">{money(shown.net)}</strong>, {shown.bills} bills</>
          : <>Total <strong className="text-foreground">{money(total)}</strong> over {days.length} days</>}
      </p>
      <div className="flex gap-3">
        <div className="flex h-56 flex-col justify-between pb-6 text-right text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">
          {ticks.map((t) => <span key={t} className="-translate-y-1/2 leading-none">{t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[calc(100%-1.5rem)]" aria-hidden="true">
            {ticks.map((t, i) => <div key={t} className="absolute inset-x-0 border-t border-border/70" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} />)}
          </div>
          <ol className="relative flex h-56 items-end gap-[2px]" aria-label="Net sales by day" onMouseLeave={() => setActive(null)}>
            {days.map((d, i) => (
              <li key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end">
                <button type="button" onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
                  aria-label={`${new Date(d.day).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}: ${money(d.net)}`}
                  className="group flex h-[calc(100%-1.5rem)] w-full items-end justify-center focus:outline-none">
                  <span className={cn("w-full max-w-7 rounded-t-[4px] transition-colors", active === i ? "bg-primary" : "bg-primary/70 group-hover:bg-primary")} style={{ height: `${top ? Math.max(d.net ? 1.5 : 0, (d.net / top) * 100) : 0}%` }} />
                </button>
                <span className={cn("mt-1 h-5 truncate text-center text-[10px] tabular-nums text-muted-foreground", days.length > 16 && i % 2 ? "invisible" : "")}>{new Date(d.day).getDate()}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/* ---------------- live status ---------------- */

function LiveStatus() {
  const held = useLiveQuery(() => getDb().orders.where("status").equals("held").toArray(), [], []);
  const live = useMemo(() => liveStatus(held), [held]);
  return (
    <div>
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live status</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Updates by itself as tables order and settle.</p>
        </div>
        <div className="flex gap-3">
          <div className="rounded-xl bg-card px-4 py-2 ring-1 ring-border/70"><p className="text-xs text-muted-foreground">Running bills</p><p className="text-xl font-bold tabular-nums">{live.cards.length}</p></div>
          <div className="rounded-xl bg-card px-4 py-2 ring-1 ring-border/70"><p className="text-xs text-muted-foreground">Expected total</p><p className="text-xl font-bold tabular-nums">{money(live.total)}</p></div>
        </div>
      </header>
      {live.cards.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {live.cards.map((c) => (
            <article key={c.key} className="flex max-h-[26rem] flex-col overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-border/70">
              <header className="flex items-start justify-between gap-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 truncate font-semibold">{c.kind === "table" ? <UtensilsCrossed className="size-4 text-primary" /> : <ShoppingBag className="size-4 text-primary" />}{c.title}</h2>
                  <p className="text-xs text-muted-foreground">Bill {c.billNo}</p>
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">{timeOf(c.since)}</span>
              </header>
              {c.guestName || c.guestPhone ? (
                <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm">
                  <span className="truncate font-medium">{c.guestName ?? "Guest"}</span>
                  {c.guestPhone ? <a href={`tel:${c.guestPhone}`} className="shrink-0 tabular-nums text-primary">{c.guestPhone}</a> : null}
                </div>
              ) : null}
              <ul className="flex-1 space-y-1 overflow-y-auto px-4 py-3 text-sm">
                {c.lines.map((l) => <li key={l.name} className="flex justify-between gap-3"><span className="min-w-0 truncate">{l.name}</span><span className="tabular-nums text-muted-foreground">{l.qty}</span></li>)}
              </ul>
              <footer className="flex items-center justify-between border-t border-border bg-secondary/40 px-4 py-3">
                <span className="text-sm font-medium">Expected total</span>
                <span className="text-lg font-bold tabular-nums">{money(c.total)}</span>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-semibold">No running bills</p>
          <p className="mt-1 text-sm text-muted-foreground">Tables appear here as soon as their first KOT is sent.</p>
        </div>
      )}
    </div>
  );
}
