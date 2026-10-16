import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Printer, Search } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { Receipt } from "@/components/Receipt";
import { ReasonPrompt } from "@/components/PaymentDialogs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { voidSettledBill } from "@/lib/bill-actions";
import type { Order } from "@/lib/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — XTSY POS" },
      { name: "description", content: "Today's sales, bills, average order value, top items and payment split." },
      { property: "og:title", content: "Reports — XTSY POS" },
      { property: "og:description", content: "Daily sales dashboard for your restaurant." },
    ],
  }),
  component: ReportsPage,
});

const PIE = ["var(--color-primary)", "var(--color-gold)", "var(--color-success)", "var(--color-warning)", "var(--color-muted-foreground)"];

function ReportsPage() {
  const orders = useLiveQuery(async () => {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return getDb().orders.where("createdAt").aboveOrEqual(start.getTime()).toArray();
  }, [], []);
  const settled = orders.filter((o) => o.status === "settled");
  const sales = settled.reduce((s, o) => s + o.total, 0);
  const gst = settled.reduce((s, o) => s + o.cgst + o.sgst, 0);
  const aov = settled.length ? sales / settled.length : 0;

  const itemMap = new Map<string, number>();
  const payMap = new Map<string, number>();
  const hours = Array.from({ length: 24 }, (_, h) => ({ h: `${h}`, v: 0 }));
  for (const o of settled) {
    for (const l of o.lines) itemMap.set(l.name, (itemMap.get(l.name) ?? 0) + l.qty);
    for (const p of o.payments) payMap.set(p.mode.toUpperCase(), (payMap.get(p.mode.toUpperCase()) ?? 0) + p.amount);
    hours[new Date(o.createdAt).getHours()]!.v += o.total;
  }
  const top = [...itemMap].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const pays = [...payMap].map(([name, value]) => ({ name, value }));

  const stats = [
    { l: "Today's sales", v: formatINR(sales, 0) },
    { l: "Bills", v: String(settled.length) },
    { l: "Avg order value", v: formatINR(aov, 0) },
    { l: "GST collected", v: formatINR(gst) },
  ];

  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <h1 className="mb-1 text-2xl font-bold">Today</h1>
        <p className="mb-5 text-sm text-muted-foreground">Settled bills from every device in the restaurant that has synced.</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.l} className="card-elevated p-4">
              <div className="text-xs font-medium text-muted-foreground">{s.l}</div>
              <div className="mt-1 text-2xl font-bold">{s.v}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="card-elevated p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold">Hourly sales</h2>
            <div className="h-56">
              <ResponsiveContainer>
                <BarChart data={hours.slice(8, 24)}>
                  <XAxis dataKey="h" tickLine={false} axisLine={false} fontSize={11} />
                  <Tooltip formatter={(v: number) => formatINR(v, 0)} />
                  <Bar dataKey="v" fill="var(--color-primary)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card-elevated p-4">
            <h2 className="mb-3 text-sm font-semibold">Payment split</h2>
            {pays.length ? (
              <div className="h-56">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pays} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80}>
                      {pays.map((_, i) => <Cell key={i} fill={PIE[i % PIE.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatINR(v, 0)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="py-16 text-center text-sm text-muted-foreground">No bills yet today</p>}
          </div>
        </div>
        <div className="card-elevated mt-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Top items</h2>
          {top.length ? (
            <ul className="divide-y divide-border">
              {top.map(([n, q]) => <li key={n} className="flex justify-between py-2 text-sm"><span>{n}</span><span className="font-semibold">{q}</span></li>)}
            </ul>
          ) : <p className="text-sm text-muted-foreground">Settle a bill to see top sellers.</p>}
        </div>
        <BillsList orders={orders} />
      </div>
    </AppShell>
  );
}

const STATUS_LABEL: Record<Order["status"], string> = { settled: "Settled", held: "Running", void: "Void" };

function BillsList({ orders }: { orders: Order[] }) {
  const { user } = useStaff();
  const canVoid = !user || isAdmin(user);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Order | null>(null);
  const [voiding, setVoiding] = useState(false);
  const term = q.trim().toLowerCase();
  const shown = [...orders]
    .sort((a, b) => b.createdAt - a.createdAt)
    .filter((o) => !term || o.billNo.toLowerCase().includes(term) || (o.customer?.phone ?? "").includes(term) || (o.tableLabel ?? o.tableId ?? "").toLowerCase() === term);
  const live = open ? orders.find((o) => o.uid === open.uid) ?? open : null;

  const doVoid = async (reason: string) => {
    if (!live) return;
    try {
      await voidSettledBill(live, reason, user?.displayName);
      toast.success(`Bill ${live.billNo} voided`);
      setVoiding(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't void this bill.");
    }
  };

  return (
    <section className="card-elevated mt-4 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Today's bills</h2>
        <div className="relative w-full max-w-xs">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Bill number, phone or table" className="w-full rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-sm" />
        </div>
      </div>
      {shown.length ? (
        <ul className="divide-y divide-border">
          {shown.map((o) => (
            <li key={o.uid ?? o.billNo}>
              <button type="button" onClick={() => setOpen(o)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm hover:bg-secondary/60">
                <span className="w-16 shrink-0 text-muted-foreground">{new Date(o.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{o.billNo}<span className="ml-2 font-normal text-muted-foreground">{o.tableLabel ?? o.tableId ?? o.orderType}</span></span>
                <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${o.status === "void" ? "bg-destructive/10 text-destructive" : o.status === "held" ? "bg-gold/25 text-gold-foreground" : "bg-secondary text-muted-foreground"}`}>{STATUS_LABEL[o.status]}</span>
                <span className={`w-20 text-right font-semibold ${o.status === "void" ? "text-muted-foreground line-through" : ""}`}>{formatINR(o.total, 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="py-6 text-center text-sm text-muted-foreground">{term ? `No bills match "${q}"` : "No bills yet today."}</p>}

      <Dialog open={!!live} onOpenChange={(o) => { if (!o) { setOpen(null); setVoiding(false); } }}>
        <DialogContent className="max-h-[92vh] max-w-sm overflow-y-auto">
          {live && voiding ? (
            <ReasonPrompt title={`Void bill ${live.billNo}`} description="The bill stays in your records as void with this reason, and any tracked stock goes back."
              confirmLabel="Void this bill" onConfirm={(reason) => void doVoid(reason)} />
          ) : live ? <>
            <DialogTitle>Bill {live.billNo}</DialogTitle>
            {live.status === "void" && live.voidReason ? <p className="-mt-2 text-sm text-destructive">Void: {live.voidReason}{live.closedBy ? `, by ${live.closedBy}` : ""}</p> : null}
            <Receipt order={live} />
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => window.print()}><Printer />Reprint</Button>
              {canVoid && live.status === "settled" ? <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setVoiding(true)}>Void</Button> : null}
            </div>
          </> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
