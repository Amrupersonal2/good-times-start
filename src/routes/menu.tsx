import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { AppShell } from "@/components/AppShell";
import { VegMark } from "@/components/VegMark";
import { Switch } from "@/components/ui/switch";
import { ensureSeed, getDb } from "@/lib/db";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "Menu — Restro POS by XTSY" },
      { name: "description", content: "Manage dishes, prices, GST rates and availability." },
      { property: "og:title", content: "Menu Management — Restro POS" },
      { property: "og:description", content: "Edit your restaurant menu, prices and GST in one place." },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  useEffect(() => { void ensureSeed(); }, []);
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <h1 className="mb-5 text-2xl font-bold">Menu</h1>
        {CATEGORIES.map((c) => (
          <section key={c} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{c}</h2>
            <div className="card-elevated divide-y divide-border">
              {menu.filter((m) => m.category === c).map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <VegMark veg={m.veg} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${m.available ? "" : "text-muted-foreground line-through"}`}>{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.station} · GST {m.gstRate}%</div>
                  </div>
                  <input type="number" aria-label={`Price of ${m.name}`} defaultValue={m.price}
                    onBlur={(e) => getDb().menu.update(m.id, { price: Math.max(0, Number(e.target.value)) })}
                    className="w-20 rounded-lg border border-input bg-card px-2 py-1 text-right text-sm" />
                  <span className="hidden w-16 text-right text-xs text-muted-foreground sm:block">{formatINR(m.price, 0)}</span>
                  <Switch aria-label={`${m.name} available`} checked={m.available} onCheckedChange={(v) => getDb().menu.update(m.id, { available: v })} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
