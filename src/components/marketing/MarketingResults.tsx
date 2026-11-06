import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useQuery } from "@tanstack/react-query";
import { Check, QrCode, ShoppingBag, Users } from "lucide-react";
import { Segmented } from "@/components/Segmented";
import { getDb } from "@/lib/db";
import { loadScans } from "@/lib/marketing-actions";
import { scanSummary, sourceLabel } from "@/lib/marketing-logic";

export function MarketingResults({ restaurantId }: { restaurantId: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const optedIn = useLiveQuery(async () => (await getDb().customers.toArray()).filter((c) => c.whatsapp?.optIn).length, [], 0);
  const q = useQuery({ queryKey: ["scans", restaurantId, days], queryFn: () => loadScans(restaurantId, days), staleTime: 60_000 });
  const rows = useMemo(() => (q.data ? scanSummary(q.data.scans, q.data.ordersBySource) : []), [q.data]);
  const totalScans = rows.reduce((n, r) => n + r.scans, 0);
  const totalOrders = rows.reduce((n, r) => n + r.orders, 0);
  const top = Math.max(1, ...rows.map((r) => r.scans));
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of q.data?.scans ?? []) m.set(r.day, (m.get(r.day) ?? 0) + r.scans);
    const out: { day: string; scans: number }[] = [];
    for (let i = days - 1; i >= 0; i -= 1) {
      const day = new Date(Date.now() + 5.5 * 3_600_000 - i * 86_400_000).toISOString().slice(0, 10);
      out.push({ day, scans: m.get(day) ?? 0 });
    }
    return out;
  }, [q.data, days]);
  const dayTop = Math.max(1, ...byDay.map((d) => d.scans));

  return (
    <div className="space-y-6">
      <Segmented ariaLabel="Period" value={days} onChange={setDays} options={[{ value: 7, label: "7 days" }, { value: 30, label: "30 days" }, { value: 90, label: "90 days" }]} />
      {q.isError ? <p className="text-sm text-muted-foreground">{q.error instanceof Error ? q.error.message : "Couldn't load results."}</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icon={QrCode} label="Menu opens from QR & links" value={totalScans} />
        <Tile icon={ShoppingBag} label="Guest orders" value={totalOrders} />
        <Tile icon={Check} label="Said yes to WhatsApp" value={q.data?.optIns ?? 0} note="in this period" />
        <Tile icon={Users} label="WhatsApp audience" value={optedIn} note="all time" />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">Menu opens per day</h2>
        <div className="mt-3 flex h-28 items-end gap-[2px]" role="img" aria-label={`Menu opens per day over the last ${days} days, ${totalScans} in total`}>
          {byDay.map((d) => (
            <div key={d.day} title={`${d.day}: ${d.scans}`} className="flex-1 rounded-t-sm bg-primary/80" style={{ height: `${Math.max(d.scans ? 4 : 1, (d.scans / dayTop) * 100)}%`, opacity: d.scans ? 1 : 0.25 }} />
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{byDay[0]?.day.slice(5)}</span><span>Today</span></div>
      </section>

      <section>
        <h2 className="text-base font-bold">Which QR codes work</h2>
        <p className="mt-1 text-sm text-muted-foreground">Opens counts each guest once per visit. Orders are guest orders placed from that code.</p>
        {rows.length ? (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {rows.map((r) => (
              <li key={r.source} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 p-3.5 sm:grid-cols-[12rem_1fr_auto]">
                <span className="font-semibold">{sourceLabel(r.source, tables)}</span>
                <span className="order-3 col-span-2 h-2 overflow-hidden rounded-full bg-secondary sm:order-none sm:col-span-1"><span className="block h-full rounded-full bg-primary" style={{ width: `${(r.scans / top) * 100}%` }} /></span>
                <span className="text-right text-sm tabular-nums"><strong>{r.scans}</strong> opens · <strong>{r.orders}</strong> orders <span className="text-muted-foreground">({Math.round(r.rate * 100)}%)</span></span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-3 text-sm text-muted-foreground">{q.isLoading ? "Loading…" : "No scans yet. Print your QR codes from the QR kit."}</p>}
      </section>
    </div>
  );
}

function Tile({ icon: Icon, label, value, note }: { icon: typeof QrCode; label: string; value: number; note?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString("en-IN")}</p>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
    </div>
  );
}
