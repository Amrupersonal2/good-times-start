import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Minus, Plus, Trash2, Banknote, Smartphone, CreditCard, Printer, ShoppingBag, X, Star, ChefHat, Wallet, UserRound, ArrowLeftRight, BadgePercent, HandCoins, ChevronDown, Check } from "lucide-react";
import { AppShell, useRestaurantSettings } from "@/components/AppShell";
import { PaymentPanel, ReasonPrompt, UpiPay } from "@/components/PaymentDialogs";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { maxDiscountFor, type Payment } from "@/lib/payment-logic";
import { customerStats, normalisePhone } from "@/lib/customer-logic";
import { saveFeedback } from "@/lib/customer-actions";
import { ItemOptions } from "@/components/ItemOptions";
import { gstinError } from "@/lib/validation";
import { printBill, printKots } from "@/components/PrintHost";
import { usePrintConfig } from "@/lib/print-config";
import { VegMark } from "@/components/VegMark";
import { Receipt } from "@/components/Receipt";
import { getDb, markDirty } from "@/lib/db";
import { CATEGORIES } from "@/lib/seed";
import { formatINR } from "@/lib/billing";
import { useCart } from "@/lib/cart-store";
import type { Kot, MenuItem, Order, OrderType, PaymentMode } from "@/lib/types";
import { buildLine, needsOptions, orderCategories, outsideHours, priceFor, stockLeft } from "@/lib/menu-logic";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton, pressShortcut } from "@/components/ConfirmButton";
import { Dropdown } from "@/components/Dropdown";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { lineFor, sentGroups, shortCode, since } from "@/lib/bill-view-logic";
import { moveTable } from "@/lib/table-actions";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): { table?: string; bill?: string } => ({
    ...(typeof search["table"] === "string" ? { table: search["table"] } : {}),
    ...(typeof search["bill"] === "string" ? { bill: search["bill"] } : {}),
  }),
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
  // Running bills with no table: pickup and online orders, and takeaway bills sent to the kitchen.
  const openBills = useLiveQuery(async () => (await getDb().orders.where("status").equals("held").toArray())
    .filter((o) => !o.tableId).sort((a, b) => a.createdAt - b.createdAt), [], [] as Order[]);
  const openedBill = useRef<string | null>(null);
  useEffect(() => {
    if (!search.bill || openedBill.current === search.bill) return;
    const bill = openBills.find((o) => o.uid === search.bill);
    if (bill) { openedBill.current = search.bill; cart.openOrder(bill); }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when the bill is available locally
  }, [search.bill, openBills]);
  const [cat, setCat] = useState<string>("Popular");
  const [q, setQ] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Sample categories keep their usual order; any others follow alphabetically.
  const categoryOrder = useRestaurantSettings().categoryOrder;
  const categories = useMemo(() => orderCategories(menu.map((i) => i.category), categoryOrder, CATEGORIES), [menu, categoryOrder]);
  const hasPopular = menu.some((i) => i.popular && i.available);
  const rail = hasPopular ? ["Popular", ...categories] : categories;
  useEffect(() => {
    if (rail.length && !rail.includes(cat)) setCat(rail[0] ?? "Popular");
  }, [rail.join("|"), cat]);

  const items = useMemo(() => {
    const s = q.trim().toLowerCase();
    return menu.filter((i) => {
      if (!i.available) return false;
      if (s) return i.name.toLowerCase().includes(s) || shortCode(i.name).toLowerCase() === s;
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
  const printConfig = usePrintConfig();
  const [payOpen, setPayOpen] = useState(false);
  const [upiOpen, setUpiOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  // Tickets already sent for this bill, grouped as the kitchen got them.
  const activeId = cart.activeOrder?.id;
  const sentKots = useLiveQuery(async () => (activeId === undefined ? [] : getDb().kots.where("orderId").equals(activeId).toArray()), [activeId], [] as Kot[]);
  const sent = useMemo(() => sentGroups(sentKots), [sentKots]);
  const maxDiscount = maxDiscountFor(user?.role ?? "unknown", settings.staffDiscountLimit ?? 10);
  const discountChoices = [0, 5, 10, 15, 20, 25, 30, 50, 100].filter((d) => d <= maxDiscount || d === cart.discountPct);
  const canCancel = can(user, "bill.cancel");
  const guestId = normalisePhone(cart.customer.phone);
  const guest = useLiveQuery(async () => {
    if (!guestId) return null;
    const known = await getDb().customers.get(guestId);
    if (!known) return null;
    const visits = await getDb().orders.where("customerId").equals(guestId).toArray();
    return { customer: known, stats: customerStats(known, visits, settings.loyaltyPct ?? 0) };
  }, [guestId, settings.loyaltyPct], null);
  const guestName = guest?.customer.name;
  useEffect(() => {
    if (guestName && !cart.customer.name) cart.setCustomer({ ...cart.customer, name: guestName });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill the name once when a known guest is recognised
  }, [guestName]);
  /** Captains take orders and send KOTs; a cashier or manager settles. */
  const canSettle = can(user, "bill.settle");

  const done = (o: Order | null) => {
    if (!o) return;
    if (printConfig.autoPrintBill) void printBill(o);
    setReceipt(o);
    setCartOpen(false);
    setPayOpen(false);
    setUpiOpen(false);
    setCustomerOpen(false);
  };
  const settleOptions = { autoKot: Boolean(settings.autoKotOnSettle), onKots: (k: Kot[]) => { void printKots(k, "sent"); } };
  const pay = async (mode: PaymentMode) => {
    if (mode === "upi" && settings.upiVpa) { setUpiOpen(true); return; }
    done(await cart.settle(mode, closedBy, settleOptions));
  };
  const payWith = async (payments: Payment[]) => done(await cart.settle(payments, closedBy, settleOptions));
  const payPart = async (quantities: Record<string, number>, payments: Payment[]) => {
    const o = await cart.settlePart(quantities, payments, closedBy);
    if (o) { setReceipt(o); setPayOpen(false); }
  };

  const sendToKitchen = async () => {
    const tickets = await cart.sendKitchen();
    if (tickets.length) void printKots(tickets, "sent");
  };

  /** Print the running bill for the table before payment, and mark the table as billed. */
  const printRunningBill = async () => {
    const running = cart.activeOrder;
    if (!running) return;
    const preview: Order = { ...running, lines: cart.lines, ...cart.totals, discountPct: cart.discountPct, serviceChargePct: cart.serviceChargePct, status: "held" };
    void printBill(preview);
    if (cart.tableId) {
      await getDb().restTables.update(cart.tableId, { status: "billed" });
      await markDirty(["table", cart.tableId]);
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2" || e.key === "F4") { e.preventDefault(); searchRef.current?.focus(); }
      // Shortcuts that change a bill take two presses, like their buttons.
      if (e.key === "F1") { e.preventDefault(); if (cart.lines.length) pressShortcut("new-bill", () => cart.clear()); else cart.clear(); }
      if (e.key === "F8" && canSettle && !blocked) { e.preventDefault(); pressShortcut("settle-cash", () => pay("cash")); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const count = cart.lines.reduce((s, l) => s + l.qty, 0);
  const unsentCount = cart.pendingKitchenLines.reduce((sum, line) => sum + line.qty, 0);
  const cancelCount = cart.pendingCancelLines.reduce((sum, line) => sum + line.qty, 0);

  const hasDiscountOrCharge = cart.totals.discountAmt > 0 || cart.totals.serviceCharge > 0;
  const blocked = !cart.lines.length || (!settings.autoKotOnSettle && (unsentCount > 0 || cancelCount > 0));
  const tax = cart.totals.cgst + cart.totals.sgst;
  const currentTable = tables.find((t) => t.id === cart.tableId);
  const pendingById = new Map(cart.pendingKitchenLines.map((l) => [l.itemId, l.qty]));

  /** Discount, service charge, guest and change table: the cashier's bill tools. */
  const billTools = (
    <div className="flex flex-wrap items-center gap-1.5">
      {cart.tableId ? <ToolButton onClick={() => setMoveOpen(true)}><ArrowLeftRight className="size-3.5" />Change table</ToolButton> : null}
      <span className="flex items-center gap-1.5 rounded-lg bg-card px-2 py-1 text-xs font-semibold ring-1 ring-border/70">
        <BadgePercent className="size-3.5 text-muted-foreground" />Discount
        <Dropdown<number> ariaLabel="Discount" size="sm" className="h-7 w-[4.75rem]" value={cart.discountPct} onChange={cart.setDiscountPct}
          options={discountChoices.map((d) => ({ value: d, label: d ? `${d}%` : "None" }))} />
      </span>
      {(settings.serviceChargePct ?? 0) > 0 && cart.orderType === "dine-in" ? (
        <ToolButton pressed={cart.serviceChargePct > 0} onClick={() => cart.setServiceChargePct(cart.serviceChargePct > 0 ? 0 : settings.serviceChargePct ?? 0)}>
          <HandCoins className="size-3.5" />Service {settings.serviceChargePct}%
        </ToolButton>
      ) : null}
      <ToolButton pressed={!!(cart.customer.phone || cart.customer.name)} onClick={() => setCustomerOpen(true)}><UserRound className="size-3.5" />{cart.customer.name || cart.customer.phone || "Guest"}</ToolButton>
      <span className="ml-auto hidden text-[11px] text-muted-foreground xl:inline">F4 search · F1 new bill · F8 F8 cash</span>
    </div>
  );

  const billPanel = (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-3 border-b border-border bg-card px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-xl font-bold tracking-tight">
            {cart.orderType === "dine-in" ? (currentTable ? `${currentTable.section} · ${currentTable.label}` : "Choose a table") : cart.customer.name && cart.activeOrder?.guestCodes ? `${cart.activeOrder.guestCodes[0]} ${cart.customer.name}` : ORDER_TYPES.find((o) => o.v === cart.orderType)?.l}
          </div>
          <div className="text-xs text-muted-foreground">{cart.activeOrder ? `Bill ${cart.activeOrder.billNo}, opened ${since(cart.activeOrder.createdAt)}${since(cart.activeOrder.createdAt) === "just now" ? "" : " ago"}` : "New bill"}</div>
        </div>
        {cart.activeOrder && canCancel ? (
          <button type="button" onClick={() => setCancelOpen(true)} aria-label="Cancel bill" title="Cancel bill" className="grid size-8 shrink-0 place-items-center rounded-lg text-destructive hover:bg-destructive/10"><Trash2 className="size-4" /></button>
        ) : null}
      </div>
      {guest ? (
        <p className="border-b border-border bg-primary-tint/50 px-4 py-1.5 text-[11px] text-foreground">
          {guest.customer.name ?? "Guest"}: {guest.stats.visits} visit{guest.stats.visits === 1 ? "" : "s"}
          {(settings.loyaltyPct ?? 0) > 0 ? `, ${guest.stats.points} points` : ""}
          {guest.stats.due > 0 ? <span className="font-semibold text-destructive">, {formatINR(guest.stats.due, 0)} due</span> : null}
        </p>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {cart.lines.length === 0 && !cancelCount ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <ShoppingBag className="mb-2 size-9 text-muted-foreground/40" strokeWidth={1.5} />
            <p className="text-sm">Tap a dish to start</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {cart.pendingKitchenLines.length ? (
              <BillGroup title="New items" tone="new" note="not sent to kitchen">
                {cart.lines.filter((l) => pendingById.has(l.itemId)).map((l) => {
                  const pending = pendingById.get(l.itemId) ?? 0;
                  return (
                    <li key={l.itemId} className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <button type="button" aria-label={`Remove one ${l.name}`} onClick={() => cart.setQty(l.itemId, l.qty - 1)} className="grid size-6 shrink-0 place-items-center rounded-md bg-destructive/10 text-destructive">{pending === 1 && l.qty === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}</button>
                        <VegMark veg={l.veg} />
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{l.name}</span>
                        <span className="w-6 text-center text-sm font-semibold tabular-nums">{pending}</span>
                        <button type="button" aria-label={`Add one ${l.name}`} onClick={() => cart.setQty(l.itemId, l.qty + 1)} className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary"><Plus className="size-3" /></button>
                        <span className="w-14 text-right text-[13px] font-semibold tabular-nums">{formatINR(l.price * pending, 0)}</span>
                      </div>
                      <input placeholder="Add note" aria-label={`Note for ${l.name}`} value={l.note ?? ""} onChange={(e) => cart.setNote(l.itemId, e.target.value)}
                        className="ml-8 mt-0.5 w-[calc(100%-2rem)] border-0 bg-transparent px-0 py-0.5 text-[11px] text-muted-foreground placeholder:text-muted-foreground/60 focus-visible:shadow-none focus-visible:text-foreground" />
                    </li>
                  );
                })}
              </BillGroup>
            ) : null}
            {cart.pendingCancelLines.length ? (
              <BillGroup title="To cancel" tone="cancel" note="send to tell the kitchen">
                {cart.pendingCancelLines.map((l) => (
                  <li key={l.itemId} className="flex items-center gap-2 px-4 py-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate text-destructive line-through">{l.name}</span>
                    <span className="w-6 text-center font-semibold tabular-nums text-destructive">{l.qty}</span>
                    <button type="button" className="text-xs font-semibold text-primary" onClick={() => cart.restoreLine(l)}>Undo</button>
                  </li>
                ))}
              </BillGroup>
            ) : null}
            {[...sent].reverse().map((g) => (
              <BillGroup key={g.key} title={g.cancel ? `Cancelled after KOT ${g.number}` : `KOT ${g.number}`} tone={g.cancel ? "cancelled" : "sent"} note={`${since(g.at)}${since(g.at) === "just now" ? "" : " ago"} · ${g.station}`}
                action={<button type="button" aria-label={`Print KOT ${g.number} again`} title="Print again" onClick={() => void printKots(g.kots, "reprint")} className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"><Printer className="size-3.5" /></button>}>
                {g.lines.map((sl, i) => {
                  const line = g.cancel ? undefined : lineFor(cart.lines, sl.itemId, sl.name);
                  return (
                    <li key={`${sl.itemId ?? sl.name}-${i}`} className="flex items-center gap-2 px-4 py-1.5 text-[13px]">
                      {line ? (
                        <button type="button" aria-label={`Cancel one ${sl.name}`} title="Cancel one" onClick={() => cart.setQty(line.itemId, line.qty - 1)} className="grid size-6 shrink-0 place-items-center rounded-md text-destructive/80 hover:bg-destructive/10"><Minus className="size-3" /></button>
                      ) : <span className="size-6 shrink-0" />}
                      <span className={cn("min-w-0 flex-1 truncate", g.cancel && "text-muted-foreground line-through")}>{sl.name}{sl.note ? <span className="block truncate text-[11px] text-muted-foreground">{sl.note}</span> : null}</span>
                      <span className="w-6 text-center tabular-nums text-muted-foreground">{sl.qty}</span>
                      <span className="w-14 text-right tabular-nums text-muted-foreground">{line ? formatINR(line.price * sl.qty, 0) : ""}</span>
                    </li>
                  );
                })}
              </BillGroup>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card p-3">
        <div className="md:hidden">{billTools}</div>
        <dl className="grid grid-cols-3 gap-2 rounded-xl bg-secondary/70 px-3 py-2 text-center max-md:mt-2">
          <div><dt className="text-[11px] text-muted-foreground">Tax</dt><dd className="text-sm font-semibold tabular-nums">{formatINR(tax)}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Items</dt><dd className="text-sm font-semibold tabular-nums">{count}</dd></div>
          <div><dt className="text-[11px] text-muted-foreground">Total</dt><dd className="text-lg font-bold leading-tight tabular-nums">{formatINR(cart.totals.total, 0)}</dd></div>
        </dl>
        {hasDiscountOrCharge ? (
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            {cart.totals.discountAmt > 0 ? `Discount ${cart.discountPct}% −${formatINR(cart.totals.discountAmt)}` : ""}
            {cart.totals.discountAmt > 0 && cart.totals.serviceCharge > 0 ? " · " : ""}
            {cart.totals.serviceCharge > 0 ? `Service charge ${formatINR(cart.totals.serviceCharge)}` : ""}
          </p>
        ) : null}
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ConfirmButton id="send-kot" onConfirm={sendToKitchen} disabled={!unsentCount && !cancelCount}
            className={cn(buttonVariants({ variant: "secondary" }), "h-10")} armedClassName="!bg-gold !text-gold-foreground"
            confirm={<><ChefHat className="size-4" />{cancelCount && !unsentCount ? "Tap to send cancel" : `Tap to send ${unsentCount}`}</>}>
            <ChefHat className="size-4" />{cancelCount && !unsentCount ? "Send cancel" : "KOT"}{unsentCount ? <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">{unsentCount}</span> : null}
          </ConfirmButton>
          <Button variant="secondary" className="h-10" disabled={!cart.activeOrder || unsentCount > 0 || cancelCount > 0} onClick={() => void printRunningBill()}><Printer className="size-4" />Print bill</Button>
        </div>
        {canSettle ? (
          <div className="mt-2 grid grid-cols-4 gap-2">
            {([["cash", "Cash", Banknote], ["upi", "UPI", Smartphone], ["card", "Card", CreditCard]] as const).filter(([m]) => !settings.paymentModes || settings.paymentModes.includes(m)).map(([m, l, Icon]) => (
              m === "upi" && settings.upiVpa ? (
                // UPI shows the QR first; "Payment received" there is the second step.
                <button key={m} disabled={blocked} onClick={() => void pay(m)}
                  className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground transition-[background,transform] hover:bg-primary-hover active:scale-[0.97] disabled:opacity-40">
                  <Icon className="size-4" />{l}
                </button>
              ) : (
                <ConfirmButton key={m} id={`settle-${m}`} disabled={blocked} onConfirm={() => pay(m)}
                  className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary text-xs font-semibold text-primary-foreground transition-[background,transform] hover:bg-primary-hover active:scale-[0.97] disabled:opacity-40"
                  armedClassName="!bg-gold !text-gold-foreground ring-2 ring-gold ring-offset-2 ring-offset-card"
                  confirm={<><Check className="size-4" /><span className="leading-tight">Settle {formatINR(cart.totals.total, 0)}?</span></>}>
                  <Icon className="size-4" />{l}
                </ConfirmButton>
              )
            ))}
            <button disabled={blocked} onClick={() => setPayOpen(true)}
              className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl bg-primary-tint text-xs font-semibold text-primary transition-[background,transform] hover:bg-accent active:scale-[0.97] disabled:opacity-40">
              <Wallet className="size-4" />Split
            </button>
          </div>
        ) : <p className="mt-2 rounded-lg bg-secondary p-2.5 text-center text-xs text-muted-foreground">The cashier settles this bill.</p>}
      </div>
    </div>
  );

  const sections = [...new Set(tables.map((t) => t.section))].sort((a, b) => a.localeCompare(b));

  return (
    <AppShell>
      <div className="flex h-[calc(100vh-57px-5rem)] flex-col lg:h-[calc(100vh-57px)]">
        {/* Order type and floor sections: one tap picks a section, a second picks the table */}
        <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-3 py-2">
          {sections.length ? sections.map((section) => {
            const inSection = tables.filter((t) => t.section === section).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
            const here = cart.orderType === "dine-in" && currentTable?.section === section;
            const busy = inSection.filter((t) => t.status !== "free").length;
            return (
              <Popover key={section}>
                <PopoverTrigger asChild>
                  <button type="button" className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors", here ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent")}>
                    {section}{here && currentTable ? <span className="rounded-md bg-primary-foreground/20 px-1.5">{currentTable.label}</span> : busy ? <span className="text-[11px] font-medium text-muted-foreground">{busy}/{inSection.length}</span> : null}
                    <ChevronDown className="size-3.5 opacity-60" />
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(26rem,92vw)] rounded-xl p-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">{section}</p>
                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                    {inSection.map((t) => (
                      <button key={t.id} type="button" onClick={() => { cart.setOrderType("dine-in"); cart.setTableId(t.id); }}
                        className={cn("flex min-h-14 flex-col items-center justify-center rounded-lg px-1 text-center ring-1 transition-colors",
                          t.id === cart.tableId ? "bg-primary text-primary-foreground ring-primary"
                            : t.status === "billed" ? "bg-gold/15 ring-gold/60" : t.status === "occupied" ? "bg-primary-tint ring-primary/40" : t.status === "reserved" ? "bg-card ring-gold/60 ring-dashed" : "bg-card ring-border hover:ring-primary/40")}>
                        <span className="text-sm font-bold">{t.label}</span>
                        <span className="text-[10px] opacity-75">{t.status === "free" ? `${t.seats} seats` : t.status === "reserved" ? "Reserved" : formatINR(t.runningTotal, 0)}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            );
          }) : (
            <button type="button" onClick={() => cart.setOrderType("dine-in")} className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold", cart.orderType === "dine-in" ? "bg-primary text-primary-foreground" : "bg-secondary")}>Dine-in</button>
          )}
          <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" />
          {ORDER_TYPES.filter((o) => o.v !== "dine-in").map((o) => (
            <button key={o.v} type="button" onClick={() => { if (cart.tableId) cart.setTableId(undefined); cart.setOrderType(o.v); }}
              className={cn("shrink-0 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors", cart.orderType === o.v ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground hover:bg-accent")}>{o.l}</button>
          ))}
          {openBills.length ? <span className="mx-1 h-6 w-px shrink-0 bg-border" aria-hidden="true" /> : null}
          {openBills.map((o) => {
            const current = cart.activeOrder?.uid === o.uid;
            return (
              <button key={o.uid ?? o.billNo} type="button" onClick={() => cart.openOrder(o)} title={`Running bill ${o.billNo}`}
                className={cn("flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1", current ? "bg-primary-tint ring-primary" : "bg-card ring-border/70 hover:ring-primary/40")}>
                <ShoppingBag className="size-3.5 text-primary" />{o.guestCodes?.[0] ?? o.billNo.split("/").pop()} {o.customer?.name ?? ""}<span className="font-normal text-muted-foreground">{formatINR(o.total, 0)}</span>
              </button>
            );
          })}
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Category rail (desktop) */}
          <nav className="hidden w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-card p-2 lg:flex" aria-label="Menu sections">
            {rail.map((c) => (
              <button key={c} onClick={() => { setCat(c); setQ(""); }} aria-current={cat === c && !q ? "true" : undefined}
                className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors ${cat === c && !q ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-secondary"}`}>
                {c === "Popular" && <Star className={`size-3.5 ${cat === c && !q ? "fill-current" : "fill-gold text-gold"}`} />}<span className="truncate">{c}</span>
              </button>
            ))}
          </nav>

          {/* Dishes */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="space-y-2 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dishes or codes (F4)"
                  onKeyDown={(e) => { if (e.key === "Enter" && items.length === 1 && items[0]) { pick(items[0]); setQ(""); } if (e.key === "Escape") setQ(""); }}
                  className="w-full rounded-[10px] border-0 bg-secondary py-2.5 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground" />
              </div>
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto lg:hidden">
                {rail.map((c) => (
                  <button key={c} onClick={() => { setCat(c); setQ(""); }}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${cat === c && !q ? "bg-foreground text-background" : "bg-card text-foreground ring-1 ring-border/70"}`}>{c}</button>
                ))}
              </div>
            </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto px-3 pb-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
            {items.map((i) => {
              const inCart = qtyInCart(i.id);
              const left = stockLeft(i.id, inventory);
              const remaining = left === null ? null : left - inCart;
              const soldOut = remaining !== null && remaining <= 0;
              const stock = inventory.find((s) => s.menuItemId === i.id);
              const low = remaining !== null && !!stock && remaining <= stock.lowStockThreshold;
              const offHours = outsideHours(i);
              return (
                <button key={i.id} onClick={() => pick(i)} disabled={soldOut} title={offHours && i.hours ? `Served ${i.hours.from}–${i.hours.to}` : i.name}
                  className={`relative flex min-h-[4.75rem] flex-col justify-between overflow-hidden rounded-lg border-l-[3px] bg-card py-2 pl-2.5 pr-2 text-left shadow-[0_1px_2px_rgba(0,0,0,0.05)] ring-1 ring-border/70 transition-[transform,box-shadow] hover:shadow-md active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${i.veg ? "border-l-success" : "border-l-destructive"} ${offHours ? "opacity-60" : ""}`}>
                  {inCart ? <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{inCart}</span> : null}
                  <span className="line-clamp-2 pr-5 text-[13px] font-semibold leading-snug">{i.name}</span>
                  <span className="mt-1.5 flex items-end justify-between gap-1.5 text-[11px]">
                    <span className="font-medium uppercase tracking-wide text-muted-foreground">{soldOut ? <span className="font-semibold normal-case text-destructive">Sold out</span>
                      : low ? <span className="rounded bg-gold/25 px-1 font-semibold normal-case text-gold-foreground">{remaining} left</span>
                      : offHours && i.hours ? <span className="normal-case">{i.hours.from}–{i.hours.to}</span>
                      : shortCode(i.name)}</span>
                    <span className="text-[12px] font-semibold tabular-nums text-foreground/80">{i.variants?.length ? `${formatINR(Math.min(...i.variants.map((v) => v.price)), 0)}+` : formatINR(priceFor(i, cart.orderType), 0)}</span>
                  </span>
                </button>
              );
            })}
            {items.length === 0 && (menu.length === 0 ? (
              <div className="col-span-full rounded-xl border border-dashed border-border p-8 text-center">
                <p className="font-semibold">No dishes yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Add dishes in Menu, or import them from Excel.</p>
                <div className="mt-4 flex justify-center gap-2">
                  <Link to="/menu" className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Open Menu</Link>
                  <Link to="/setup" className="rounded-lg bg-secondary px-4 py-2 text-sm font-semibold">Setup</Link>
                </div>
              </div>
            ) : <p className="col-span-full py-10 text-center text-sm text-muted-foreground">{q ? `No dishes match "${q}"` : "Nothing available in this category"}</p>)}
          </div>
            <div className="hidden border-t border-border bg-card px-3 py-2 md:block">{billTools}</div>
          </div>

          {/* Bill panel tablet+ */}
          <aside className="hidden w-[22rem] shrink-0 border-l border-border bg-background md:block xl:w-[26rem]">{billPanel}</aside>
        </div>
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
            canSplitBill={!!cart.activeOrder && cart.lines.reduce((s, l) => s + l.qty, 0) > 1} tax={cart.tax}
            {...(settings.paymentModes ? { allowedModes: settings.paymentModes } : {})}
            pointsAvailable={(settings.loyaltyPct ?? 0) > 0 ? guest?.stats.points ?? 0 : 0} hasCustomer={!!guestId}
            onSettle={(p) => void payWith(p)} onSettlePart={(q, p) => void payPart(q, p)} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={upiOpen} onOpenChange={setUpiOpen}>
        <DialogContent className="max-w-sm">
          {upiOpen && settings.upiVpa ? <UpiPay vpa={settings.upiVpa} payee={settings.name || "Restaurant"} amount={cart.totals.total}
            billNo={cart.activeOrder?.billNo ?? "new"} onPaid={() => { void cart.settle("upi", closedBy, settleOptions).then(done); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="max-w-md">
          {cancelOpen ? <ReasonPrompt title={`Cancel bill ${cart.activeOrder?.billNo ?? ""}`}
            description="The kitchen already has these items. The bill is kept as cancelled with your reason."
            confirmLabel="Cancel this bill" onConfirm={(reason) => { void cart.cancelOrder(reason, closedBy).then(() => setCancelOpen(false)); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={customerOpen} onOpenChange={setCustomerOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Guest on this bill</DialogTitle>
          <div className="space-y-3">
            <label className="block text-sm font-medium">Mobile number
              <input autoFocus inputMode="tel" maxLength={15} value={cart.customer.phone ?? ""} onChange={(e) => cart.setCustomer({ ...cart.customer, phone: e.target.value.replace(/[^0-9+ ]/g, "") })} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium">Name
              <input maxLength={60} value={cart.customer.name ?? ""} onChange={(e) => cart.setCustomer({ ...cart.customer, name: e.target.value })} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium">Business GSTIN <span className="font-normal text-muted-foreground">(optional, for a B2B invoice)</span>
              <input maxLength={15} value={cart.customer.gstin ?? ""} onChange={(e) => cart.setCustomer({ ...cart.customer, gstin: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })}
                className={`mt-1 w-full rounded-lg border bg-card px-3 py-2.5 text-sm uppercase ${cart.customer.gstin && gstinError(cart.customer.gstin) ? "border-destructive" : "border-input"}`} />
              {cart.customer.gstin && gstinError(cart.customer.gstin) ? <span className="mt-1 block text-xs text-destructive">{gstinError(cart.customer.gstin)}</span> : null}
            </label>
            {guest ? <p className="text-xs text-muted-foreground">Returning guest: {guest.stats.visits} visits{(settings.loyaltyPct ?? 0) > 0 ? `, ${guest.stats.points} points` : ""}{guest.stats.due > 0 ? `, ${formatINR(guest.stats.due, 0)} due` : ""}</p> : null}
            <Button className="w-full" onClick={() => setCustomerOpen(false)}>Done</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-md">
          <DialogTitle>Move {currentTable?.label ?? "this bill"} to</DialogTitle>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {sections.map((section) => {
              const free = tables.filter((t) => t.section === section && t.status === "free" && t.id !== cart.tableId).sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
              if (!free.length) return null;
              return (
                <div key={section}>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">{section}</p>
                  <div className="grid grid-cols-5 gap-2">
                    {free.map((t) => (
                      <button key={t.id} type="button" className="min-h-11 rounded-lg bg-card text-sm font-bold ring-1 ring-border hover:ring-primary"
                        onClick={() => {
                          const from = cart.tableId;
                          if (!from) return;
                          void moveTable(from, t.id).then(() => { cart.setTableId(t.id); setMoveOpen(false); toast.success(`Moved to ${t.label}`); })
                            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Couldn't move the table"));
                        }}>{t.label}</button>
                    ))}
                  </div>
                </div>
              );
            })}
            {!tables.some((t) => t.status === "free" && t.id !== cart.tableId) ? <p className="text-sm text-muted-foreground">No free tables right now.</p> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!receipt} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-h-[90vh] max-w-sm overflow-y-auto">
          <DialogTitle>Bill {receipt?.billNo} settled</DialogTitle>
          {receipt && receipt.payments.length > 1 ? <p className="-mt-2 text-sm text-muted-foreground">{receipt.payments.map((p) => `${p.mode.toUpperCase()} ${formatINR(p.amount, 0)}`).join(", ")}</p> : null}
          {receipt && <Receipt order={receipt} />}
          <button onClick={() => { if (receipt) void printBill(receipt); }} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground hover:bg-primary-hover">
            <Printer className="size-4" /> Print receipt
          </button>
          {receipt ? <FeedbackPrompt key={receipt.uid ?? receipt.billNo} order={receipt} /> : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

/** Quick guest rating after settling; shows up against the guest and in reports. */
function FeedbackPrompt({ order }: { order: Order }) {
  const [rating, setRating] = useState<1 | 2 | 3 | 4 | 5 | null>(null);
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);
  if (saved) return <p className="text-center text-sm text-muted-foreground">Thanks, feedback saved.</p>;
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">How did the guest rate their visit?</p>
      <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Rating">
        {([1, 2, 3, 4, 5] as const).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`} onClick={() => setRating(n)}>
            <Star className={`size-7 ${rating !== null && n <= rating ? "fill-gold text-gold" : "text-muted-foreground"}`} />
          </button>
        ))}
      </div>
      {rating !== null ? <>
        <input value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} placeholder="What did they say? (optional)" className="mt-2 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm" />
        <Button size="sm" className="mt-2" onClick={() => { void saveFeedback(order, rating, comment).then(() => setSaved(true)); }}>Save feedback</Button>
      </> : null}
    </div>
  );
}

function ToolButton({ children, onClick, pressed }: { children: ReactNode; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed}
      className={cn("flex max-w-48 items-center gap-1.5 truncate rounded-lg px-2.5 py-1.5 text-xs font-semibold ring-1 transition-colors", pressed ? "bg-primary-tint text-primary ring-primary/40" : "bg-card text-foreground ring-border/70 hover:bg-secondary")}>
      {children}
    </button>
  );
}

/** One block of the bill: new items, items to cancel, or a ticket already in the kitchen. */
function BillGroup({ title, note, tone, action, children }: { title: string; note: string; tone: "new" | "cancel" | "sent" | "cancelled"; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={tone === "new" ? "bg-card" : tone === "cancel" ? "bg-destructive/5" : ""}>
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-2.5">
        <h3 className="text-[11px] font-semibold">
          <span className={tone === "new" ? "text-primary" : tone === "cancel" || tone === "cancelled" ? "text-destructive" : "text-foreground"}>{title}</span>
          <span className="ml-1.5 font-normal text-muted-foreground">{note}</span>
        </h3>
        {action}
      </header>
      <ul className="pb-1.5">{children}</ul>
    </section>
  );
}
