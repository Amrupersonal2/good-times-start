import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { reportOrders } from "@/lib/report-orders";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { dayBounds, dateLabel, historyBills, type HistoryKind } from "@/lib/orders-history";
import { Button } from "./ui/button";
import { DialogTitle } from "./ui/dialog";
import { Segmented } from "./Segmented";
import { SlipView } from "./Slip";
import { billSlip, kotSlip } from "@/lib/slip";
import { usePrintConfig } from "@/lib/print-config";
import { useRestaurantSettings } from "@/lib/use-settings";
import { kotSubmissions, type KotSubmission } from "@/lib/kot-history";
import type { Order, Kot } from "@/lib/types";
import { ReservationsPanel } from "./ReservationsPanel";
import { useReservations } from "@/lib/use-reservations";
import { activeReservations } from "@/lib/reservations";

export interface OrdersOverviewProps { onClose: () => void; guestContent: React.ReactNode; guestCount: number; initialView?: "running" | "guest" | "bookings" }
export function OrdersOverview({ onClose, guestContent, guestCount, initialView = "running" }: OrdersOverviewProps) {
  const [view, setView] = useState<"running" | "history" | "guest" | "bookings">(initialView);
  const bookings = useReservations();
  const active = activeReservations(bookings.rows, Date.now());
  const [kind, setKind] = useState<HistoryKind>("bills");
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState(dateLabel());
  const [detail, setDetail] = useState<Order | KotSubmission | null>(null);
  const date = period === "custom" ? custom : dateLabel(period === "yesterday" ? -1 : period === "before" ? -2 : 0);
  const [start, end] = dayBounds(date);
  const running = useLiveQuery(() => getDb().orders.where("status").equals("held").sortBy("createdAt"), [], []);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const history = useLiveQuery(async () => ({ bills: await reportOrders({ from: start, to: end - 1 }), kots: await getDb().kots.where("createdAt").between(start, end, true, false).reverse().toArray() }), [start, end], { bills: [], kots: [] });
  const datedBills = (type: HistoryKind) => historyBills(history.bills, type, [start, end]);
  const submissions = kotSubmissions(history.kots);
  const settings = useRestaurantSettings(); const config = usePrintConfig();
  const navigate = useNavigate();
  const open = (order: Order) => { onClose(); void navigate({ to: "/", search: order.tableId && order.source !== "qr" ? { table: order.tableId } : { bill: order.uid ?? "" } }); };
  return <div className="space-y-4">
    <DialogTitle>Orders</DialogTitle>
    <Segmented ariaLabel="Orders view" stretch value={view} onChange={(v) => { setView(v); setDetail(null); }} options={[{ value: "running", label: "Running", badge: running.length }, { value: "bookings", label: "Bookings", badge: active.length }, { value: "history", label: "History" }, { value: "guest", label: "Guest requests", badge: guestCount }]} />
    {view === "bookings" ? <ReservationsPanel upcoming onOpenOrder={onClose} /> : view === "guest" ? guestContent : view === "running" ? <div className="divide-y divide-border">
      {active.length ? <Button variant="outline" className="mb-3 w-full" onClick={() => setView("bookings")}>{active.length} guest booking{active.length === 1 ? "" : "s"} · View & start order</Button> : null}
      {running.map((o) => <Button key={o.uid ?? o.billNo} variant="ghost" className="h-auto w-full justify-between gap-3 rounded-none py-3 text-left" onClick={() => open(o)}><span className="min-w-0"><span className="block font-bold">{o.tableLabel ?? tables.find((t) => t.id === o.tableId)?.label ?? o.orderType}</span><span className="block text-xs font-normal text-muted-foreground">{o.billNo} · {o.lines.reduce((n, l) => n + l.qty, 0)} items{o.customer?.name ? ` · ${o.customer.name}` : ""}</span></span><span>{formatINR(o.total, 0)}</span></Button>)}
      {tables.filter((t) => t.status === "occupied" && !running.some((o) => o.tableId === t.id)).map((t) => <div key={t.id} className="flex justify-between py-3 text-sm"><strong>{t.label}</strong><span>{t.heldBy ?? "Taking order"} · {formatINR(t.runningTotal, 0)}</span></div>)}
      {!running.length && !tables.some((t) => t.status === "occupied") ? <p className="py-8 text-center text-sm text-muted-foreground">No running bills.</p> : null}
    </div> : <>
      <Segmented ariaLabel="History dates" value={period} onChange={(v) => { setPeriod(v); setDetail(null); }} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "before", label: "Day before" }, { value: "custom", label: "Custom" }]} />
      {period === "custom" ? <label className="block text-sm">Date<input type="date" aria-label="History date" value={custom} onChange={(e) => { if (e.target.value) { setCustom(e.target.value); setDetail(null); } }} className="ml-3 rounded-md border border-input bg-card p-2" /></label> : null}
      <Segmented ariaLabel="History type" value={kind} onChange={(v) => { setKind(v); setDetail(null); }} options={[{ value: "bills", label: "Bills", badge: datedBills("bills").length }, { value: "kots", label: "KOTs", badge: submissions.length }, { value: "settled", label: "Settled", badge: datedBills("settled").length }, { value: "cancelled", label: "Cancelled", badge: datedBills("cancelled").length }]} />
      <div className="divide-y divide-border">{kind === "kots" ? submissions.map((group) => <Button key={group.id} variant="ghost" className="h-auto w-full justify-between rounded-none py-3 text-left" onClick={() => setDetail(group)}><span><span className="block font-semibold">{group.first.kotNo ?? group.first.billNo}</span><span className="block text-xs font-normal text-muted-foreground">{group.first.tableLabel ?? group.first.tableId ?? "Counter"} · {new Date(group.first.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {group.tickets.map((k) => k.station).join(", ")}</span></span><span>{group.tickets.reduce((n, k) => n + k.lines.reduce((q, l) => q + l.qty, 0), 0)} items</span></Button>) : datedBills(kind).map((record) => <Button key={record.uid ?? record.id} variant="ghost" className="h-auto w-full justify-between rounded-none py-3 text-left" onClick={() => setDetail(record)}><span><span className="block font-semibold">{record.billNo}</span><span className="block text-xs font-normal text-muted-foreground">{record.tableLabel ?? record.tableId ?? "Counter"} · {record.status === "held" ? "Running" : record.status === "void" ? "Cancelled" : "Settled"}</span></span><span>{formatINR(record.total, 0)}</span></Button>)}</div>
      {!(kind === "kots" ? submissions : datedBills(kind)).length ? <p className="py-6 text-center text-sm text-muted-foreground">No records for this date.</p> : null}
      {detail ? <div className="overflow-x-auto border-t border-border pt-4"><Button variant="ghost" size="sm" onClick={() => setDetail(null)}>Close details</Button><div className="mx-auto w-fit">{"tickets" in detail ? detail.tickets.map((ticket) => <SlipView key={ticket.uid ?? ticket.id} slip={kotSlip([ticket], config.paper, settings.kotHeader, config.largeKotText)} />) : <SlipView slip={billSlip(detail, settings, config.paper)} />}</div></div> : null}
    </>}
  </div>;
}