import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search, Minus, Plus, Trash2, Banknote, Smartphone, CreditCard, Printer, ShoppingBag, X, Star, ChefHat } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { VegMark } from "@/components/VegMark";
import { Receipt } from "@/components/Receipt";
import { ensureSeed, getDb } from "@/lib/db";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";
import { useCart } from "@/lib/cart-store";
import type { Kot, Order, OrderType, PaymentMode } from "@/lib/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({ table: typeof search.table === "string" ? search.table : undefined }),
  head: () => ({
    meta: [
      { title: "Billing — Restro POS by XTSY" },
      { name: "description", content: "Fast offline-first restaurant billing with GST invoices, UPI QR and KOT." },
      { property: "og:title", content: "Restro POS by XTSY — Restaurant Billing" },
      { property: "og:description", content: "India's fastest offline-first restaurant POS with GST and UPI." },
    ],
  }),
  component: PosPage,
});

const ORDER_TYPES: { v: OrderType; l: string }[] = [
  { v: "dine-in", l: "Dine-in" },
  { v: "takeaway", l: "Takeaway" },
  { v: "delivery", l: "Delivery" },
  { v: "swiggy", l: "Swiggy" },
  { v: "zomato", l: "Zomato" },
];

function PosPage() {
  const search = Route.useSearch();
  useEffect(() => { void ensureSeed(); }, []);
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const cart = useCart(search.table);
  const [cat, setCat] = useState<string>("Popular");
  const [q, setQ] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [kitchenTickets, setKitchenTickets] = useState<Kot[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return menu.filter((i) => {
      if (!i.available) return false;
      if (s) return i.name.toLowerCase().includes(s) || i.name.toLowerCase().split(" ").some((w) => w.startsWith(s));
      return cat === "Popular" ? i.popular : i.category === cat;
    });
  }, [menu, q, cat]);

  const pay = async (mode: PaymentMode) => {
    const o = await cart.settle(mode);
    if (o) { setReceipt(o); setCartOpen(false); }
  };

  const sendToKitchen = async () => {
    const tickets = await cart.sendKitchen();
    if (!tickets.length) return;
    setKitchenTickets(tickets);
    window.setTimeout(() => window.print(), 100);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F1") { e.preventDefault(); cart.clear(); }
      if (e.key === "F8") { e.preventDefault(); void pay("cash"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const count = cart.lines.reduce((s, l) => s + l.qty, 0);

  const billPanel = (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
          {ORDER_TYPES.map((o) => (
            <button key={o.v} onClick={() => cart.setOrderType(o.v)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${cart.orderType === o.v ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>
              {o.l}
            </button>
          ))}
        </div>
        {cart.orderType === "dine-in" && (
          <select aria-label="Select table" value={cart.tableId ?? ""} onChange={(e) => cart.setTableId(e.target.value || undefined)}
            className="mt-3 w-full rounded-xl border border-input bg-card px-3 py-2 text-sm">
            <option value="">Select table</option>
            {tables.map((t) => <option key={t.id} value={t.id}>{t.label} · {t.section}</option>)}
          </select>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {cart.lines.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <ShoppingBag className="mb-3 size-10 text-primary/30" />
            <p className="text-sm font-medium">No items yet</p>
            <p className="text-xs">Tap a dish to start the bill</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {cart.lines.map((l) => (
              <li key={l.itemId} className="rounded-xl bg-secondary/60 p-3">
                <div className="flex items-start gap-2">
                  <VegMark veg={l.veg} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.name}</div>
                    <div className="text-xs text-muted-foreground">{formatINR(l.price, 0)} × {l.qty}</div>
                  </div>
                  <div className="text-sm font-semibold">{formatINR(l.price * l.qty, 0)}</div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <input placeholder="Note (less spicy…)" value={l.note ?? ""} onChange={(e) => cart.setNote(l.itemId, e.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-input bg-card px-2 py-1 text-xs" />
                  <div className="flex items-center rounded-lg border border-input bg-card">
                    <button aria-label="Decrease" onClick={() => cart.setQty(l.itemId, l.qty - 1)} className="p-1.5">{l.qty === 1 ? <Trash2 className="size-3.5 text-destructive" /> : <Minus className="size-3.5" />}</button>
                    <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
                    <button aria-label="Increase" onClick={() => cart.setQty(l.itemId, l.qty + 1)} className="p-1.5"><Plus className="size-3.5" /></button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-border bg-card p-4">
        {cart.lines.length > 0 ? <div className="mb-3 space-y-2 border-b border-border pb-3">
          {cart.tableId ? <p className="text-sm font-semibold">{tables.find((t) => t.id === cart.tableId)?.label ?? cart.tableId}</p> : null}
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={cart.pendingKitchenLines.length ? "text-warning" : "text-success"}>
              {cart.pendingKitchenLines.length ? `${cart.pendingKitchenLines.reduce((sum, line) => sum + line.qty, 0)} item(s) not sent to kitchen` : "Kitchen ticket sent"}
            </span>
            <button disabled={!cart.pendingKitchenLines.length} onClick={() => void sendToKitchen()} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-secondary px-3 font-semibold text-secondary-foreground disabled:opacity-50">
              <ChefHat className="size-4" />Send & print KOT
            </button>
          </div>
        </div> : null}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatINR(cart.totals.subtotal)}</span></div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-2">Discount
              <select aria-label="Discount" value={cart.discountPct} onChange={(e) => cart.setDiscountPct(Number(e.target.value))} className="rounded-md border border-input bg-card px-1 py-0.5 text-xs">
                {[0, 5, 10, 15, 20].map((d) => <option key={d} value={d}>{d}%</option>)}
              </select>
            </span>
            <span>-{formatINR(cart.totals.discountAmt)}</span>
          </div>
          <div className="flex justify-between text-muted-foreground"><span>CGST + SGST</span><span>{formatINR(cart.totals.cgst + cart.totals.sgst)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Round off</span><span>{formatINR(cart.totals.roundOff)}</span></div>
          <div className="flex justify-between pt-1 text-xl font-bold"><span>Total</span><span className="text-primary">{formatINR(cart.totals.total, 0)}</span></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {([["cash", "Cash", Banknote], ["upi", "UPI", Smartphone], ["card", "Card", CreditCard]] as const).map(([m, l, Icon]) => (
            <button key={m} disabled={!cart.lines.length || cart.pendingKitchenLines.length > 0} onClick={() => pay(m)}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40">
              <Icon className="size-4" />{l}
            </button>
          ))}
        </div>
        <p className="mt-2 hidden text-center text-[11px] text-muted-foreground lg:block">F1 new · F2 search · F8 cash settle</p>
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-57px-5rem)] lg:h-[calc(100vh-57px)]">
        {/* Category rail (desktop) */}
        <div className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 lg:flex">
          {["Popular", ...CATEGORIES].map((c) => (
            <button key={c} onClick={() => { setCat(c); setQ(""); }}
              className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${cat === c && !q ? "bg-primary-tint text-primary" : "text-muted-foreground hover:bg-secondary"}`}>
              {c === "Popular" && <Star className="size-3.5 fill-gold text-gold" />}{c}
            </button>
          ))}
        </div>

        {/* Items */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="space-y-3 p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes (F2)…"
                className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
            </div>
            <div className="no-scrollbar flex gap-2 overflow-x-auto lg:hidden">
              {["Popular", ...CATEGORIES].map((c) => (
                <button key={c} onClick={() => { setCat(c); setQ(""); }}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cat === c && !q ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-4 pb-4 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((i) => {
              const inCart = cart.lines.find((l) => l.itemId === i.id)?.qty;
              return (
                <button key={i.id} onClick={() => cart.addItem(i)}
                  className="card-elevated relative flex min-h-24 flex-col justify-between p-3 text-left transition-transform active:scale-[0.97] hover:border-primary/40">
                  {inCart ? <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{inCart}</span> : null}
                  <div className="flex items-start gap-2 pr-6">
                    <span className="mt-0.5"><VegMark veg={i.veg} /></span>
                    <span className="text-sm font-semibold leading-snug">{i.name}</span>
                  </div>
                  <span className="mt-2 text-sm font-bold text-primary">{formatINR(i.price, 0)}</span>
                </button>
              );
            })}
            {items.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">No dishes found</p>}
          </div>
        </div>

        {/* Bill panel tablet+ */}
        <aside className="hidden w-80 shrink-0 border-l border-border bg-card md:block xl:w-96">{billPanel}</aside>
      </div>

      {/* Mobile cart bar + drawer */}
      {count > 0 && (
        <button onClick={() => setCartOpen(true)}
          className="fixed inset-x-3 bottom-[4.5rem] z-30 flex items-center justify-between rounded-2xl bg-primary px-5 py-3.5 text-primary-foreground shadow-lg md:hidden">
          <span className="text-sm font-semibold">{count} items · View bill</span>
          <span className="text-base font-bold">{formatINR(cart.totals.total, 0)}</span>
        </button>
      )}
      {cartOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 h-[85vh] overflow-hidden rounded-t-3xl bg-card animate-in slide-in-from-bottom">
            <button aria-label="Close bill" onClick={() => setCartOpen(false)} className="absolute right-3 top-3 z-10 rounded-full bg-secondary p-1.5"><X className="size-4" /></button>
            {billPanel}
          </div>
        </div>
      )}

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogTitle>Bill settled</DialogTitle>
          {receipt && <Receipt order={receipt} />}
          <button onClick={() => window.print()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
            <Printer className="size-4" /> Print receipt
          </button>
        </DialogContent>
      </Dialog>
      {kitchenTickets.length > 0 && cart.activeOrder ? <div className="fixed left-[-10000px] top-0" aria-hidden="true">
        {kitchenTickets.map((kot, index) => <Receipt key={`${kot.billNo}-${kot.station}-${index}`} order={{ ...cart.activeOrder!, lines: kot.lines.map((line) => ({ itemId: line.itemId ?? "", name: line.name, price: 0, qty: line.qty, veg: false, gstRate: 0, station: kot.station, note: line.note })) }} mode="kot" kot={kot} />)}
      </div> : null}
    </AppShell>
  );
}
