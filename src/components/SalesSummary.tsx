import { useMemo, useState } from "react";
import { Download, Printer, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Dropdown } from "@/components/Dropdown";
import { Receipt } from "@/components/Receipt";
import { printBill } from "@/components/PrintHost";
import { formatINR } from "@/lib/billing";
import { useStaff } from "@/lib/auth-context";
import { allow } from "@/lib/pin-gate";
import { paymentLabel, seriesOf, type Range } from "@/lib/report-logic";
import { rangeLabel } from "@/lib/report-excel";
import { downloadXlsx } from "@/lib/xlsx";
import {
  NO_FILTERS, ORDER_TYPE_LABELS, STATUS_LABELS, balanceOf, filterBills, itemsOf, paymentOf, summarySheet, summaryTotals, type SummaryFilters,
} from "@/lib/sales-summary-logic";
import type { Order, PaymentMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const PAYMENTS: (PaymentMode | "split")[] = ["cash", "upi", "card", "wallet", "credit", "points", "split"];
const money = (n: number) => formatINR(n, 0);

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-secondary/70 px-4 py-3 text-sm font-medium">
      {label}<input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-primary" />
    </label>
  );
}

export function SalesSummary({ orders, range, restaurant, canExport }: { orders: Order[]; range: Range; restaurant: string; canExport: boolean }) {
  const { user } = useStaff();
  const [f, setF] = useState<SummaryFilters>(NO_FILTERS);
  const [showItems, setShowItems] = useState(false);
  const [showTax, setShowTax] = useState(false);
  const [showSplit, setShowSplit] = useState(false);
  const [open, setOpen] = useState<Order | null>(null);
  const set = (patch: Partial<SummaryFilters>) => setF((x) => ({ ...x, ...patch }));
  const bills = useMemo(() => filterBills(orders, f), [orders, f]);
  const t = summaryTotals(bills);
  const series = useMemo(() => [...new Set(orders.map((o) => seriesOf(o.billNo)).filter(Boolean))].sort(), [orders]);
  const modes = useMemo(() => (showSplit ? [...new Set(bills.flatMap((o) => o.payments.map((p) => p.mode)))] : []), [bills, showSplit]);
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);

  const exportXlsx = () => downloadXlsx(`sales-summary-${new Date(range.from).toISOString().slice(0, 10)}`, [summarySheet(bills, { items: showItems, tax: showTax, split: showSplit }, restaurant, rangeLabel(range))], { title: `${restaurant} Sales Summary` });

  const tiles: [string, string][] = [
    [money(t.sales), "Total sales"], [String(t.orders), "Total orders"], [money(t.discount), "Total discount"],
    [money(t.charges), "Total charges"], [formatINR(t.tax), "Total tax"], [money(t.foodSale), "Total food sale"],
  ];
  const th = "whitespace-nowrap px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground";
  const td = "whitespace-nowrap px-3 py-2.5 text-sm tabular-nums";

  return (
    <div className="space-y-4">
      <section className="card-elevated space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-medium">Bill no. or mobile
            <span className="relative mt-1 block">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={f.billNo} onChange={(e) => set({ billNo: e.target.value })} placeholder="Search" className="h-10 w-full rounded-lg border border-input bg-card pl-9 pr-3 text-sm" />
            </span>
          </label>
          <div className="text-sm font-medium">Order type
            <Dropdown ariaLabel="Order type" className="mt-1" value={f.orderType} onChange={(v) => set({ orderType: v })}
              options={[{ value: "", label: "All types" }, ...(Object.keys(ORDER_TYPE_LABELS) as Order["orderType"][]).map((k) => ({ value: k, label: ORDER_TYPE_LABELS[k] }))]} />
          </div>
          <div className="text-sm font-medium">Payment type
            <Dropdown ariaLabel="Payment type" className="mt-1" value={f.payment} onChange={(v) => set({ payment: v })}
              options={[{ value: "", label: "All payments" }, ...PAYMENTS.map((p) => ({ value: p, label: p === "split" ? "Split payment" : paymentLabel(p) }))]} />
          </div>
          <div className="text-sm font-medium">Order status
            <Dropdown ariaLabel="Order status" className="mt-1" value={f.status} onChange={(v) => set({ status: v })}
              options={[{ value: "", label: "All statuses" }, ...(Object.keys(STATUS_LABELS) as Order["status"][]).map((k) => ({ value: k, label: STATUS_LABELS[k] }))]} />
          </div>
          <div className="text-sm font-medium">Terminal
            <Dropdown ariaLabel="Terminal" className="mt-1" value={f.series} onChange={(v) => set({ series: v })}
              options={[{ value: "", label: "All terminals" }, ...series.map((s) => ({ value: s, label: `Series ${s}` }))]} />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Toggle label="Show items" checked={showItems} onChange={setShowItems} />
          <Toggle label="Tax breakup" checked={showTax} onChange={setShowTax} />
          <Toggle label="Show split payment amount" checked={showSplit} onChange={setShowSplit} />
          <div className="flex items-center gap-2">
            {filtered ? <Button variant="ghost" onClick={() => setF(NO_FILTERS)}><X />Clear filters</Button> : null}
            {canExport ? <Button className="ml-auto" disabled={!bills.length} onClick={exportXlsx}><Download />Download Excel</Button> : null}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="grid grid-cols-2 divide-x divide-y divide-border border-b border-border sm:grid-cols-3 xl:grid-cols-6 xl:divide-y-0">
          {tiles.map(([v, l]) => <div key={l} className="px-4 py-3"><div className="text-2xl font-bold tabular-nums">{v}</div><div className="text-xs font-medium text-muted-foreground">{l}</div></div>)}
        </div>
        {t.cancelled ? <p className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">{t.cancelled} cancelled bill{t.cancelled === 1 ? "" : "s"} worth {money(t.cancelledValue)} not counted in the totals.</p> : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem]">
            <thead className="border-b border-border bg-secondary/60">
              <tr>
                {["Bill", "Date", "Type", "Customer", "Mobile no.", "Table", "Status", "Payment mode", "Subtotal", "Charges", "Discount", "Disc. %"].map((h) => <th key={h} className={th}>{h}</th>)}
                {showTax ? <><th className={th}>CGST</th><th className={th}>SGST</th></> : null}
                {["Total tax", "Total", "Balance", "Settled by"].map((h) => <th key={h} className={th}>{h}</th>)}
                {modes.map((m) => <th key={m} className={th}>{paymentLabel(m)}</th>)}
                {showItems ? <th className={th}>Items</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {bills.length ? bills.map((o) => {
                const off = o.status !== "settled";
                return (
                  <tr key={o.uid ?? o.billNo} className={cn("hover:bg-secondary/40", off && "text-muted-foreground")}>
                    <td className={td}><button type="button" onClick={() => setOpen(o)} className="font-semibold text-primary hover:underline">{o.billNo}</button></td>
                    <td className={td}>{new Date(o.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                    <td className={td}>{ORDER_TYPE_LABELS[o.orderType]}</td>
                    <td className={td}>{o.customer?.name ?? "—"}</td>
                    <td className={td}>{o.customer?.phone ?? "—"}</td>
                    <td className={td}>{o.tableLabel ?? "—"}</td>
                    <td className={td}><span className={cn("rounded px-1.5 py-0.5 text-xs font-semibold", o.status === "void" ? "bg-destructive/10 text-destructive" : o.status === "held" ? "bg-gold/25 text-gold-foreground" : "bg-success/10 text-success")}>{STATUS_LABELS[o.status]}</span></td>
                    <td className={td}>{paymentOf(o)}</td>
                    <td className={td}>{money(o.subtotal)}</td>
                    <td className={td}>{money(o.serviceCharge ?? 0)}</td>
                    <td className={td}>{money(o.discountAmt)}</td>
                    <td className={td}>{o.discountPct ? `${o.discountPct}%` : "0"}</td>
                    {showTax ? <><td className={td}>{formatINR(o.cgst)}</td><td className={td}>{formatINR(o.sgst)}</td></> : null}
                    <td className={td}>{formatINR(o.cgst + o.sgst)}</td>
                    <td className={cn(td, "font-semibold", o.status === "void" && "line-through")}>{money(o.total)}</td>
                    <td className={td}>{money(balanceOf(o))}</td>
                    <td className={td}>{o.closedBy ?? "—"}</td>
                    {modes.map((m) => <td key={m} className={td}>{money(o.payments.filter((p) => p.mode === m).reduce((s, p) => s + p.amount, 0))}</td>)}
                    {showItems ? <td className="min-w-[18rem] px-3 py-2.5 text-xs">{itemsOf(o)}</td> : null}
                  </tr>
                );
              }) : <tr><td colSpan={30} className="px-3 py-10 text-center text-sm text-muted-foreground">{filtered ? "No bills match these filters." : "No bills in this period."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={!!open} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        <DialogContent className="max-h-[92vh] max-w-sm overflow-y-auto">
          {open ? <>
            <DialogTitle>Bill {open.billNo}</DialogTitle>
            {open.status === "void" && open.voidReason ? <p className="-mt-2 text-sm text-destructive">Cancelled: {open.voidReason}{open.closedBy ? `, by ${open.closedBy}` : ""}</p> : null}
            <Receipt order={open} />
            <Button onClick={() => void allow(user, "bill.reprintOld", `Reprint bill ${open.billNo}`).then((ok) => { if (ok) void printBill(open); })}><Printer />Reprint</Button>
          </> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
