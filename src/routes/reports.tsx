import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { AppShell } from "@/components/AppShell";
import { getDb } from "@/lib/db";
import { formatINR } from "@/lib/billing";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — Restro POS by XTSY" },
      { name: "description", content: "Today's sales, bills, average order value, top items and payment split." },
      { property: "og:title", content: "Sales Reports — Restro POS" },
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
    hours[new Date(o.createdAt).getHours()].v += o.total;
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
        <h1 className="mb-5 text-2xl font-bold">Today</h1>
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
      </div>
    </AppShell>
  );
}
