import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import { ArrowLeft, Bell, Check, ChefHat, LogOut, Minus, Plus, Search, Users } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { VegMark } from "@/components/VegMark";
import { ItemOptions } from "@/components/ItemOptions";
import { InstallButton } from "@/components/AppInstall";
import { printKots } from "@/components/PrintHost";
import { useStaff } from "@/lib/auth-context";
import { allow } from "@/lib/pin-gate";
import { useCart } from "@/lib/cart-store";
import { getDb, markDirty } from "@/lib/db";
import { formatINR } from "@/lib/billing";
import { needsOptions, orderCategories, outsideHours, priceFor, stockLeft } from "@/lib/menu-logic";
import { useRestaurantSettings } from "@/lib/use-settings";
import type { MenuItem, RestaurantTable } from "@/lib/types";
import { ConfirmButton } from "@/components/ConfirmButton";
import { holdLabel } from "@/lib/table-hold";

export const Route = createFileRoute("/waiter")({
  head: () => ({
    meta: [
      { title: "POS Waiter" },
      { name: "description", content: "Take table orders on a tablet and send them straight to the kitchen." }, { property: "og:title", content: "POS Waiter" }, { property: "og:description", content: "Take table orders on a tablet and send them straight to the kitchen." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },],
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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tableId, setTableIdState] = useState<string | undefined>(undefined);
  const [, tick] = useState(0);
  useEffect(() => { const t = window.setInterval(() => tick((n) => n + 1), 30_000); return () => window.clearInterval(t); }, []);

  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const sections = useMemo(() => [...new Set(tables.map((t) => t.section))], [tables]);

  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="dark flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-base font-extrabold">{settings.name || "POS Waiter"}</div>
          <div className="text-xs text-muted-foreground">{user ? `POS Waiter · ${user.displayName}` : loading ? "" : "POS Waiter"}</div>
        </div>
        <div className="flex items-center gap-2">
          <InstallButton />
          {user ? <Button size="icon" variant="ghost" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut /></Button> : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className={`${tableId ? "hidden md:flex" : "flex w-full"} shrink-0 flex-col overflow-y-auto border-r border-border p-3 md:w-56 xl:w-64`} aria-label="Tables">
          {tables.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No tables yet. Set up the floor on the counter POS.</p> : null}
          {sections.map((sec) => (
            <section key={sec} className="mb-4">
              <h2 className="mb-2 px-1 text-xs font-semibold text-muted-foreground">{sec}</h2>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-2">
                {tables.filter((t) => t.section === sec).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })).map((t) => (
                  <button key={t.id} onClick={() => setTableIdState(t.id)} aria-pressed={tableId === t.id}
                    className={`relative flex h-16 flex-col items-center justify-center rounded-xl transition-transform active:scale-95 ${STATUS_STYLE[t.status]} ${tableId === t.id ? "outline outline-2 outline-offset-2 outline-foreground" : ""}`}>
                    <span className="text-lg font-extrabold leading-none">{t.label}</span>
                    <span className="mt-1 text-[11px] font-semibold opacity-80">
                      {t.status === "occupied" || t.status === "billed" ? `${formatINR(t.runningTotal, 0)} · ${minutes(t.since)}` : t.status === "reserved" ? "Reserved" : <><Users className="inline size-3" /> {t.seats}</>}
                    </span>
                    {t.status === "billed" ? <Bell className="absolute right-1.5 top-1.5 size-3.5" aria-label="Bill asked" /> : null}
                    {holdLabel(t, Date.now()) ? <span className="mt-0.5 max-w-full truncate px-1 text-[10px] font-semibold opacity-90">{holdLabel(t, Date.now())}</span> : null}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </aside>

        {tableId ? <OrderPad key={tableId} tableId={tableId} onBack={() => setTableIdState(undefined)} /> : (
          <div className="hidden flex-1 flex-col items-center justify-center gap-2 p-8 text-center md:flex">
            <p className="text-2xl font-extrabold">Pick a table</p>
            <p className="max-w-sm text-sm text-muted-foreground">Blue tables have guests. White tables have asked for the bill.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderPad({ tableId, onBack }: { tableId: string; onBack: () => void }) {
  const cart = useCart(tableId);
  const settings = useRestaurantSettings();
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const inventory = useLiveQuery(() => getDb().inventory.toArray(), [], []);
  const table = useLiveQuery(() => getDb().restTables.get(tableId), [tableId]);
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [sending, setSending] = useState(false);
  // Phones show one pane at a time; tablets show both side by side.
  const [pane, setPane] = useState<"menu" | "order">("menu");

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

  const { user } = useStaff();
  const send = async () => {
    if (!(await allow(user, "kot.send", "Send the KOT"))) return;
    setSending(true);
    try {
      const kots = await cart.sendKitchen();
      if (kots.length) void printKots(kots, "sent");
    } finally {
      setSending(false);
    }
  };

  const askForBill = async () => {
    if (!(await allow(user, "bill.print", "Ask the counter for the bill"))) return;
    await getDb().restTables.update(tableId, { status: "billed" });
    await markDirty(["table", tableId]);
    toast.success(`Table ${table?.label ?? tableId} asked for the bill`);
  };

  const count = cart.lines.reduce((s, l) => s + l.qty, 0);
  return (
    <div className="flex min-w-0 flex-1 flex-col md:flex-row">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 md:hidden">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-semibold text-primary"><ArrowLeft className="size-4" />Tables</button>
        <span className="text-lg font-extrabold">{table?.label ?? tableId}</span>
        <div className="ml-auto flex rounded-lg bg-secondary p-0.5 text-sm font-semibold" role="tablist" aria-label="Show">
          <button type="button" role="tab" aria-selected={pane === "menu"} onClick={() => setPane("menu")} className={`rounded-md px-3 py-1.5 ${pane === "menu" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Menu</button>
          <button type="button" role="tab" aria-selected={pane === "order"} onClick={() => setPane("order")} className={`rounded-md px-3 py-1.5 ${pane === "order" ? "bg-card shadow-sm" : "text-muted-foreground"}`}>Order{count ? ` (${count})` : ""}</button>
        </div>
      </div>
      <section className={`${pane === "menu" ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col bg-secondary/40 md:flex`} aria-label="Menu">
        {cart.hold ? (
          <p role="status" className="m-3 mb-0 rounded-xl bg-gold/20 p-3 text-sm font-semibold text-foreground">
            {cart.hold.by} is taking this table's order{cart.hold.minutes ? ` (${cart.hold.minutes} min)` : ""}. You can add to it once it reaches the kitchen.
          </p>
        ) : null}
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
        <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2.5 overflow-y-auto px-3 pb-3 md:grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {items.map((m) => {
            const off = outsideHours(m);
            const left = stockLeft(m.id, inventory);
            return (
              <button key={m.id} onClick={() => add(m)} disabled={left === 0 || !!cart.hold}
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
        {unsent || cancels ? (
          <div className="border-t border-border p-2 md:hidden">
            <button type="button" onClick={() => setPane("order")} className="flex h-12 w-full items-center justify-between rounded-xl bg-primary px-4 text-primary-foreground">
              <span className="text-sm font-semibold">{unsent ? `${unsent} new` : `${cancels} to cancel`} · {formatINR(cart.totals.total, 0)}</span><span className="text-sm font-bold">Review & send →</span>
            </button>
          </div>
        ) : null}
      </section>

      <section className={`${pane === "order" ? "flex" : "hidden"} min-h-0 w-full shrink-0 flex-col border-border md:flex md:w-80 md:border-l xl:w-96`} aria-label={`Order for table ${table?.label ?? tableId}`}>
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
                    <button aria-label={`Fewer ${l.name}`} onClick={() => {
                      // Taking away something the kitchen already has is a KOT edit.
                      if (l.qty - 1 < kitchenHas) void allow(user, "kot.edit", `Cancel one ${l.name} the kitchen has`).then((ok) => { if (ok) cart.setQty(l.itemId, l.qty - 1); });
                      else cart.setQty(l.itemId, l.qty - 1);
                    }} className="p-2.5"><Minus className="size-4" /></button>
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
          <ConfirmButton id="waiter-send" onConfirm={send} disabled={sending || (!unsent && !cancels)}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-extrabold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-40"
            armedClassName="!bg-gold !text-gold-foreground" confirm={<><ChefHat className="size-5" />Tap again to send</>}>
            <ChefHat className="size-5" />{sending ? "Sending…" : unsent ? `Send ${unsent} to kitchen` : cancels ? "Send cancellation" : "Kitchen has everything"}
          </ConfirmButton>
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
