import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { Bell, Check, ChefHat, LogIn, Minus, Plus, Search, Tablet, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VegMark } from "@/components/VegMark";
import { ItemOptions } from "@/components/ItemOptions";
import { InstallButton } from "@/components/AppInstall";
import { printKots } from "@/components/PrintHost";
import { useStaff } from "@/lib/auth-context";
import { useCart } from "@/lib/cart-store";
import { getDb, markDirty } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { needsOptions, orderCategories, outsideHours, priceFor, stockLeft } from "@/lib/menu-logic";
import { useRestaurantSettings } from "@/lib/use-settings";
import type { MenuItem, RestaurantTable } from "@/lib/types";

export const Route = createFileRoute("/waiter")({
  head: () => ({
    meta: [
      { title: "XTSY Waiter" },
      { name: "description", content: "Take table orders on a tablet and send them straight to the kitchen." },
    ],
  }),
  component: WaiterApp,
});

const STATUS_STYLE: Record<RestaurantTable["status"], string> = {
  free: "bg-card text-foreground ring-1 ring-border",
  occupied: "bg-primary text-primary-foreground",
  billed: "bg-foreground text-background",
  reserved: "border-2 border-dashed border-gold text-gold",
};

function minutes(since?: number) {
  if (!since) return "";
  const m = Math.max(0, Math.round((Date.now() - since) / 60000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}

function useIsTablet() {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 700px)");
    const update = () => setWide(q.matches);
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return wide;
}

function WaiterApp() {
  const { user, loading } = useStaff();
  const settings = useRestaurantSettings();
  const tablet = useIsTablet();
  const [anyway, setAnyway] = useState(false);
  const [tableId, setTableIdState] = useState<string | undefined>(undefined);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(t); }, []);

  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const sections = useMemo(() => [...new Set(tables.map((t) => t.section))], [tables]);

  if (!tablet && !anyway) {
    return (
      <div className="dark flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
        <Tablet className="size-10 text-primary" />
        <p className="text-xl font-bold">XTSY Waiter is made for tablets</p>
        <p className="max-w-xs text-sm text-muted-foreground">Open it on a tablet, or turn your phone sideways. Owners can follow the restaurant on XTSY Insights.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setAnyway(true)}>Use it anyway</Button>
          <Button variant="outline" asChild><Link to="/insights">Open Insights</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold">{settings.name || "XTSY Waiter"}</div>
          <div className="text-xs text-muted-foreground">{user ? `${user.displayName}, ${user.role === "unknown" ? "no restaurant yet" : user.role}` : loading ? "" : "Not signed in: orders stay on this tablet"}</div>
        </div>
        <div className="flex items-center gap-2">
          <InstallButton />
          {!user && !loading ? <Button size="sm" variant="secondary" asChild><Link to="/auth"><LogIn />Sign in</Link></Button> : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border p-3 xl:w-64" aria-label="Tables">
          {tables.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No tables yet. Set up the floor on the counter POS.</p> : null}
          {sections.map((sec) => (
            <section key={sec} className="mb-4">
              <h2 className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{sec}</h2>
              <div className="grid grid-cols-2 gap-2">
                {tables.filter((t) => t.section === sec).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((t) => (
                  <button key={t.id} onClick={() => setTableIdState(t.id)} aria-pressed={tableId === t.id}
                    className={`relative flex h-16 flex-col items-center justify-center rounded-xl transition-transform active:scale-95 ${STATUS_STYLE[t.status]} ${tableId === t.id ? "outline outline-2 outline-offset-2 outline-foreground" : ""}`}>
                    <span className="text-lg font-extrabold leading-none">{t.label}</span>
                    <span className="mt-1 text-[11px] font-semibold opacity-80">
                      {t.status === "occupied" || t.status === "billed" ? `${formatINR(t.runningTotal, 0)} · ${minutes(t.since)}` : t.status === "reserved" ? "Reserved" : <><Users className="inline size-3" /> {t.seats}</>}
                    </span>
                    {t.status === "billed" ? <Bell className="absolute right-1.5 top-1.5 size-3.5" aria-label="Bill asked" /> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        {tableId ? <OrderPad key={tableId} tableId={tableId} /> : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <p className="text-2xl font-extrabold">Pick a table</p>
            <p className="max-w-sm text-sm text-muted-foreground">Blue tables have guests. White tables have asked for the bill.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderPad({ tableId }: { tableId: string }) {
  const cart = useCart(tableId);
  const settings = useRestaurantSettings();
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const inventory = useLiveQuery(() => getDb().inventory.toArray(), [], []);
  const table = useLiveQuery(() => getDb().restTables.get(tableId), [tableId]);
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [sending, setSending] = useState(false);

  const categories = useMemo(() => orderCategories(menu.map((m) => m.category), settings.categoryOrder), [menu, settings.categoryOrder]);
  const activeCat = cat || categories[0] || "";
  const term = q.trim().toLowerCase();
  const items = menu.filter((m) => m.available && (term ? m.name.toLowerCase().includes(term) : m.category === activeCat));
  const sent = cart.activeOrder?.kotSubmittedQty ?? {};
  const unsent = cart.pendingKitchenLines.reduce((s, l) => s + l.qty, 0);
  const cancels = cart.pendingCancelLines.reduce((s, l) => s + l.qty, 0);

  const add = (item: MenuItem) => {
    const left = stockLeft(item.id, inventory);
    const inBill = cart.lines.filter((l) => (l.menuItemId ?? l.itemId) === item.id).reduce((s, l) => s + l.qty, 0);
    if (left !== null && inBill >= left) { toast.error(left === 0 ? `${item.name} is sold out` : `Only ${left} ${item.name} left`); return; }
    if (needsOptions(item)) setChoosing(item); else cart.addItem(item);
  };

  const send = async () => {
    setSending(true);
    try {
      const kots = await cart.sendKitchen();
      if (kots.length) void printKots(kots, "sent");
    } finally {
      setSending(false);
    }
  };

  const askForBill = async () => {
    await getDb().restTables.update(tableId, { status: "billed" });
    await markDirty(["table", tableId]);
    toast.success(`Table ${table?.label ?? tableId} asked for the bill`);
  };

  return (
    <div className="flex min-w-0 flex-1">
      <section className="flex min-w-0 flex-1 flex-col bg-secondary/40" aria-label="Menu">
        <div className="space-y-2 p-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a dish" className="w-full rounded-xl border border-input bg-card py-3 pl-9 pr-3 text-base" />
          </div>
          {!term ? (
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button key={c} onClick={() => setCat(c)} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${c === activeCat ? "bg-primary text-primary-foreground" : "bg-card text-foreground ring-1 ring-border"}`}>{c}</button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto px-3 pb-3 lg:grid-cols-3 2xl:grid-cols-4">
          {items.map((m) => {
            const off = outsideHours(m);
            const left = stockLeft(m.id, inventory);
            return (
              <button key={m.id} onClick={() => add(m)} disabled={left === 0}
                className={`flex min-h-20 flex-col justify-between rounded-xl bg-card p-3 text-left ring-1 ring-border transition-transform active:scale-[0.97] disabled:opacity-40 ${off ? "opacity-60" : ""}`}>
                <span className="flex items-start gap-2"><span className="mt-1"><VegMark veg={m.veg} /></span><span className="text-[15px] font-semibold leading-snug">{m.name}</span></span>
                <span className="mt-1 flex items-center justify-between text-sm">
                  <span className="font-bold">{m.variants?.length ? `from ${formatINR(m.price, 0)}` : formatINR(priceFor(m, "dine-in"), 0)}</span>
                  <span className="text-xs text-muted-foreground">{left === 0 ? "Sold out" : off && m.hours ? `${m.hours.from}–${m.hours.to}` : needsOptions(m) ? "Options" : ""}</span>
                </span>
              </button>
            );
          })}
          {items.length === 0 ? <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{term ? `No dishes match "${q}"` : "No dishes in this section"}</p> : null}
        </div>
      </section>

      <section className="flex w-80 shrink-0 flex-col border-l border-border xl:w-96" aria-label={`Order for table ${table?.label ?? tableId}`}>
        <div className="flex items-end justify-between gap-2 px-4 pb-3 pt-4">
          <div>
            <div className="text-xs text-muted-foreground">{cart.activeOrder ? `Bill ${cart.activeOrder.billNo}` : "New order"}</div>
            <div className="text-4xl font-extrabold leading-none">{table?.label ?? tableId}</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">{cart.lines.reduce((s, l) => s + l.qty, 0)} items</div>
            <div className="text-2xl font-extrabold">{formatINR(cart.totals.total, 0)}</div>
          </div>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto px-3">
          {cart.lines.length === 0 ? <li className="py-10 text-center text-sm text-muted-foreground">Tap dishes to start this table's order</li> : null}
          {cart.lines.map((l) => {
            const kitchenHas = sent[l.itemId] ?? 0;
            const fresh = Math.max(0, l.qty - kitchenHas);
            return (
              <li key={l.itemId} className={`rounded-xl p-3 ${fresh ? "bg-primary/15 ring-1 ring-primary/50" : "bg-card"}`}>
                <div className="flex items-start gap-2">
                  <span className="mt-1"><VegMark veg={l.veg} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold leading-snug">{l.name}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      {kitchenHas ? <><Check className="size-3" />{kitchenHas} with kitchen</> : null}
                      {fresh ? <span className="font-semibold text-primary">{kitchenHas ? `, ${fresh} new` : `${fresh} new`}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center rounded-lg bg-secondary">
                    <button aria-label={`Fewer ${l.name}`} onClick={() => cart.setQty(l.itemId, l.qty - 1)} className="p-2.5"><Minus className="size-4" /></button>
                    <span className="w-6 text-center font-bold">{l.qty}</span>
                    <button aria-label={`More ${l.name}`} onClick={() => cart.setQty(l.itemId, l.qty + 1)} className="p-2.5"><Plus className="size-4" /></button>
                  </div>
                </div>
                <input placeholder="Note for the kitchen" value={l.note ?? ""} onChange={(e) => cart.setNote(l.itemId, e.target.value)}
                  className="mt-2 w-full rounded-lg border border-input bg-transparent px-2 py-1.5 text-xs placeholder:text-muted-foreground" />
              </li>
            );
          })}
        </ul>
        <div className="space-y-2 border-t border-border p-3">
          {cancels ? <p className="text-xs font-semibold text-warning">{cancels} item{cancels === 1 ? "" : "s"} to cancel with the kitchen</p> : null}
          <button onClick={() => void send()} disabled={sending || (!unsent && !cancels)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-extrabold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40">
            <ChefHat className="size-5" />{sending ? "Sending…" : unsent ? `Send ${unsent} to kitchen` : cancels ? "Send cancellation" : "Kitchen has everything"}
          </button>
          <button onClick={() => void askForBill()} disabled={!cart.activeOrder || unsent > 0 || table?.status === "billed"}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold ring-1 ring-border disabled:opacity-40">
            <Bell className="size-4" />{table?.status === "billed" ? "Counter has been told" : "Guest asked for the bill"}
          </button>
        </div>
      </section>

      <Dialog open={!!choosing} onOpenChange={(o) => { if (!o) setChoosing(null); }}>
        <DialogContent className="max-w-sm">
          {choosing ? <ItemOptions key={choosing.id} item={choosing} orderType="dine-in" onAdd={(v, a) => { cart.addItem(choosing, v, a); setChoosing(null); }} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
