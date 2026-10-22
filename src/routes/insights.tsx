import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, ChefHat, Download, LogIn, Package, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InstallButton } from "@/components/AppInstall";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { busyGrid, change, cumulativeByHour, kitchenQueue, periodRanges, type Period } from "@/lib/insights-logic";
import { dailySales, dayStart, itemSales, paymentLabel, salesSummary, staffSales } from "@/lib/report-logic";
import { isLow } from "@/lib/stock-logic";
import { useRestaurantSettings } from "@/lib/use-settings";
import type { Order } from "@/lib/types";
import { Segmented } from "@/components/Segmented";
import { MenuAdvisor } from "@/components/MenuAdvisor";
import { reportsWorkbook, rangeLabel } from "@/lib/report-excel";
import { gstr1Workbook } from "@/lib/gstr1";
import { downloadXlsx } from "@/lib/xlsx";
import { syncCloudData } from "@/lib/cloud-sync";

export const Route = createFileRoute("/insights")({
  head: () => ({
    meta: [
      { title: "XTSY Reports — Live Restaurant Sales" },
      { name: "description", content: "Daily sales, payment split, top items and GSTR-1 Excel exports from your live restaurant POS." },
      { property: "og:title", content: "Restaurant Insights & Menu Advisor — XTSY POS" },
      { property: "og:description", content: "Review restaurant sales and get evidence-based menu recommendations." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InsightsApp,
});

const DAY = 86_400_000;
const PERIODS: { v: Period; l: string }[] = [
  { v: "today", l: "Today" }, { v: "yesterday", l: "Yesterday" }, { v: "week", l: "7 days" }, { v: "month", l: "Month" },
];
const ORDER_TYPE: Record<string, string> = { "dine-in": "Dine-in", takeaway: "Takeaway", delivery: "Delivery", swiggy: "Swiggy", zomato: "Zomato" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Categorical slots validated for colour-blind separation on a near-black surface (dataviz validator, dark mode). */
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"];

const compact = (n: number) => (n >= 100000 ? `₹${(n / 100000).toFixed(n >= 1000000 ? 1 : 2)}L` : n >= 1000 ? `₹${(n / 1000).toFixed(1)}k` : formatINR(n, 0));

function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-sm text-muted-foreground">Nothing to compare yet</span>;
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 text-sm font-semibold ${up ? "text-success" : "text-destructive"}`}>
      <Icon className="size-4" aria-hidden="true" />{up ? "+" : ""}{value}%<span className="font-normal text-muted-foreground">{label}</span>
    </span>
  );
}

/** Running total through the day: this period (accent) against the comparison (muted). Touch or hover to read values. */
function DayLine({ current, previous, upToHour }: { current: number[]; previous: number[]; upToHour: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 320, H = 120, PAD = 6;
  const startHour = 7;
  const hours = 24 - startHour;
  const max = Math.max(1, ...current, ...previous);
  const x = (h: number) => PAD + ((h - startHour) / (hours - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const path = (vals: number[], last: number) => vals.slice(startHour, last + 1).map((v, i) => `${i ? "L" : "M"}${x(i + startHour).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const at = hover ?? Math.min(23, Math.max(startHour, upToHour));
  const pick = (e: ReactPointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const h = Math.round(startHour + ((e.clientX - box.left) / box.width) * (hours - 1));
    setHover(Math.min(23, Math.max(startHour, h)));
  };
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>By {at}:59</span>
        <span className="flex gap-3">
          <span><span className="mr-1 inline-block h-0.5 w-3 bg-primary align-middle" />{formatINR(current[Math.min(at, upToHour)] ?? 0, 0)}</span>
          <span><span className="mr-1 inline-block h-0.5 w-3 bg-muted-foreground align-middle" />{formatINR(previous[at] ?? 0, 0)}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-32 w-full touch-none" role="img" aria-label="Running sales through the day compared with the comparison day"
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
        {[0.5, 1].map((f) => <line key={f} x1={PAD} x2={W - PAD} y1={y(max * f)} y2={y(max * f)} stroke="var(--color-border)" strokeWidth="1" />)}
        <path d={path(previous, 23)} fill="none" stroke="var(--color-muted-foreground)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.7" />
        <path d={path(current, Math.max(startHour, upToHour))} fill="none" stroke="var(--color-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(at)} x2={x(at)} y1={PAD} y2={H - PAD} stroke="var(--color-foreground)" strokeOpacity="0.25" strokeWidth="1" />
        {at <= upToHour ? <circle cx={x(at)} cy={y(current[at] ?? 0)} r="4" fill="var(--color-primary)" stroke="var(--color-card)" strokeWidth="2" /> : null}
      </svg>
      <div className="flex justify-between text-[10px] text-muted-foreground"><span>7 am</span><span>12 pm</span><span>5 pm</span><span>11 pm</span></div>
    </div>
  );
}

/** One horizontal bar split by share, 2px gaps between parts, with a labelled legend so colour is never the only cue. */
function MixBar({ parts }: { parts: { label: string; value: number }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!total) return <p className="text-sm text-muted-foreground">No bills in this period.</p>;
  const sorted = [...parts].sort((a, b) => b.value - a.value).slice(0, SERIES.length);
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full" role="img" aria-label={sorted.map((p) => `${p.label} ${Math.round((p.value / total) * 100)}%`).join(", ")}>
        {sorted.map((p, i) => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: SERIES[i] }} />)}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {sorted.map((p, i) => (
          <li key={p.label} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: SERIES[i] }} aria-hidden="true" />
            <span className="flex-1">{p.label}</span>
            <span className="tabular-nums text-muted-foreground">{Math.round((p.value / total) * 100)}%</span>
            <span className="w-20 text-right font-semibold tabular-nums">{compact(p.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Average sales by weekday and hour over four weeks: one hue, darker = busier. */
function BusyHours({ grid }: { grid: number[][] }) {
  const [pick, setPick] = useState<{ d: number; h: number } | null>(null);
  const hours = Array.from({ length: 16 }, (_, i) => i + 8);
  const max = Math.max(1, ...grid.flatMap((r) => hours.map((h) => r[h] ?? 0)));
  const peak = grid.flatMap((r, d) => hours.map((h) => ({ d, h, v: r[h] ?? 0 }))).sort((a, b) => b.v - a.v)[0];
  const shown = pick ?? (peak && peak.v > 0 ? { d: peak.d, h: peak.h } : null);
  return (
    <div>
      <p className="mb-2 min-h-5 text-sm">
        {shown ? <>{WEEKDAYS[shown.d]} {shown.h}:00–{shown.h + 1}:00 averages <strong className="tabular-nums">{formatINR(grid[shown.d]?.[shown.h] ?? 0, 0)}</strong>{!pick ? " (busiest)" : ""}</> : <span className="text-muted-foreground">Settle a few bills to see your busy hours.</span>}
      </p>
      <div className="grid grid-cols-[2rem_1fr] gap-x-1.5 gap-y-[2px]">
        {grid.map((row, d) => (
          <div key={d} className="contents">
            <span className="text-[10px] leading-4 text-muted-foreground">{WEEKDAYS[d]}</span>
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
              {hours.map((h) => {
                const v = row[h] ?? 0;
                const active = pick?.d === d && pick.h === h;
                return (
                  <button key={h} type="button" onClick={() => setPick({ d, h })} aria-label={`${WEEKDAYS[d]} ${h}:00, ${formatINR(v, 0)}`}
                    className={`h-4 rounded-[3px] ${active ? "ring-2 ring-foreground" : ""}`}
                    style={{ background: v ? `color-mix(in oklab, var(--color-primary) ${Math.round(18 + (v / max) * 82)}%, var(--color-card))` : "var(--color-secondary)" }} />
                );
              })}
            </div>
          </div>
        ))}
        <span />
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>8 am</span><span>12 pm</span><span>4 pm</span><span>8 pm</span><span>11 pm</span></div>
      </div>
    </div>
  );
}

function InsightsApp() {
  const { user, loading } = useStaff();
  const settings = useRestaurantSettings();
  const [period, setPeriod] = useState<Period>("today");
  const [now, setNow] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [syncError, setSyncError] = useState("");
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(t); }, []);
  const minute = Math.floor(now / 60_000);
  const { current, previous, label } = useMemo(() => periodRanges(period, minute * 60_000), [period, minute]);

  const data = useLiveQuery(async () => {
    const db = getDb();
    const [cur, prev, month, tables, kots, materials, levels, lastSync] = await Promise.all([
      db.orders.where("createdAt").between(current.from, current.to, true, true).toArray(),
      db.orders.where("createdAt").between(previous.from, previous.to, true, true).toArray(),
      db.orders.where("createdAt").aboveOrEqual(dayStart(now) - 28 * DAY).toArray(),
      db.restTables.toArray(),
      db.kots.where("createdAt").aboveOrEqual(now - 12 * 3_600_000).toArray(),
      db.materials.toArray(),
      db.materialLevels.toArray(),
      db.meta.get("lastSyncAt"),
    ]);
    return { cur, prev, month, tables, kots, materials, levels, lastSync: typeof lastSync?.value === "number" ? lastSync.value : null };
  }, [current.from, current.to, previous.from, previous.to, minute]);

  if (!loading && !user) {
    return (
      <Shell name={settings.name}>
        <div className="rounded-2xl bg-card p-6 text-center">
          <p className="text-lg font-bold">Sign in to see your restaurant</p>
          <p className="mt-1 text-sm text-muted-foreground">Insights shows every counter's sales, live, once you're signed in as the owner or a manager.</p>
          <Button className="mt-4" asChild><Link to="/auth"><LogIn />Sign in</Link></Button>
        </div>
      </Shell>
    );
  }
  if (user && !isAdmin(user)) {
    return <Shell name={settings.name}><p className="rounded-2xl bg-card p-6 text-center text-sm">Insights is for owners and managers.</p></Shell>;
  }
  if (!data) return <Shell name={settings.name}><div className="h-64 animate-pulse rounded-2xl bg-card" /></Shell>;

  const s = salesSummary(data.cur);
  const p = salesSummary(data.prev);
  const singleDay = period === "today" || period === "yesterday";
  const seated = data.tables.filter((t) => t.status === "occupied" || t.status === "billed");
  const queue = kitchenQueue(data.kots, now);
  const levels = new Map(data.levels.map((l) => [l.materialId, l.qty]));
  const low = data.materials.filter((m) => !m.archived && isLow(m, levels.get(m.id) ?? 0)).sort((a, b) => (levels.get(a.id) ?? 0) / Math.max(0.001, a.lowStockLevel) - (levels.get(b.id) ?? 0) / Math.max(0.001, b.lowStockLevel));
  const top = itemSales(data.cur, []).slice(0, 8);
  const topMax = Math.max(1, ...top.map((t) => t.qty));
  const staff = staffSales(data.cur).slice(0, 6);
  const weeksOfData = Math.min(4, Math.max(1, Math.ceil((now - Math.min(now, ...data.month.map((o: Order) => o.createdAt))) / (7 * DAY))));
  const refresh = async () => {
    if (!user?.restaurantId || refreshing) return;
    setRefreshing(true);
    setSyncError("");
    try { await syncCloudData(user.restaurantId); setNow(Date.now()); }
    catch { setSyncError("Couldn't update live sales. Showing the last saved figures."); }
    finally { setRefreshing(false); }
  };
  const exportSales = async () => {
    const db = getDb();
    const menu = await db.menu.toArray();
    downloadXlsx(`sales-${new Date(current.from).toISOString().slice(0, 10)}`, reportsWorkbook(data.cur, menu, [], current, settings.name));
  };
  const exportGst = () => {
    const { sheets } = gstr1Workbook(data.cur, settings, rangeLabel(current));
    downloadXlsx(`GSTR-1-${new Date(current.from).toISOString().slice(0, 10)}`, sheets);
  };

  return (
    <Shell name={settings.name} lastSync={data.lastSync}>
      <Segmented ariaLabel="Period" stretch value={period} onChange={setPeriod} options={PERIODS.map((x) => ({ value: x.v, label: x.l }))} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}><RefreshCw className={refreshing ? "animate-spin" : ""} />Refresh</Button>
        <Button variant="outline" size="sm" onClick={() => void exportSales()}><Download />Sales Excel</Button>
        <Button variant="outline" size="sm" disabled={!s.bills} onClick={exportGst}><Download />GSTR-1</Button>
      </div>
      {syncError ? <p role="alert" className="text-sm text-destructive">{syncError}</p> : null}
      <p className="text-xs text-muted-foreground">{rangeLabel(current)}</p>

      <section className="pt-2">
        <p className="text-sm text-muted-foreground">Net sales{period === "today" ? " so far today" : ""}</p>
        <p className="text-5xl font-extrabold leading-tight tracking-tight tabular-nums">{formatINR(s.net, 0)}</p>
        <Delta value={change(s.net, p.net)} label={` ${label}`} />
      </section>

      <Card title={singleDay ? "Through the day" : "Day by day"}>
        {singleDay ? (
          <DayLine current={cumulativeByHour(data.cur, current.from)} previous={cumulativeByHour(data.prev, previous.from)}
            upToHour={period === "today" ? new Date(now).getHours() : 23} />
        ) : (
          <DailyBars days={dailySales(data.cur, current)} />
        )}
      </Card>

      {period === "today" ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-card p-4">
            <Users className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-2xl font-bold tabular-nums">{seated.length}<span className="text-base font-medium text-muted-foreground">/{data.tables.length}</span></p>
            <p className="text-xs text-muted-foreground">tables seated, {compact(seated.reduce((t, x) => t + x.runningTotal, 0))} open</p>
          </div>
          <div className={`rounded-2xl p-4 ${queue.oldestMinutes >= 20 ? "bg-destructive/20" : "bg-card"}`}>
            <ChefHat className="size-4 text-muted-foreground" aria-hidden="true" />
            <p className="mt-2 text-2xl font-bold tabular-nums">{queue.waiting + queue.cooking}</p>
            <p className="text-xs text-muted-foreground">
              {queue.waiting + queue.cooking ? `tickets in kitchen, oldest ${queue.oldestMinutes} min` : "kitchen is clear"}
              {queue.oldestMinutes >= 20 ? <span className="mt-1 flex items-center gap-1 font-semibold text-foreground"><AlertTriangle className="size-3.5" />Running late</span> : null}
            </p>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        {[
          { l: "Bills", v: String(s.bills), d: change(s.bills, p.bills) },
          { l: "Average bill", v: formatINR(s.average, 0), d: change(s.average, p.average) },
          { l: "Discounts", v: compact(s.discounts), d: null },
          { l: "Void bills", v: String(s.voids), sub: s.voids ? compact(s.voidValue) : "none" },
        ].map((k) => (
          <div key={k.l} className="rounded-2xl bg-card p-4">
            <p className="text-xs text-muted-foreground">{k.l}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{k.v}</p>
            {"sub" in k ? <p className="text-xs text-muted-foreground">{k.sub}</p> : k.d !== null && k.d !== undefined ? <p className={`text-xs font-semibold ${k.d >= 0 ? "text-success" : "text-destructive"}`}>{k.d >= 0 ? "+" : ""}{k.d}%</p> : null}
          </div>
        ))}
      </div>

      <Card title="How guests paid"><MixBar parts={Object.entries(s.byPayment).map(([mode, value]) => ({ label: paymentLabel(mode), value }))} /></Card>
      <Card title="Where orders came from"><MixBar parts={Object.entries(s.byOrderType).map(([t, v]) => ({ label: ORDER_TYPE[t] ?? t, value: v.net }))} /></Card>

      <Card title="Best sellers">
        {top.length ? (
          <ul className="space-y-2.5">
            {top.map((t) => (
              <li key={t.name}>
                <div className="flex justify-between gap-2 text-sm"><span className="truncate">{t.name}</span><span className="shrink-0 font-semibold tabular-nums">{t.qty}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${(t.qty / topMax) * 100}%` }} /></div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted-foreground">No dishes sold in this period.</p>}
      </Card>

      <Card title={`Busy hours, last ${weeksOfData} week${weeksOfData === 1 ? "" : "s"}`}><BusyHours grid={busyGrid(data.month, weeksOfData)} /></Card>

      <Card title="Running low" action={low.length ? <span className="rounded-full bg-gold/25 px-2 py-0.5 text-xs font-semibold text-foreground">{low.length}</span> : null}>
        {low.length ? (
          <ul className="divide-y divide-border text-sm">
            {low.slice(0, 8).map((m) => (
              <li key={m.id} className="flex items-center gap-2 py-2">
                <Package className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1 truncate">{m.name}</span>
                <span className="tabular-nums text-muted-foreground">{Math.max(0, Math.round((levels.get(m.id) ?? 0) * 100) / 100)} {m.unit}</span>
              </li>
            ))}
            {low.length > 8 ? <li className="pt-2 text-xs text-muted-foreground">and {low.length - 8} more on the Stock page</li> : null}
          </ul>
        ) : <p className="text-sm text-muted-foreground">Every ingredient is above its warning level.</p>}
      </Card>

      {staff.length ? (
        <Card title="Team">
          <ul className="divide-y divide-border text-sm">
            {staff.map((x) => (
              <li key={x.name} className="flex items-center gap-2 py-2">
                <span className="flex-1 truncate">{x.name}</span>
                <span className="text-xs text-muted-foreground">{x.bills} bills{x.voids ? `, ${x.voids} void` : ""}</span>
                <span className="w-16 text-right font-semibold tabular-nums">{compact(x.net)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {user?.role === "owner" && user.restaurantId ? <MenuAdvisor key={user.restaurantId} restaurantId={user.restaurantId} from={current.from} to={current.to} /> : null}
    </Shell>
  );
}

function DailyBars({ days }: { days: { day: string; net: number }[] }) {
  const [pick, setPick] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.net));
  const shown = days[pick ?? days.length - 1];
  return (
    <div>
      <p className="mb-2 text-sm">{shown ? <>{shown.day.split("-").reverse().slice(0, 2).join("/")}: <strong className="tabular-nums">{formatINR(shown.net, 0)}</strong></> : null}</p>
      <div className="flex h-28 items-end gap-[2px]" role="img" aria-label="Sales by day">
        {days.map((d, i) => (
          <button key={d.day} type="button" aria-label={`${d.day}: ${formatINR(d.net, 0)}`} onClick={() => setPick(i)}
            className={`flex-1 rounded-t-[4px] ${i === (pick ?? days.length - 1) ? "bg-primary" : "bg-primary/45"}`} style={{ height: `${Math.max(2, (d.net / max) * 100)}%` }} />
        ))}
      </div>
    </div>
  );
}

function Shell({ name, lastSync, children }: { name: string; lastSync?: number | null; children: ReactNode }) {
  return (
    <div className="dark min-h-screen bg-background pb-[env(safe-area-inset-bottom)] text-foreground">
      <div className="mx-auto max-w-md space-y-4 px-4 pb-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-base font-extrabold">{name || "POS Business Manager"}</p>
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <RefreshCw className="size-3" aria-hidden="true" />
              {lastSync ? `Updated ${new Date(lastSync).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Waiting for first sync"}
            </p>
          </div>
          <InstallButton label="Install" />
        </header>
        {children}
      </div>
    </div>
  );
}
