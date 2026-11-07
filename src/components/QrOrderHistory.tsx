import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { QrCode, ShoppingBag } from "lucide-react";
import { useStaff } from "@/lib/auth-context";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { placeName } from "@/lib/table-logic";
import { dayBounds, dateLabel } from "@/lib/orders-history";
import { loadGuestOrderHistory } from "@/lib/guest-order-actions";
import { qrOrderState, qrSeriesLabel } from "@/lib/guest-order-logic";
import type { Order } from "@/lib/types";
import { Segmented } from "./Segmented";
import { Button } from "./ui/button";

const TONE = { pending: "text-gold-foreground", running: "text-primary", settled: "text-success", closed: "text-muted-foreground" } as const;

/** Guest QR and pickup orders by day: QR/0001 series until settled, then the bill's POS number. */
export function QrOrderHistory({ onOpenBill }: { onOpenBill: () => void }) {
  const { user } = useStaff();
  const restaurantId = user?.restaurantId ?? null;
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState(dateLabel());
  const date = period === "custom" ? custom : dateLabel(period === "yesterday" ? -1 : period === "before" ? -2 : 0);
  const [start, end] = dayBounds(date);
  const history = useQuery({
    queryKey: ["guest-order-history", restaurantId, start],
    queryFn: () => loadGuestOrderHistory(restaurantId ?? "", start, end),
    enabled: !!restaurantId,
    refetchInterval: 30_000,
  });
  const orders = history.data ?? [];
  // The bill each guest order joined, from this device's synced records (for its POS number).
  const uids = [...new Set(orders.map((o) => o.order_uid).filter((u): u is string => !!u))];
  const bills = useLiveQuery(async () => (uids.length ? await getDb().orders.where("uid").anyOf(uids).toArray() : []), [uids.join(",")], [] as Order[]);
  const navigate = useNavigate();

  return (
    <div className="space-y-3">
      <Segmented ariaLabel="QR order dates" value={period} onChange={setPeriod} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "before", label: "Day before" }, { value: "custom", label: "Custom" }]} />
      {period === "custom" ? <label className="block text-sm">Date<input type="date" aria-label="QR order date" value={custom} onChange={(e) => { if (e.target.value) setCustom(e.target.value); }} className="ml-3 rounded-md border border-input bg-card px-2 py-1" /></label> : null}
      {history.isLoading ? <p className="py-6 text-center text-sm text-muted-foreground">Loading QR orders…</p> : null}
      {history.isError ? <p role="alert" className="py-6 text-center text-sm text-destructive">Couldn't load QR orders. Check the internet and try again.</p> : null}
      {!history.isLoading && !history.isError && !orders.length ? <p className="py-6 text-center text-sm text-muted-foreground">No QR orders for this date.</p> : null}
      <ul className="divide-y divide-border">
        {orders.map((o) => {
          const bill = bills.find((b) => b.uid === o.order_uid);
          const state = qrOrderState(o, bill);
          const running = state.tone === "running" && !!o.order_uid;
          return (
            <li key={o.id} className="flex min-h-16 items-center gap-3 py-2">
              {o.channel === "table" ? <QrCode className="size-4 shrink-0 text-muted-foreground" /> : <ShoppingBag className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{qrSeriesLabel(o.qr_no) ?? o.code}</span>
                  <span className="text-sm text-muted-foreground">{o.channel === "table" ? placeName(o.table_label ?? "") : "Pickup"}{o.customer_name ? ` · ${o.customer_name}` : ""}</span>
                </div>
                <div className={`text-xs font-semibold ${TONE[state.tone]}`}>{state.label}<span className="font-normal text-muted-foreground"> · {new Date(o.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
              </div>
              <span className="shrink-0 tabular-nums">{formatINR(bill?.status === "settled" ? bill.total : o.subtotal, 0)}</span>
              {running ? <Button size="sm" variant="outline" onClick={() => { onOpenBill(); void navigate({ to: "/", search: { bill: o.order_uid ?? "" } }); }}>Open bill</Button> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
