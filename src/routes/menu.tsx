import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { AppShell } from "@/components/AppShell";
import { VegMark } from "@/components/VegMark";
import { Switch } from "@/components/ui/switch";
import { getDb, markDirty } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";

export const Route = createFileRoute("/menu")({
  head: () => ({
    meta: [
      { title: "Menu — XTSY POS" },
      { name: "description", content: "Manage dishes, prices, GST rates and availability." },
      { property: "og:title", content: "Menu — XTSY POS" },
      { property: "og:description", content: "Edit your restaurant menu, prices and GST in one place." },
    ],
  }),
  component: MenuPage,
});

function MenuPage() {
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const { user } = useStaff();
  const canPrice = !user || isAdmin(user);
  const categories = [...CATEGORIES.filter((c) => menu.some((m) => m.category === c)), ...[...new Set(menu.map((m) => m.category))].filter((c) => !CATEGORIES.includes(c)).sort()];
  const update = async (id: string, changes: { price?: number; available?: boolean }) => {
    await getDb().menu.update(id, changes);
    await markDirty(["menu", id]);
  };
  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <h1 className="mb-1 text-2xl font-bold">Menu</h1>
        <p className="mb-6 text-sm text-muted-foreground">Price and availability changes reach every device within seconds.</p>
        {menu.length === 0 ? <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No dishes yet. Owners can add the sample menu from Settings.</p> : null}
        {categories.map((c) => (
          <section key={c} className="mb-6">
            <h2 className="mb-2 text-base font-bold">{c}</h2>
            <div className="card-elevated divide-y divide-border">
              {menu.filter((m) => m.category === c).map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-4 py-3">
                  <VegMark veg={m.veg} />
                  <div className="min-w-0 flex-1">
                    <div className={`truncate text-sm font-medium ${m.available ? "" : "text-muted-foreground line-through"}`}>{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.station} · GST {m.gstRate}%</div>
                  </div>
                  <input type="number" aria-label={`Price of ${m.name}`} defaultValue={m.price}
                    disabled={!canPrice}
                    onBlur={(e) => { const price = Math.max(0, Number(e.target.value)); if (price !== m.price) void update(m.id, { price }); }}
                    className="w-20 rounded-lg border border-input bg-card px-2 py-1 text-right text-sm" />
                  <span className="hidden w-16 text-right text-xs text-muted-foreground sm:block">{formatINR(m.price, 0)}</span>
                  <Switch aria-label={`${m.name} available`} checked={m.available} onCheckedChange={(v) => void update(m.id, { available: v })} />
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
