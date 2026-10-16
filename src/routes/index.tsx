import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Minus, Plus, Trash2, Banknote, Smartphone, CreditCard, Printer, ShoppingBag, X, Star, ChefHat, Wallet, UserRound } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { PaymentPanel, ReasonPrompt, UpiPay } from "@/components/PaymentDialogs";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { maxDiscountFor, type Payment } from "@/lib/payment-logic";
import { VegMark } from "@/components/VegMark";
import { Receipt } from "@/components/Receipt";
import { getDb } from "@/lib/db";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";
import { useCart } from "@/lib/cart-store";
import type { Kot, MenuItem, Order, OrderType, PaymentMode } from "@/lib/types";
import { buildLine, needsOptions, priceFor, stockLeft } from "@/lib/menu-logic";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({ table: typeof search["table"] === "string" ? search["table"] : undefined }),
  head: () => ({
    meta: [
      { title: "Billing — XTSY POS" },
      { name: "description", content: "Fast offline-first restaurant billing with GST invoices, UPI QR and KOT." },
      { property: "og:title", content: "XTSY POS — Restaurant Billing" },
      { property: "og:description", content: "Restaurant billing with GST, UPI and kitchen tickets that keeps working offline." },
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
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const cart = useCart(search.table);
  const [cat, setCat] = useState<string>("Popular");
  const [q, setQ] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [kitchenTickets, setKitchenTickets] = useState<Kot[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sample categories keep their usual order; any others follow alphabetically.
  const categories = useMemo(() => {
    const used = new Set(menu.map((i) => i.category));
    return [...CATEGORIES.filter((c) => used.has(c)), ...[...used].filter((c) => !CATEGORIES.includes(c)).sort()];
  }, [menu]);
  const hasPopular = menu.some((i) => i.popular && i.available);
  const rail = hasPopular ? ["Popular", ...categories] : categories;
  useEffect(() => {
    if (rail.length && !rail.includes(cat)) setCat(rail[0] ?? "Popular");
  }, [rail.join("|"), cat]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return menu.filter((i) => {
      if (!i.available) return false;
      if (s) return i.name.toLowerCase().includes(s) || i.name.toLowerCase().split(" ").some((w) => w.startsWith(s));
      return cat === "Popular" ? i.popular : i.category === cat;
    });
  }, [menu, q, cat]);

  const inventory = useLiveQuery(() => getDb().inventory.toArray(), [], []);
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  /** Portions of a dish already on this bill, across all its portion and add-on lines. */
  const qtyInCart = (menuItemId: string) =>
    cart.lines.filter((l) => (l.menuItemId ?? l.itemId) === menuItemId).reduce((sum, l) => sum + l.qty, 0);
  const hasStockFor = (item: MenuItem) => {
    const left = stockLeft(item.id, inventory);
    if (left === null || qtyInCart(item.id) < left) return true;
    toast.error(left === 0 ? `${item.name} is sold out` : `Only ${left} ${item.name} left`);
    return false;
  };
  const pick = (item: MenuItem) => {
    if (!hasStockFor(item)) return;
    if (needsOptions(item)) setChoosing(item);
    else cart.addItem(item);
  };

  const { user } = useStaff();
  const settings = useRestaurantSettings();
  const closedBy = user?.displayName;
  const [payOpen, setPayOpen] = useState(false);
  const [upiOpen, setUpiOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const maxDiscount = maxDiscountFor(user?.role ?? "unknown", settings.staffDiscountLimit ?? 10);
  const discountChoices = [0, 5, 10, 15, 20, 25, 30, 50, 100].filter((d) => d <= maxDiscount || d === cart.discountPct);
  const canCancel = !user || isAdmin(user);

  const done = (o: Order | null) => {
    if (!o) return;
    setReceipt(o);
    setCartOpen(false);
    setPayOpen(false);
    setUpiOpen(false);
    setCustomerOpen(false);
  };
  const pay = async (mode: PaymentMode) => {
    if (mode === "upi" && settings.upiVpa) { setUpiOpen(true); return; }
    done(await cart.settle(mode, closedBy));
  };
  const payWith = async (payments: Payment[]) => done(await cart.settle(payments, closedBy));
  const payPart = async (quantities: Record<string, number>, payments: Payment[]) => {
    const o = await cart.settlePart(quantities, payments, closedBy);
    if (o) { setReceipt(o); setPayOpen(false); }
  };

  const sendToKitchen = async () => {
    const tickets = await cart.sendKitchen();
    if (!tickets.length) return;
    setKitchenTickets(tickets);
  };

  useEffect(() => {
    if (!kitchenTickets.length) return;
    const timer = window.setTimeout(() => window.print(), 300);
    const clear = () => setKitchenTickets([]);
    window.addEventListener("afterprint", clear, { once: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", clear);
    };
  }, [kitchenTickets]);

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
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-medium text-muted-foreground">{cart.activeOrder ? `Running bill ${cart.activeOrder.billNo}` : "New bill"}</div>
            <div className="truncate text-3xl font-extrabold leading-none tracking-tight">
              {cart.orderType === "dine-in" ? (tables.find((t) => t.id === cart.tableId)?.label ?? "No table") : ORDER_TYPES.find((o) => o.v === cart.orderType)?.l}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-medium text-muted-foreground">{count} item{count === 1 ? "" : "s"}</div>
            <div className="text-2xl font-extrabold leading-none">{formatINR(cart.totals.total, 0)}</div>
          </div>
        </div>
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
            {tables.map((t) => <option key={t.id} value={t.id}>{t.label} ({t.section})</option>)}
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
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={cart.pendingKitchenLines.length ? "rounded-md bg-gold/25 px-2 py-1 font-semibold text-gold-foreground" : "text-success"}>
              {cart.pendingKitchenLines.length ? `${cart.pendingKitchenLines.reduce((sum, line) => sum + line.qty, 0)} item(s) not sent to kitchen` : "Kitchen ticket sent"}
            </span>
            <Button variant="secondary" disabled={!cart.pendingKitchenLines.length} onClick={() => void sendToKitchen()}><ChefHat className="size-4" />Send & print KOT</Button>
          </div>
        </div> : null}
        <div className="space-y-1 text-sm">
          <div className="flex justify-between text-muted-foreground"><span>Subtotal</span><span>{formatINR(cart.totals.subtotal)}</span></div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="flex items-center gap-2">Discount
              <select aria-label="Discount" value={cart.discountPct} onChange={(e) => cart.setDiscountPct(Number(e.target.value))} className="rounded-md border border-input bg-card px-1 py-0.5 text-xs">
                {discountChoices.map((d) => <option key={d} value={d}>{d}%</option>)}
              </select>
            </span>
            <span>-{formatINR(cart.totals.discountAmt)}</span>
          </div>
          {(settings.serviceChargePct ?? 0) > 0 && cart.orderType === "dine-in" ? (
            <div className="flex items-center justify-between text-muted-foreground">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={cart.serviceChargePct > 0} onChange={(e) => cart.setServiceChargePct(e.target.checked ? settings.serviceChargePct ?? 0 : 0)} />
                Service charge {settings.serviceChargePct}% (guest agreed)
              </label>
              <span>{formatINR(cart.totals.serviceCharge)}</span>
            </div>
          ) : null}
          <div className="flex justify-between text-muted-foreground"><span>CGST + SGST</span><span>{formatINR(cart.totals.cgst + cart.totals.sgst)}</span></div>
          <div className="flex justify-between text-muted-foreground"><span>Round off</span><span>{formatINR(cart.totals.roundOff)}</span></div>
          <div className="flex justify-between pt-1 text-xl font-bold"><span>Total</span><span className="text-primary">{formatINR(cart.totals.total, 0)}</span></div>
        </div>
        {customerOpen || cart.customer.name || cart.customer.phone ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <input aria-label="Guest name" placeholder="Guest name" maxLength={60} value={cart.customer.name ?? ""} onChange={(e) => cart.setCustomer({ ...cart.customer, name: e.target.value })} className="min-w-0 rounded-lg border border-input bg-card px-2 py-1.5 text-xs" />
            <input aria-label="Guest phone" placeholder="Phone" inputMode="tel" maxLength={15} value={cart.customer.phone ?? ""} onChange={(e) => cart.setCustomer({ ...cart.customer, phone: e.target.value.replace(/[^0-9+ ]/g, "") })} className="min-w-0 rounded-lg border border-input bg-card px-2 py-1.5 text-xs" />
          </div>
        ) : null}
        <div className="mt-3 grid grid-cols-4 gap-2">
          {([["cash", "Cash", Banknote], ["upi", "UPI", Smartphone], ["card", "Card", CreditCard]] as const).map(([m, l, Icon]) => (
            <button key={m} disabled={!cart.lines.length || cart.pendingKitchenLines.length > 0} onClick={() => void pay(m)}
              className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-40">
              <Icon className="size-4" />{l}
            </button>
          ))}
          <button disabled={!cart.lines.length || cart.pendingKitchenLines.length > 0} onClick={() => setPayOpen(true)}
            className="flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl border border-primary text-xs font-semibold text-primary transition-colors hover:bg-primary-tint disabled:opacity-40">
            <Wallet className="size-4" />Split
          </button>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <button type="button" className="flex items-center gap-1 font-semibold hover:text-foreground" onClick={() => setCustomerOpen(true)}><UserRound className="size-3.5" />{cart.customer.phone || cart.customer.name ? "Guest added" : "Add guest"}</button>
          <span className="hidden lg:inline">F1 new bill, F2 search, F8 settle in cash</span>
          {cart.activeOrder && canCancel ? <button type="button" className="font-semibold text-destructive hover:underline" onClick={() => setCancelOpen(true)}>Cancel bill</button> : null}
        </div>
      </div>
    </div>
  );

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-57px-5rem)] lg:h-[calc(100vh-57px)]">
        {/* Category rail (desktop) */}
        <div className="hidden w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-3 lg:flex">
          {rail.map((c) => (
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
              {rail.map((c) => (
                <button key={c} onClick={() => { setCat(c); setQ(""); }}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cat === c && !q ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{c}</button>
              ))}
            </div>
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-3 overflow-y-auto px-4 pb-4 sm:grid-cols-3 xl:grid-cols-4">
            {items.map((i) => {
              const inCart = qtyInCart(i.id);
              const left = stockLeft(i.id, inventory);
              const remaining = left === null ? null : left - inCart;
              const soldOut = remaining !== null && remaining <= 0;
              const stock = inventory.find((s) => s.menuItemId === i.id);
              const low = remaining !== null && !!stock && remaining <= stock.lowStockThreshold;
              return (
                <button key={i.id} onClick={() => pick(i)} disabled={soldOut}
                  className="card-elevated relative flex min-h-24 flex-col justify-between p-3 text-left transition-transform hover:border-primary/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100">
                  {inCart ? <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{inCart}</span> : null}
                  <div className="flex items-start gap-2 pr-6">
                    <span className="mt-0.5"><VegMark veg={i.veg} /></span>
                    <span className="text-sm font-semibold leading-snug">{i.name}</span>
                  </div>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className="text-sm font-bold text-primary">{i.variants?.length ? `from ${formatINR(i.price, 0)}` : formatINR(priceFor(i, cart.orderType), 0)}</span>
                    {soldOut ? <span className="text-[11px] font-semibold text-destructive">Sold out</span>
                      : low ? <span className="rounded bg-gold/25 px-1.5 text-[11px] font-semibold text-gold-foreground">{remaining} left</span>
                      : needsOptions(i) ? <span className="text-[11px] text-muted-foreground">Options</span> : null}
                  </span>
                </button>
              );
            })}
            {items.length === 0 && (menu.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center">
                <p className="font-semibold">No dishes yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add your dishes in Menu, or start from the sample menu in Settings.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link to="/menu" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open Menu</Link>
                  <Link to="/settings" className="rounded-lg border border-border px-4 py-2 text-sm font-semibold">Settings</Link>
                </div>
              </div>
            ) : <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{q ? `No dishes match "${q}"` : "Nothing available in this category"}</p>)}
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

      <Dialog open={!!choosing} onOpenChange={(o) => { if (!o) setChoosing(null); }}>
        <DialogContent className="max-w-sm">
          {choosing ? <ItemOptions key={choosing.id} item={choosing} orderType={cart.orderType}
            onAdd={(variantId, addonIds) => { if (hasStockFor(choosing)) cart.addItem(choosing, variantId, addonIds); setChoosing(null); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={payOpen} onOpenChange={setPayOpen}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
          {payOpen ? <PaymentPanel lines={cart.lines} discountPct={cart.discountPct} serviceChargePct={cart.serviceChargePct}
            canSplitBill={!!cart.activeOrder && cart.lines.reduce((s, l) => s + l.qty, 0) > 1}
            onSettle={(p) => void payWith(p)} onSettlePart={(q, p) => void payPart(q, p)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={upiOpen} onOpenChange={setUpiOpen}>
        <DialogContent className="max-w-sm">
          {upiOpen && settings.upiVpa ? <UpiPay vpa={settings.upiVpa} payee={settings.name || "Restaurant"} amount={cart.totals.total}
            billNo={cart.activeOrder?.billNo ?? "new"} onPaid={() => { void cart.settle("upi", closedBy).then(done); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          {cancelOpen ? <ReasonPrompt title={`Cancel bill ${cart.activeOrder?.billNo ?? ""}`}
            description="The kitchen has already been told about these items. The bill is kept as cancelled, with your reason, for the records."
            confirmLabel="Cancel this bill" onConfirm={(reason) => { void cart.cancelOrder(reason, closedBy).then(() => setCancelOpen(false)); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogTitle>Bill {receipt?.billNo} settled</DialogTitle>
          {receipt && receipt.payments.length > 1 ? <p className="-mt-2 text-sm text-muted-foreground">{receipt.payments.map((p) => `${p.mode.toUpperCase()} ${formatINR(p.amount, 0)}`).join(", ")}</p> : null}
          {receipt && <Receipt order={receipt} />}
          <button onClick={() => window.print()} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
            <Printer className="size-4" /> Print receipt
          </button>
        </DialogContent>
      </Dialog>
      {kitchenTickets.length > 0 ? <div className="fixed left-[-10000px] top-0" aria-hidden="true">
        {kitchenTickets.map((kot, index) => <Receipt key={`${kot.billNo}-${kot.station}-${index}`} order={{
          billNo: kot.billNo, orderType: kot.orderType ?? cart.orderType, tableId: kot.tableId, tableLabel: kot.tableLabel, lines: kot.lines.map((line) => ({ itemId: line.itemId ?? "", name: line.name, price: 0, qty: line.qty, veg: false, gstRate: 0, station: kot.station, ...(line.note ? { note: line.note } : {}) })),
          subtotal: 0, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total: 0, payments: [], status: "held", createdAt: kot.createdAt, synced: false,
        }} mode="kot" kot={kot} />)}
      </div> : null}
    </AppShell>
  );
}

/** Pick a portion (required when the dish has portions) and any add-ons. */
function ItemOptions({ item, orderType, onAdd }: { item: MenuItem; orderType: OrderType; onAdd: (variantId: string | undefined, addonIds: string[]) => void }) {
  const [variantId, setVariantId] = useState<string | undefined>(item.variants?.[0]?.id);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const line = buildLine(item, orderType, variantId, addonIds);
  const toggle = (id: string) => setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));

  return (
    <div>
      <DialogTitle className="flex items-center gap-2"><VegMark veg={item.veg} />{item.name}</DialogTitle>
      {item.variants?.length ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Portion</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {item.variants.map((v) => (
              <button key={v.id} type="button" role="radio" aria-checked={variantId === v.id} onClick={() => setVariantId(v.id)}
                className={`rounded-lg border px-3 py-3 text-left ${variantId === v.id ? "border-primary bg-primary-tint" : "border-border"}`}>
                <span className="block text-sm font-semibold">{v.name}</span>
                <span className="text-sm text-muted-foreground">{formatINR(v.price, 0)}</span>
              </button>
            ))}
          </div>
        </fieldset>
      ) : null}
      {item.addons?.length ? (
        <fieldset className="mt-4">
          <legend className="text-sm font-semibold">Add-ons</legend>
          <div className="mt-2 space-y-1.5">
            {item.addons.map((a) => (
              <label key={a.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
                <input type="checkbox" checked={addonIds.includes(a.id)} onChange={() => toggle(a.id)} className="size-4" />
                <span className="flex-1">{a.name}</span>
                <span className="text-muted-foreground">{a.price ? `+${formatINR(a.price, 0)}` : "Free"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <Button className="mt-5 w-full" onClick={() => onAdd(variantId, addonIds)}>Add to bill, {formatINR(line.price, 0)}</Button>
    </div>
  );
}
