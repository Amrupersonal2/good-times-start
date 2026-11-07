import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ChefHat, CheckCircle2, Clock, Ban } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Segmented } from "@/components/Segmented";
import { getDb } from "@/lib/db";
import { dayBounds, dateLabel, historyBills } from "@/lib/orders-history";
import { reportOrders } from "@/lib/report-orders";
import { liveKitchenTickets } from "@/lib/kitchen-view";

export const Route = createFileRoute("/kitchen")({
  validateSearch: (search: Record<string, unknown>): { view?: "live" | "settled"; station?: string; date?: string | undefined } => ({
    view: search['view'] === "settled" ? "settled" : "live",
    station: typeof search['station'] === "string" ? search['station'] : "all",
    date: typeof search['date'] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(search['date']) ? search['date'] : undefined,
  }),
  head: () => ({ meta: [
    { title: "Kitchen — TAB Bistro by XTSY" },
    { name: "description", content: "Live kitchen tickets by station and rooms settled by payment date." },
    { property: "og:title", content: "Kitchen — TAB Bistro by XTSY" },
    { property: "og:description", content: "Live kitchen tickets by station and rooms settled by payment date." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },
  ] }),
  component: KitchenPage,
});

function KitchenPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const view = search.view ?? "live";
  const station = search.station ?? "all";
  const date = search.date ?? dateLabel();
  const [start, end] = dayBounds(date);
  const data = useLiveQuery(async () => {
    const db = getDb();
    const [open, dated, recent] = await Promise.all([
      db.orders.where("status").equals("held").toArray(),
      reportOrders({ from: start, to: end - 1 }),
      db.kots.where("createdAt").between(start, end, true, false).toArray(),
    ]);
    const linked = (await Promise.all(open.filter((o) => o.uid).map((o) => db.kots.where("orderUid").equals(o.uid ?? "").toArray()))).flat();
    const kots = [...new Map([...recent, ...linked].map((k) => [k.uid ?? k.id, k])).values()];
    const orders = [...new Map([...dated, ...open].map((o) => [o.uid ?? o.id, o])).values()];
    return { orders, kots };
  }, [start, end], { orders: [], kots: [] });
  const groups = liveKitchenTickets(data.kots, data.orders, start, end, station);
  const settled = historyBills(data.orders, "settled", [start, end]).filter((o) => o.tableId);
  const stations = [...new Set(data.kots.map((k) => k.station))].sort();
  return <AppShell><div className="p-4 lg:p-6">
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="flex items-center gap-2 text-2xl font-bold"><ChefHat className="text-primary" />Kitchen</h1><p className="text-sm text-muted-foreground">{groups.length} live submissions · {settled.length} settled room bills</p></div>
      <Segmented ariaLabel="Kitchen view" value={view} onChange={(value) => void navigate({ search: { ...search, view: value } })} options={[{ value: "live", label: "Live KOTs" }, { value: "settled", label: "Settled rooms" }]} />
    </header>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      {view === "live" ? <label className="text-sm font-medium">Station <select aria-label="Kitchen station" value={station} onChange={(e) => void navigate({ search: { ...search, station: e.target.value } })} className="ml-2 rounded-md border border-input bg-card p-2"><option value="all">All stations</option>{stations.map((s) => <option key={s}>{s}</option>)}</select></label> : null}
      <label className="text-sm font-medium">Date <input aria-label="Kitchen date" type="date" value={date} onChange={(e) => void navigate({ search: { ...search, date: e.target.value } })} className="ml-2 rounded-md border border-input bg-card p-2" /></label>
    </div>
    {view === "live" ? <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {groups.map((group) => <article key={group.id} className="overflow-hidden rounded-lg border border-border bg-card">
        <header className="border-b border-border bg-secondary p-4"><h2 className="text-lg font-bold">{group.first.tableSection ? `${group.first.tableSection} · ` : ""}{group.first.tableLabel ?? group.first.tableId ?? "Counter"}</h2><div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>{group.first.printedKotNo ?? group.first.kotNo ?? group.first.billNo}</span><span className="flex items-center gap-1"><Clock className="size-3" />{new Date(group.first.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div></header>
        {group.tickets.map((ticket, i) => <div key={ticket.uid ?? i} className="border-b border-border p-4 last:border-b-0"><h3 className={`mb-2 flex items-center gap-2 text-sm font-bold ${ticket.kind === "cancel" ? "text-destructive" : "text-primary"}`}>{ticket.kind === "cancel" ? <><Ban className="size-4" />Cancelled · </> : null}{ticket.station}</h3><ul className="space-y-3">{ticket.lines.map((line, n) => <li key={n} className="flex items-start gap-3"><span className="min-w-0 flex-1 font-semibold">{line.name}{line.note ? <span className="mt-1 block text-sm font-normal text-muted-foreground">{line.note}</span> : null}</span><span className="w-10 shrink-0 text-right text-xl font-bold tabular-nums">{line.qty}</span></li>)}</ul></div>)}
      </article>)}
      {!groups.length ? <p className="py-10 text-muted-foreground">No live KOTs.</p> : null}
    </div> : <section className="divide-y divide-border border-y border-border">{settled.map((o) => <div key={o.uid ?? o.id} className="flex items-center gap-3 py-4"><CheckCircle2 className="size-5 shrink-0 text-success" /><div className="min-w-0 flex-1"><h2 className="font-bold">{o.tableSection ? `${o.tableSection} · ` : ""}{o.tableLabel ?? o.tableId}</h2><p className="text-sm text-muted-foreground">{o.billNo}</p></div><span className="text-sm text-muted-foreground">Settled {new Date(o.settledAt ?? o.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>)}{!settled.length ? <p className="py-10 text-muted-foreground">No rooms settled on this date.</p> : null}</section>}
  </div></AppShell>;
}