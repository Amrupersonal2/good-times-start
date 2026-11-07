import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db";
import { getSyncSnapshot } from "@/lib/cloud-sync";
import { formatINR } from "@/lib/billing";
import { reportOrders } from "@/lib/report-orders";
import { dateLabel, dayBounds } from "@/lib/orders-history";
import { liveTotals } from "@/lib/live-totals";

/** Today's totals straight from this device's records; re-render whenever any terminal's sync lands. */
export function LiveTotals() {
  const [from, to] = dayBounds(dateLabel());
  const data = useLiveQuery(async () => {
    const [today, running, sync] = await Promise.all([
      reportOrders({ from, to: to - 1 }),
      getDb().orders.where("status").equals("held").toArray(),
      getSyncSnapshot(),
    ]);
    return { totals: liveTotals(today, running, from, to), sync };
  }, [from, to]);
  if (!data) return null;
  const { totals: t, sync } = data;
  const cells = [
    { l: "Settled today", v: formatINR(t.settled, 0), h: `${t.bills} bill${t.bills === 1 ? "" : "s"}` },
    { l: "Cash", v: formatINR(t.cash, 0) },
    { l: "UPI", v: formatINR(t.upi, 0) },
    { l: "Card & other", v: formatINR(t.other, 0) },
    { l: "Running bills", v: formatINR(t.running, 0), h: `${t.runningCount} open` },
  ];
  return (
    <section aria-label="Live totals" className="card-elevated mb-5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2 font-semibold"><span className="size-2 animate-pulse rounded-full bg-success" />Live today</span>
        <span className="text-muted-foreground">
          {sync.lastSyncAt ? `Updated ${new Date(sync.lastSyncAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Not synced yet"}
          {sync.pendingOrders ? <span className="ml-2 font-semibold text-warning">{sync.pendingOrders} change{sync.pendingOrders === 1 ? "" : "s"} from this device still sending</span> : null}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cells.map((c) => (
          <div key={c.l}>
            <div className="text-xs text-muted-foreground">{c.l}</div>
            <div className="text-xl font-bold tabular-nums">{c.v}</div>
            {c.h ? <div className="text-xs text-muted-foreground">{c.h}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
