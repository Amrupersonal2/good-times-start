import { useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useNavigate } from "@tanstack/react-router";
import { reportOrders } from "@/lib/report-orders";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { dayBounds, dateLabel, historyBills, paidBy, type HistoryKind, type PaymentFilter } from "@/lib/orders-history";
import { Button } from "./ui/button";
import { DialogTitle } from "./ui/dialog";
import { Segmented } from "./Segmented";
import { SlipView } from "./Slip";
import { billSlip, kotSlip } from "@/lib/slip";
import { usePrintConfig } from "@/lib/print-config";
import { useRestaurantSettings } from "@/lib/use-settings";
import { kotSubmissions, type KotSubmission } from "@/lib/kot-history";
import type { Order, Kot } from "@/lib/types";
import { useReservations } from "@/lib/use-reservations";
import { activeReservations } from "@/lib/reservations";
import { ChevronDown, Printer, X } from "lucide-react";
import { toast } from "sonner";
import { printKots } from "./PrintHost";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { allow } from "@/lib/pin-gate";
import { useAppMode } from "@/lib/app-mode";
import { thermalDestination } from "@/lib/print-routing";
import { BillPrintButton } from "./BillPrintButton";
import { billLabel } from "@/lib/bill-numbering";

export interface OrdersOverviewProps { onClose: () => void }
export function OrdersOverview({ onClose }: OrdersOverviewProps) {
  const [view, setView] = useState<"running" | "history">("running");
  const bookings = useReservations();
  const active = activeReservations(bookings.rows, Date.now());
  const [kind, setKind] = useState<HistoryKind>("settled");
  const [paid, setPaid] = useState<PaymentFilter>("all");
  const [period, setPeriod] = useState("today");
  const [custom, setCustom] = useState(dateLabel());
  const [detail, setDetail] = useState<Order | KotSubmission | null>(null);
  const date = period === "custom" ? custom : dateLabel(period === "yesterday" ? -1 : period === "before" ? -2 : 0);
  const [start, end] = dayBounds(date);
  const running = useLiveQuery(() => getDb().orders.where("status").equals("held").sortBy("createdAt"), [], []);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  // Bills settled that day, plus cancelled bills (few) so a bill cancelled today but opened earlier shows today.
  const history = useLiveQuery(async () => ({ bills: [...new Map([...await reportOrders({ from: start, to: end - 1 }), ...await getDb().orders.where("status").equals("void").toArray()].map((o) => [o.uid ?? o.id ?? o.billNo, o])).values()], kots: await getDb().kots.where("createdAt").between(start, end, true, false).reverse().toArray() }), [start, end], { bills: [], kots: [] });
  const datedBills = (type: HistoryKind) => historyBills(history.bills, type, [start, end]);
  const shownBills = kind === "settled" ? datedBills("settled").filter((o) => paidBy(o, paid)) : datedBills(kind);
  // Oldest first, matching the bills list: the day reads in the order it happened.
  const submissions = kotSubmissions(history.kots).reverse();
  const settings = useRestaurantSettings(); const config = usePrintConfig();
  const { user } = useStaff();
  const app = useAppMode(user);
  const [printing, setPrinting] = useState<string | null>(null);
  const canPrint = thermalDestination(app) !== "blocked" && can(user, "kot.reprint");
  const reprint = async (tickets: Kot[], id: string) => {
    if (printing || !canPrint) return;
    setPrinting(id);
    try {
      if (await allow(user, "kot.reprint", `Print ${tickets[0]?.kotNo ?? "KOT"} again`)) await printKots(tickets, "reprint");
    } catch { toast.error("Could not send KOT to printer. Please try again."); }
    finally { setPrinting(null); }
  };
  const listRef = useRef<HTMLDivElement>(null);
  const recordKey = (record: Order | KotSubmission) => "tickets" in record ? `kot:${record.id}` : `bill:${record.uid ?? record.id ?? record.billNo}`;
  const selectRecord = (record: Order | KotSubmission, button: HTMLButtonElement) => {
    const expanded = detail !== null && recordKey(detail) === recordKey(record);
    setDetail(expanded ? null : record);
    // Align only the scrolling list, never the dialog or the page behind it.
    if (!expanded) requestAnimationFrame(() => {
      const list = listRef.current;
      if (!list) return;
      list.scrollTop += button.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
  };
  const preview = (record: Order | KotSubmission) => (
    <section aria-label={`Preview ${"tickets" in record ? record.first.kotNo ?? record.first.billNo : record.billNo}`} className="border-t border-border bg-secondary/40 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{"tickets" in record ? record.first.kotNo ?? record.first.billNo : billLabel(record)}</span>
        {!("tickets" in record) ? <BillPrintButton order={record} className="ml-auto" /> : null}
        <Button variant="ghost" size="icon" aria-label="Close details" title="Close details" onClick={() => setDetail(null)}><X className="size-4" /></Button>
      </div>
      <div className="max-w-full overflow-x-auto [scrollbar-gutter:stable]">
        <div className="mx-auto w-fit">
          {"tickets" in record ? record.tickets.map((ticket, index) => (
            <div key={ticket.uid ?? ticket.id ?? index} className="mb-3 last:mb-0">
              {canPrint ? <Button variant="outline" size="sm" className="mb-2" aria-label={`Print ${ticket.kotNo ?? ticket.billNo} ${ticket.station}`} disabled={printing !== null} onClick={() => void reprint([ticket], `${record.id}:${index}`)}><Printer className="size-4" />Print {ticket.station}</Button> : null}
              <SlipView slip={kotSlip([ticket], config.paper, settings.kotHeader, config.largeKotText)} />
            </div>
          )) : <SlipView slip={billSlip(record, settings, config.paper)} />}
        </div>
      </div>
    </section>
  );
  const navigate = useNavigate();
  const open = (order: Order) => { onClose(); void navigate({ to: "/", search: order.tableId && order.source !== "qr" ? { table: order.tableId } : { bill: order.uid ?? "" } }); };
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <DialogTitle className="shrink-0 pr-8">Orders</DialogTitle>
    <Segmented className="shrink-0" ariaLabel="Orders view" stretch value={view} onChange={(v) => { setView(v); setDetail(null); }} options={[{ value: "running", label: "Running", badge: running.length }, { value: "history", label: "History" }]} />
    {view === "running" ? <div className="min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      {active.length ? <Button variant="outline" className="mb-3 w-full" onClick={() => { onClose(); window.dispatchEvent(new Event("pos:bookings")); }}>{active.length} guest booking{active.length === 1 ? "" : "s"} · View & start order</Button> : null}
      {running.map((o) => <div key={o.uid ?? o.billNo} className="flex h-16 items-center gap-2"><Button variant="ghost" className="h-16 min-w-0 flex-1 justify-between gap-3 rounded-none text-left" onClick={() => open(o)}><span className="min-w-0"><span className="block truncate font-bold">{o.tableLabel ?? tables.find((t) => t.id === o.tableId)?.label ?? o.orderType}</span><span className="block truncate text-xs font-normal text-muted-foreground">{billLabel(o)} · {o.lines.reduce((n, l) => n + l.qty, 0)} items{o.customer?.name ? ` · ${o.customer.name}` : ""}</span></span><span>{formatINR(o.total, 0)}</span></Button><BillPrintButton order={o} className="shrink-0" /></div>)}
      {tables.filter((t) => t.status === "occupied" && !running.some((o) => o.tableId === t.id)).map((t) => <div key={t.id} className="flex justify-between py-3 text-sm"><strong>{t.label}</strong><span>{t.heldBy ?? "Taking order"} · {formatINR(t.runningTotal, 0)}</span></div>)}
      {!running.length && !tables.some((t) => t.status === "occupied") ? <p className="py-8 text-center text-sm text-muted-foreground">No running bills.</p> : null}
    </div> : <>
      <Segmented className="shrink-0" ariaLabel="History dates" value={period} onChange={(v) => { setPeriod(v); setDetail(null); }} options={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "before", label: "Day before" }, { value: "custom", label: "Custom" }]} />
      {period === "custom" ? <label className="block text-sm">Date<input type="date" aria-label="History date" value={custom} onChange={(e) => { if (e.target.value) { setCustom(e.target.value); setDetail(null); } }} className="ml-3 rounded-md border border-input bg-card p-2" /></label> : null}
      <Segmented className="shrink-0" ariaLabel="History type" value={kind} onChange={(v) => { setKind(v); setDetail(null); }} options={[{ value: "kots", label: "KOTs", badge: submissions.length }, { value: "settled", label: "Settled", badge: datedBills("settled").length }, { value: "nc", label: "NC", badge: datedBills("nc").length }, { value: "cancelled", label: "Cancelled", badge: datedBills("cancelled").length }]} />
      {kind === "settled" ? <Segmented className="shrink-0" ariaLabel="Paid by" value={paid} onChange={(v) => { setPaid(v); setDetail(null); }} options={[{ value: "all", label: "All" }, { value: "cash", label: "Cash", badge: datedBills("settled").filter((o) => paidBy(o, "cash")).length }, { value: "upi", label: "UPI", badge: datedBills("settled").filter((o) => paidBy(o, "upi")).length }, { value: "other", label: "Card & other", badge: datedBills("settled").filter((o) => paidBy(o, "other")).length }]} /> : null}
      <div ref={listRef} aria-label="Order history records" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]">
        <div className="divide-y divide-border">
          {kind === "kots" ? submissions.map((group) => {
            const selected = detail !== null && recordKey(detail) === recordKey(group);
            return <div key={group.id}>
              <div className="flex h-16 items-center gap-2">
                <Button variant="ghost" aria-expanded={selected} className={`h-16 min-w-0 flex-1 justify-between gap-3 rounded-none text-left ${selected ? "bg-accent" : ""}`} onClick={(event) => selectRecord(group, event.currentTarget)}>
                  <span className="min-w-0"><span className="block truncate font-semibold">{group.first.kotNo ?? group.first.billNo}</span><span className="block truncate text-xs font-normal text-muted-foreground" title={group.tickets.map((k) => k.station).join(", ")}>{group.first.tableLabel ?? group.first.tableId ?? "Counter"} · {new Date(group.first.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · {group.tickets.map((k) => k.station).join(", ")}</span></span>
                  <span className="flex shrink-0 items-center gap-2"><span>{group.tickets.reduce((n, k) => n + k.lines.reduce((q, l) => q + l.qty, 0), 0)} items</span><ChevronDown className={`size-4 ${selected ? "rotate-180" : ""}`} /></span>
                </Button>
                {canPrint ? <Button variant="outline" size="icon" className="shrink-0" aria-label={`Print ${group.first.kotNo ?? group.first.billNo}`} title="Print KOT to kitchen" disabled={printing !== null} onClick={() => void reprint(group.tickets, group.id)}><Printer className="size-4" /></Button> : null}
              </div>
              {selected ? preview(group) : null}
            </div>;
          }) : shownBills.map((record) => {
            const selected = detail !== null && recordKey(detail) === recordKey(record);
            return <div key={record.uid ?? record.id}>
              <div className="flex h-16 items-center gap-2"><Button variant="ghost" aria-expanded={selected} className={`h-16 min-w-0 flex-1 justify-between gap-3 rounded-none text-left ${selected ? "bg-accent" : ""}`} onClick={(event) => selectRecord(record, event.currentTarget)}>
                <span className="min-w-0"><span className="block truncate font-semibold">{billLabel(record)}</span><span className="block truncate text-xs font-normal text-muted-foreground">{record.tableLabel ?? record.tableId ?? "Counter"} · {record.status === "held" ? "Running" : record.status === "void" ? "Cancelled" : "Settled"}</span></span>
                <span className="flex shrink-0 items-center gap-2"><span className="tabular-nums">{formatINR(record.total, 0)}</span><ChevronDown className={`size-4 ${selected ? "rotate-180" : ""}`} /></span>
              </Button>
              <BillPrintButton order={record} className="shrink-0" /></div>
              {selected ? preview(record) : null}
            </div>;
          })}
        </div>
        {!(kind === "kots" ? submissions : shownBills).length ? <p className="py-6 text-center text-sm text-muted-foreground">No records for this date.</p> : null}
      </div>
    </>}
  </div>;
}