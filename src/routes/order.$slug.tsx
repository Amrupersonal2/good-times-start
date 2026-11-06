import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { placeName } from "@/lib/table-logic";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, BadgePercent, Check, ChefHat, Clock, ExternalLink, MapPin, Minus, Phone, Plus, Search, Send, Share, ShoppingBag, Smartphone, Sparkles, Star, Store, UtensilsCrossed, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ItemOptions } from "@/components/ItemOptions";
import { VegMark } from "@/components/VegMark";
import { computeTotals, formatINR, upiLink } from "@/lib/billing";
import { needsOptions, orderCategories, outsideHours } from "@/lib/menu-logic";
import {
  GUEST_STATUS_LABEL, addToGuestCart, asMenuItem, guestLineFor, guestOrderPayload, guestSubtotal, pickupChoices, setGuestQty,
  type GuestCartLine, type GuestChannel, type GuestLine, type GuestStatus, type Storefront,
} from "@/lib/guest-order-logic";
import type { CartLine, MenuItem } from "@/lib/types";
import menuCover from "@/assets/photography/bistro-menu.jpg";
import { filterGuestMenu, guestChannel, type GuestDiet } from "@/lib/qr-ordering";
import { Segmented } from "@/components/Segmented";
import { Dropdown } from "@/components/Dropdown";
import { activeOffers, brandPalette, cleanSource, waLink, LINK_LABELS, type BrandLinks, type Offer } from "@/lib/marketing-logic";
import { logScan, recordGuestChoice } from "@/lib/marketing-actions";
import type { CSSProperties } from "react";

interface OrderSearch { table?: string; o?: string; k?: string; s?: string }

export const Route = createFileRoute("/order/$slug")({
  validateSearch: (search: Record<string, unknown>): OrderSearch => {
    const out: OrderSearch = {};
    for (const key of ["table", "o", "k", "s"] as const) if (typeof search[key] === "string" && search[key]) out[key] = search[key] as string;
    return out;
  },
  head: () => ({
    meta: [
      { title: "Order — XTSY POS" },
      { name: "description", content: "See the menu and order from your table or for pickup." },
      { name: "robots", content: "noindex" }, { property: "og:title", content: "Order — XTSY POS" }, { property: "og:description", content: "See the menu and order from your table or for pickup." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" },],
  }),
  component: GuestOrderPage,
});

/* ---------------- small storage helpers (per-guest conveniences only) ---------------- */

interface PlacedRef { id: string; token: string; code: string; at: number }
const placedKey = (slug: string) => `xtsy-guest-orders:${slug}`;
const cartKey = (slug: string, table?: string) => `xtsy-guest-cart:${slug}:${table ?? "online"}`;
function readJson<T>(key: string, fallback: T): T {
  try { const raw = window.localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; }
}
function writeJson(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: cart lives in memory */ }
}

function GuestOrderPage() {
  const { slug } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const store = useQuery({
    queryKey: ["storefront", slug],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("public_storefront", { _slug: slug });
      if (error) throw error;
      return (data ?? null) as unknown as Storefront | null;
    },
    staleTime: 60_000,
  });

  const scanSource = search.s ? cleanSource(search.s) : search.table ? cleanSource(search.table) : "direct";
  const loadedSlug = store.data?.slug;
  useEffect(() => {
    if (loadedSlug && !(search.o && search.k)) void logScan(loadedSlug, scanSource);
  }, [loadedSlug, scanSource, search.o, search.k]);

  if (store.isLoading) return <Frame><div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-card" />)}</div></Frame>;
  if (store.isError) return <Frame><Notice icon={Store} title="Couldn't load the menu" body="Check your internet connection and try again." action={<Button onClick={() => void store.refetch()}>Try again</Button>} /></Frame>;
  const s = store.data;
  if (!s) return <Frame><Notice icon={Store} title="Restaurant not found" body="This link may be mistyped or out of date. Please ask the staff." /></Frame>;

  if (search.o && search.k) return <Frame><OrderStatus store={s} id={search.o} token={search.k} table={search.table} /></Frame>;

  const table = search.table ? s.tables.find((t) => t.id === search.table) : undefined;
  const channel = guestChannel(s.qr, s.online, table?.id);
  if (!s.live || (!s.qr && !s.online)) return <Frame store={s}><Notice icon={Store} title="Ordering is off right now" body="Please order with the staff. Sorry for the trouble." /></Frame>;
  if (search.table && !table && s.qr) return <Frame store={s}><Notice icon={UtensilsCrossed} title="This QR code is out of date" body="Please ask the staff for help with your order." /></Frame>;
  if (!channel) {
    if (!search.table && s.qr) return <Frame store={s}><section className="px-5 py-6">
      <h2 className="text-xl font-bold">Choose your table</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {s.tables.map((t) => <Button key={t.id} variant="outline" className="h-16" onClick={() => void navigate({ search: { ...search, table: t.id } })}><UtensilsCrossed />{placeName(t.label)}</Button>)}
      </div>
    </section></Frame>;
    return <Frame store={s}><Notice icon={UtensilsCrossed} title={search.table ? "Table ordering is off" : "Scan the QR code on your table"}
      body={search.table ? "Please order with the staff." : "This restaurant takes orders from the QR code on each table."} /></Frame>;
  }
  return <Frame store={s}><Menu store={s} channel={channel} tableId={table?.id} tableLabel={table?.label} source={scanSource} /></Frame>;
}

/* ---------------- layout ---------------- */

function Frame({ store, children }: { store?: Storefront; children: ReactNode }) {
  const brand = store?.branding ?? {};
  // The owner's brand colour becomes this page's accent; text stays readable (see brandPalette).
  const palette = brandPalette(brand.color);
  return (
    <div className="min-h-screen bg-background text-foreground" style={(palette ?? undefined) as CSSProperties | undefined}>
      <div className="mx-auto min-h-screen max-w-3xl bg-background pb-28">
        {store ? (
          <header className="relative overflow-hidden bg-sidebar text-sidebar-foreground">
            <img src={brand.cover || menuCover} alt="" decoding="async" fetchPriority="high" width={1536} height={768} className="absolute inset-0 size-full object-cover" />
            <div aria-hidden="true" className="absolute inset-0 bg-sidebar/65" />
            <div className="relative px-5 pb-6 pt-24">
            <div className="flex items-end gap-3">
                {brand.logo ? <img src={brand.logo} alt={`${store.name} logo`} width={64} height={64} className="size-16 shrink-0 rounded-2xl bg-white object-contain p-1 shadow-lg ring-2 ring-white/70" /> : null}
                <div className="min-w-0">
                  <h1 className="text-3xl font-extrabold leading-tight text-sidebar-foreground">{store.name}</h1>
                  {brand.tagline ? <p className="mt-0.5 text-sm font-medium text-sidebar-foreground/90">{brand.tagline}</p> : null}
                </div>
              </div>
              {store.address ? <p className="mt-3 flex items-start gap-1.5 text-sm text-sidebar-foreground/80"><MapPin className="mt-0.5 size-3.5 shrink-0" />{store.address}</p> : null}
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {store.phone ? <a href={`tel:${store.phone}`} className="inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/80"><Phone className="size-3.5" />{store.phone}</a> : null}
                {brand.links?.instagram ? <a href={brand.links.instagram} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/80"><Share className="size-3.5" />Instagram</a> : null}
              </div>
            </div>
          </header>
        ) : null}
        {children}
        <footer className="px-5 pt-10 text-center text-[11px] text-muted-foreground">
          {store?.fssai ? <p>FSSAI {store.fssai}</p> : null}
          <p className="mt-1">Ordering by XTSY POS</p>
        </footer>
      </div>
    </div>
  );
}

function Notice({ icon: Icon, title, body, action }: { icon: typeof Store; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="mx-5 mt-8 rounded-2xl border border-border bg-card p-6 text-center">
      <Icon className="mx-auto size-8 text-primary" />
      <h2 className="mt-3 text-lg font-bold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ---------------- menu and cart ---------------- */

function Menu({ store, channel, tableId, tableLabel, source }: { store: Storefront; channel: GuestChannel; tableId?: string | undefined; tableLabel?: string | undefined; source: string }) {
  const navigate = Route.useNavigate();
  const items = useMemo(() => store.menu.map(asMenuItem), [store.menu]);
  const categories = useMemo(() => orderCategories(items.map((i) => i.category), store.categoryOrder), [items, store.categoryOrder]);
  const [cart, setCart] = useState<GuestCartLine[]>([]);
  const [q, setQ] = useState("");
  const [diet, setDiet] = useState<GuestDiet>("all");
  const [browse, setBrowse] = useState(false);
  const [restored, setRestored] = useState(false);
  const [active, setActive] = useState(categories[0] ?? "");
  const [choosing, setChoosing] = useState<MenuItem | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [placed, setPlaced] = useState<PlacedRef[]>([]);
  const sections = useRef<Record<string, HTMLElement | null>>({});
  const offers = useMemo(() => activeOffers(store.branding?.offers, Date.now()), [store.branding?.offers]);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    setRestored(false);
    setCart(readJson<GuestCartLine[]>(cartKey(store.slug, tableId), []));
    setRestored(true);
    const day = Date.now() - 12 * 60 * 60 * 1000;
    setPlaced(readJson<PlacedRef[]>(placedKey(store.slug), []).filter((p) => p.at > day));
  }, [store.slug, tableId]);
  useEffect(() => { if (restored) writeJson(cartKey(store.slug, tableId), cart); }, [cart, store.slug, tableId, restored]);

  const qtyOf = (id: string) => cart.filter((l) => l.itemId === id).reduce((n, l) => n + l.qty, 0);
  const add = (item: MenuItem, variantId?: string, addonIds: string[] = []) => setCart((c) => addToGuestCart(c, guestLineFor(item, channel, variantId, addonIds)));
  const removeOne = (item: MenuItem) => {
    const last = [...cart].reverse().find((l) => l.itemId === item.id);
    if (last) setCart((c) => setGuestQty(c, last.key, last.qty - 1));
  };
  const count = cart.reduce((n, l) => n + l.qty, 0);
  const subtotal = guestSubtotal(cart);
  const s = q.trim().toLowerCase();
  const filteredItems = useMemo(() => filterGuestMenu(items, q, diet), [items, q, diet]);
  const visibleIds = new Set(filteredItems.map((i) => i.id));
  const visible = (i: MenuItem) => visibleIds.has(i.id);
  const priceLabel = (i: MenuItem) => i.variants?.length ? `from ${formatINR(Math.min(...i.variants.map((v) => v.price)), 0)}` : formatINR(channel === "online" ? i.prices?.takeaway ?? i.price : i.price, 0);

  const jump = (c: string) => {
    setActive(c);
    setQ("");
    setBrowse(false);
    window.setTimeout(() => sections.current[c]?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }), 50);
  };
  const openOffer = (offer: Offer) => {
    const dish = offer.itemId ? items.find((i) => i.id === offer.itemId) : undefined;
    if (!dish) return;
    setQ("");
    setActive(dish.category);
    setFlash(dish.id);
    window.setTimeout(() => document.getElementById(`dish-${dish.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    window.setTimeout(() => setFlash(""), 2400);
  };

  return (
    <>
      <div className="px-4">
        <div className="relative border-b border-border bg-card px-4 py-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary">{channel === "table" ? <UtensilsCrossed className="size-5" /> : <ShoppingBag className="size-5" />}</span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{channel === "table" ? `Ordering to ${placeName(tableLabel ?? "")}` : "Order for pickup"}</p>
              {store.qr ? <label className="mt-2 block text-xs font-medium">Table
                <select aria-label="Select table" value={tableId ?? ""} onChange={(e) => void navigate({ search: { ...(e.target.value ? { table: e.target.value } : {}), s: source } })} className="mt-1 w-full rounded-md border border-input bg-background px-2 py-2 text-sm">
                  {store.online ? <option value="">Pickup</option> : null}
                  {store.tables.map((t) => <option key={t.id} value={t.id}>{placeName(t.label)}</option>)}
                </select>
              </label> : null}
              <p className="text-xs text-muted-foreground">{channel === "table" ? "Your food comes to your table. Pay at the end." : `Usually ready in about ${store.prepMinutes} minutes.`}</p>
            </div>
          </div>
          {store.paused ? <p role="status" className="mt-3 rounded-lg bg-gold/20 px-3 py-2 text-xs font-semibold text-gold-foreground">The kitchen isn't taking orders here for a little while. You can still look at the menu.</p> : null}
          {store.branding?.welcome ? <p className="mt-3 text-sm">{store.branding.welcome}</p> : null}
          {store.message ? <p className="mt-3 text-sm">{store.message}</p> : null}
          {placed.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {placed.slice(0, 4).map((p) => (
                <button key={p.id} type="button" onClick={() => void navigate({ search: { ...(tableId ? { table: tableId } : {}), o: p.id, k: p.token } })}
                  className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold"><Clock className="size-3.5" />Order {p.code}</button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {offers.length ? (
        <section aria-label="Offers" className="no-scrollbar mt-3 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1">
          {offers.map((offer) => {
            const linked = !!offer.itemId && items.some((i) => i.id === offer.itemId);
            const Tag_ = linked ? "button" : "div";
            return (
              <Tag_ key={offer.id} {...(linked ? { type: "button" as const, onClick: () => openOffer(offer) } : {})}
                className={`relative min-w-[78%] snap-start overflow-hidden rounded-2xl bg-primary p-4 text-left text-primary-foreground shadow-sm ${offers.length === 1 ? "min-w-full" : ""}`}>
                <div aria-hidden="true" className="absolute -right-6 -top-6 size-24 rounded-full bg-primary-foreground/10" />
                <p className="relative flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider opacity-85"><BadgePercent className="size-3.5" />Offer{offer.until ? ` · till ${new Date(`${offer.until}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}</p>
                <p className="relative mt-1 text-lg font-extrabold leading-snug">{offer.title}</p>
                {offer.detail ? <p className="relative mt-0.5 text-sm opacity-90">{offer.detail}</p> : null}
                {linked ? <p className="relative mt-2 text-xs font-bold underline underline-offset-2">See the dish →</p> : null}
              </Tag_>
            );
          })}
        </section>
      ) : null}

      <div className="sticky top-0 z-20 mt-3 bg-background/95 px-4 pb-2 pt-2 backdrop-blur">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu" aria-label="Search the menu"
            className="w-full rounded-xl border border-input bg-card py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30" />
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <Segmented ariaLabel="Dietary preference" value={diet} onChange={setDiet} options={[{ value: "all", label: "All" }, { value: "veg", label: "Veg" }, { value: "nonveg", label: "Non-veg" }]} />
          <Button variant="outline" size="sm" onClick={() => setBrowse(true)}><UtensilsCrossed />Sections</Button>
        </div>
        <nav className="no-scrollbar mt-3 flex gap-1 overflow-x-auto border-b border-border" aria-label="Menu sections">
          {categories.map((c) => (
            <Button key={c} variant="ghost" size="sm" onClick={() => jump(c)} aria-current={active === c && !s ? "true" : undefined}
              className={`h-10 shrink-0 rounded-none border-b-2 ${active === c && !s ? "border-primary text-primary" : "border-transparent text-muted-foreground"}`}>{c}</Button>
          ))}
        </nav>
      </div>

      <Dialog open={browse} onOpenChange={setBrowse}>
        <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
          <DialogTitle>Explore the menu</DialogTitle>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((category) => <Button key={category} variant="outline" onClick={() => jump(category)} className="h-auto min-h-16 justify-start whitespace-normal px-3 py-3 text-left">
              <span className="min-w-0 flex-1">{category}</span><span className="text-xs text-muted-foreground">{items.filter((item) => item.category === category).length}</span>
            </Button>)}
          </div>
        </DialogContent>
      </Dialog>

      <div className="px-4">
        {categories.map((c) => {
          const dishes = items.filter((i) => i.category === c && visible(i));
          if (!dishes.length) return null;
          return (
            <section key={c} ref={(el) => { sections.current[c] = el; }} className="scroll-mt-44 pt-5">
              <h2 className="mb-2 text-base font-extrabold">{c}</h2>
              <ul className="divide-y divide-border bg-card">
                {dishes.map((i) => {
                  const off = outsideHours(i);
                  const n = qtyOf(i.id);
                  return (
                    <li key={i.id} id={`dish-${i.id}`} className={`flex gap-3 p-3.5 transition-colors duration-700 ${off ? "opacity-60" : ""} ${flash === i.id ? "bg-primary-tint" : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2"><span className="mt-1"><VegMark veg={i.veg} /></span><span className="font-semibold leading-snug">{i.name}</span></div>
                        {i.popular ? <span className="ml-5 mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-warning"><Star className="size-3" />Bistro favourite</span> : null}
                        <p className="mt-0.5 pl-5 text-sm font-semibold text-primary">{priceLabel(i)}</p>
                        {i.description ? <p className="mt-1 line-clamp-2 pl-5 text-xs text-muted-foreground">{i.description}</p> : null}
                        {off && i.hours ? <p className="mt-1 pl-5 text-[11px] font-semibold text-muted-foreground">Served {i.hours.from}–{i.hours.to}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center">
                        {off || store.paused ? null : n === 0 ? (
                          <Button size="sm" variant="outline" aria-label={`Add ${i.name}`} className="min-w-20 border-primary font-bold text-primary" onClick={() => (needsOptions(i) ? setChoosing(i) : add(i))}>Add{needsOptions(i) ? " +" : ""}</Button>
                        ) : (
                          <div className="flex items-center rounded-lg bg-primary text-primary-foreground">
                            <button type="button" aria-label={`One less ${i.name}`} className="p-2" onClick={() => removeOne(i)}><Minus className="size-4" /></button>
                            <span className="w-6 text-center text-sm font-bold">{n}</span>
                            <button type="button" aria-label={`One more ${i.name}`} className="p-2" onClick={() => (needsOptions(i) ? setChoosing(i) : add(i))}><Plus className="size-4" /></button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {!filteredItems.length ? <div className="py-10 text-center"><p className="text-sm text-muted-foreground">No dishes match your selection.</p><Button variant="link" onClick={() => { setQ(""); setDiet("all"); }}>Clear filters</Button></div> : null}
      </div>

      {count > 0 && restored ? (
        <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-3xl p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button onClick={() => setCheckout(true)} className="flex h-14 w-full items-center justify-between rounded-lg px-5 shadow-xl">
            <span className="text-sm font-semibold">{count} item{count === 1 ? "" : "s"} · {formatINR(subtotal, 0)}</span>
            <span className="text-sm font-bold">Review order →</span>
          </Button>
        </div>
      ) : null}

      <Dialog open={!!choosing} onOpenChange={(o) => { if (!o) setChoosing(null); }}>
        <DialogContent className="max-w-sm">
          {choosing ? <ItemOptions key={choosing.id} item={choosing} orderType={channel === "table" ? "dine-in" : "takeaway"}
            onAdd={(variantId, addonIds) => { add(choosing, variantId, addonIds); setChoosing(null); }} /> : null}
        </DialogContent>
      </Dialog>

      <Dialog open={checkout} onOpenChange={setCheckout}>
        <DialogContent className="max-h-[92vh] max-w-md overflow-y-auto">
          {checkout ? <Checkout store={store} channel={channel} tableId={tableId} tableLabel={tableLabel} cart={cart} items={items} setCart={setCart} source={source}
            onPlaced={(ref) => {
              writeJson(placedKey(store.slug), [ref, ...readJson<PlacedRef[]>(placedKey(store.slug), [])].slice(0, 10));
              setCart([]);
              setCheckout(false);
              void navigate({ search: { ...(tableId ? { table: tableId } : {}), o: ref.id, k: ref.token } });
            }} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Estimated bill with GST, using the dishes' own GST rates. */
function estimate(store: Storefront, lines: { itemId: string; price: number; qty: number }[], items: MenuItem[]) {
  const rate = new Map(items.map((i) => [i.id, i.gstRate]));
  const cartLines: CartLine[] = lines.map((l, n) => ({ itemId: `${l.itemId}:${n}`, name: "", price: l.price, qty: l.qty, veg: true, gstRate: rate.get(l.itemId) ?? 5, station: "" }));
  return computeTotals(cartLines, 0, 0, { inclusive: store.pricesIncludeGst, exempt: store.gstMode !== "regular", roundToRupee: true });
}

function Checkout({ store, channel, tableId, tableLabel, cart, items, setCart, onPlaced, source }: {
  store: Storefront; channel: GuestChannel; tableId?: string | undefined; tableLabel?: string | undefined; cart: GuestCartLine[]; items: MenuItem[]; source: string;
  setCart: (update: (c: GuestCartLine[]) => GuestCartLine[]) => void; onPlaced: (ref: PlacedRef) => void;
}) {
  const saved = readJson<{ name?: string; phone?: string; optIn?: boolean }>("xtsy-guest-contact", {});
  const askOptIn = store.branding?.askOptIn !== false;
  // Never pre-ticked: offers only go to guests who choose them.
  const [optIn, setOptIn] = useState(false);
  const [name, setName] = useState(saved.name ?? "");
  const [phone, setPhone] = useState(saved.phone ?? "");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"counter" | "upi">("counter");
  const slots = useMemo(() => pickupChoices(new Date(), store.prepMinutes), [store.prepMinutes]);
  const [pickup, setPickup] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const totals = estimate(store, cart, items);
  const digits = phone.replace(/\D/g, "");
  const short = channel === "online" && store.minOrder > 0 && totals.subtotal < store.minOrder;
  const missing = (channel === "online" && (name.trim().length < 2 || digits.length < 10)) || (optIn && digits.length < 10);

  const place = async () => {
    if (submitting.current || !cart.length || short || missing || store.paused) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    writeJson("xtsy-guest-contact", { name: name.trim(), phone: phone.trim(), optIn });
    try {
      const { data, error: failure } = await supabase.rpc("place_guest_order", {
        _slug: store.slug, _channel: channel, _table_id: tableId ?? "", _name: name.trim(), _phone: phone.trim(), _note: note.trim(),
        _lines: guestOrderPayload(cart) as never, _payment: payment, ...(pickup ? { _pickup_at: pickup } : {}),
      });
      if (failure || !data) { setError(failure?.message ?? "Couldn't confirm your order. Check with the staff before trying again."); return; }
      const r = data as unknown as { id: string; token: string; code: string };
      // Confirmation is durable before optional consent recording; its failure must not encourage a duplicate order.
      const ref = { id: r.id, token: r.token, code: r.code, at: Date.now() };
      onPlaced(ref);
      void recordGuestChoice(r.id, r.token, askOptIn && optIn, source).catch(() => {});
    } catch {
      setError("Couldn't confirm whether your order arrived. Your cart is saved; check with the staff before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return (
    <div>
      <DialogTitle>{channel === "table" ? `Your order for table ${tableLabel ?? ""}` : "Your pickup order"}</DialogTitle>
      <ul className="mt-3 divide-y divide-border">
        {cart.map((l) => (
          <li key={l.key} className="flex items-center gap-3 py-2.5">
            <VegMark veg={l.veg ?? false} />
            <div className="min-w-0 flex-1"><p className="text-sm font-medium leading-snug">{l.name}</p><p className="text-xs text-muted-foreground">{formatINR(l.price, 0)} each</p></div>
            <div className="flex items-center rounded-lg border border-input">
              <button type="button" aria-label="One less" className="p-1.5" onClick={() => setCart((c) => setGuestQty(c, l.key, l.qty - 1))}><Minus className="size-3.5" /></button>
              <span className="w-6 text-center text-sm font-semibold">{l.qty}</span>
              <button type="button" aria-label="One more" className="p-1.5" onClick={() => setCart((c) => setGuestQty(c, l.key, l.qty + 1))}><Plus className="size-3.5" /></button>
            </div>
            <span className="w-16 text-right text-sm font-semibold">{formatINR(l.price * l.qty, 0)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 space-y-1 rounded-xl bg-secondary/70 p-3 text-sm">
        <div className="flex justify-between text-muted-foreground"><span>Items</span><span>{formatINR(totals.subtotal)}</span></div>
        {totals.cgst + totals.sgst > 0 ? <div className="flex justify-between text-muted-foreground"><span>GST{store.pricesIncludeGst ? " (included)" : ""}</span><span>{formatINR(totals.cgst + totals.sgst)}</span></div> : null}
        <div className="flex justify-between text-base font-bold"><span>Estimated total</span><span>{formatINR(totals.total, 0)}</span></div>
        <p className="text-[11px] text-muted-foreground">Your final bill comes from the restaurant.</p>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block text-sm font-medium">{channel === "table" ? "Your name (optional)" : "Your name"}
          <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
        </label>
        {channel === "table" && askOptIn ? (
          <label className="block text-sm font-medium">Mobile number {optIn ? "" : "(optional)"}
            <input value={phone} maxLength={15} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value.replace(/[^0-9+ ]/g, ""))} placeholder="98765 43210" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
          </label>
        ) : null}
        {channel === "online" ? <>
          <label className="block text-sm font-medium">Mobile number
            <input value={phone} maxLength={15} inputMode="tel" autoComplete="tel" onChange={(e) => setPhone(e.target.value.replace(/[^0-9+ ]/g, ""))} placeholder="98765 43210" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">The restaurant calls this number if anything changes.</span>
          </label>
          <label className="block text-sm font-medium">Pickup time
            <Dropdown ariaLabel="Pickup time" className="mt-1 h-11" value={pickup} onChange={setPickup} searchable={false}
              options={slots.map((c) => ({ value: c.at ?? "", label: c.label }))} />
          </label>
        </> : null}
        {askOptIn ? (
          <label className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-sm">
            <input type="checkbox" checked={optIn} onChange={(e) => setOptIn(e.target.checked)} className="mt-0.5 size-5 shrink-0 accent-primary" />
            <span><span className="flex items-center gap-1.5 font-semibold"><Send className="size-4 text-success" />Get offers from {store.name} on WhatsApp</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">New dishes and deals, now and then. Reply STOP any time to stop.</span>
              {optIn && digits.length < 10 ? <span className="mt-1 block text-xs font-semibold text-destructive">Add your mobile number above to get offers.</span> : null}</span>
          </label>
        ) : null}
        <label className="block text-sm font-medium">Anything the kitchen should know?
          <textarea value={note} maxLength={240} rows={2} onChange={(e) => setNote(e.target.value)} placeholder="Less spicy, no onion, allergies…" className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm" />
        </label>
        {store.upiVpa ? (
          <fieldset>
            <legend className="text-sm font-medium">Payment</legend>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {([["counter", channel === "table" ? "Pay at the end" : "Pay at pickup", Store], ["upi", "Pay now by UPI", Smartphone]] as const).map(([v, l, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={payment === v} onClick={() => setPayment(v)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-semibold ${payment === v ? "border-primary bg-primary-tint" : "border-border"}`}><Icon className="size-4" />{l}</button>
              ))}
            </div>
          </fieldset>
        ) : null}
      </div>

      {short ? <p className="mt-3 text-sm font-semibold text-destructive">The minimum pickup order is {formatINR(store.minOrder, 0)}.</p> : null}
      {error ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      <Button className="mt-4 h-12 w-full text-base" disabled={busy || !cart.length || short || missing || store.paused} onClick={() => void place()}>
        {busy ? "Sending…" : `Place order · ${formatINR(totals.total, 0)}`}
      </Button>
    </div>
  );
}

/* ---------------- order tracking ---------------- */

interface StatusView {
  id: string; code: string; channel: GuestChannel; status: GuestStatus; reason: string; tableLabel: string | null;
  lines: GuestLine[]; subtotal: number; payment: "counter" | "upi"; billNo: string | null; createdAt: string; pickupAt: string | null;
}

const STEPS: { status: GuestStatus; label: string; icon: typeof Check }[] = [
  { status: "new", label: "Sent", icon: Check },
  { status: "accepted", label: "Preparing", icon: ChefHat },
  { status: "ready", label: "Ready", icon: ShoppingBag },
];

function OrderStatus({ store, id, token, table }: { store: Storefront; id: string; token: string; table?: string | undefined }) {
  const navigate = Route.useNavigate();
  const [upiRef, setUpiRef] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const status = useQuery({
    queryKey: ["guest-order", id, token],
    queryFn: async () => {
      const { data, error: failure } = await supabase.rpc("guest_order_status", { _id: id, _token: token });
      if (failure) throw failure;
      return (data ?? null) as unknown as StatusView | null;
    },
    refetchInterval: (query) => {
      const s = (query.state.data as StatusView | null | undefined)?.status;
      return s === "new" || s === "accepted" || (s === "ready" && store.online) ? 5000 : false;
    },
  });
  const o: StatusView | null | undefined = status.data;
  const items = useMemo(() => store.menu.map(asMenuItem), [store.menu]);
  if (status.isLoading) return <div className="p-5"><div className="h-40 animate-pulse rounded-2xl bg-card" /></div>;
  if (status.isError) return <Notice icon={Clock} title="Order updates are unavailable" body="Your order may still be with the restaurant. Check your connection; do not place it again." action={<Button onClick={() => void status.refetch()}>Refresh status</Button>} />;
  if (!o) return <Notice icon={Store} title="Order not found" body="This order link has expired. Please ask the staff." />;

  const totals = estimate(store, o.lines, items);
  const stepIndex = o.status === "completed" ? 3 : STEPS.findIndex((s) => s.status === o.status);
  const ended = o.status === "rejected" || o.status === "cancelled";
  const backToMenu = () => void navigate({ search: table ? { table } : {} });

  const cancel = async () => {
    setError("");
    const { error: failure } = await supabase.rpc("guest_order_update", { _id: id, _token: token, _cancel: true });
    if (failure) setError(failure.message); else void status.refetch();
  };
  const sendRef = async () => {
    const { error: failure } = await supabase.rpc("guest_order_update", { _id: id, _token: token, _upi_ref: upiRef });
    if (failure) setError(failure.message); else setSent(true);
  };

  return (
    <div className="px-4 pt-5">
      <button type="button" onClick={backToMenu} className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="size-4" />Menu</button>
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{o.channel === "table" ? placeName(o.tableLabel ?? "") : "Pickup order"}</p>
        <div className="mt-1 flex items-end justify-between gap-3">
          <h1 className="text-4xl font-extrabold tracking-tight">{o.code}</h1>
          {o.billNo ? <span className="text-xs text-muted-foreground">Bill {o.billNo}</span> : null}
        </div>
        <p className={`mt-2 text-base font-bold ${ended ? "text-destructive" : "text-primary"}`} role="status" aria-live="polite">{GUEST_STATUS_LABEL[o.status]}</p>
        {o.reason && ended ? <p className="mt-1 text-sm text-muted-foreground">{o.reason}</p> : null}
        {o.channel === "online" && o.pickupAt && !ended ? <p className="mt-1 text-sm text-muted-foreground">Pickup at {new Date(o.pickupAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</p> : null}

        {!ended ? (
          <ol className="mt-5 grid grid-cols-3 gap-2" aria-label="Order progress">
            {(o.channel === "table" ? STEPS.slice(0, 2) : STEPS).map((step, i) => {
              const done = i <= stepIndex;
              const Icon = step.icon;
              return (
                <li key={step.status} className="flex flex-col items-center gap-1.5 text-center">
                  <span className={`flex size-10 items-center justify-center rounded-full ${done ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"} ${i === stepIndex && o.status !== "completed" ? "ring-4 ring-primary/20" : ""}`}><Icon className="size-5" /></span>
                  <span className={`text-xs font-semibold ${done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {o.channel === "table" && o.status === "accepted" ? <p className="mt-4 text-sm text-muted-foreground">The kitchen has your order. It comes to your table as soon as it's ready.</p> : null}
        {o.status === "new" ? <p className="mt-4 text-sm text-muted-foreground">Waiting for the restaurant to confirm. This usually takes a minute.</p> : null}
      </div>

      <div className="mt-3 rounded-2xl border border-border bg-card p-5">
        <ul className="space-y-1.5 text-sm">
          {o.lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-3"><span className="min-w-0">{l.qty} × {l.name}{l.note ? <span className="block text-xs text-muted-foreground">{l.note}</span> : null}</span><span className="shrink-0 font-medium">{formatINR(l.price * l.qty, 0)}</span></li>
          ))}
        </ul>
        <div className="mt-3 flex justify-between border-t border-border pt-3 font-bold"><span>Estimated total</span><span>{formatINR(totals.total, 0)}</span></div>
      </div>

      {o.payment === "upi" && store.upiVpa && !ended ? (
        <div className="mt-3 rounded-2xl border border-border bg-card p-5">
          <p className="font-semibold">Pay by UPI</p>
          <p className="mt-1 text-sm text-muted-foreground">Pays {store.name} directly. Show the payment to the staff when you {o.channel === "table" ? "leave" : "pick up"}.</p>
          <a href={upiLink({ vpa: store.upiVpa, name: store.name, amount: totals.total, billNo: o.code })}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"><Smartphone className="size-4" />Pay {formatINR(totals.total, 0)} in a UPI app</a>
          {sent ? <p className="mt-3 text-sm font-semibold text-success">Thanks, the restaurant can see your payment reference.</p> : (
            <div className="mt-3 flex gap-2">
              <input value={upiRef} onChange={(e) => setUpiRef(e.target.value)} maxLength={40} placeholder="UPI reference number (optional)" className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-sm" />
              <Button variant="outline" disabled={upiRef.trim().length < 6} onClick={() => void sendRef()}>Send</Button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
      {!ended ? <StayConnected store={store} code={o.code} /> : null}
      <div className="mt-4 flex flex-col gap-2">
        {o.status === "new" ? <Button variant="outline" className="text-destructive" onClick={() => void cancel()}><X />Cancel this order</Button> : null}
        {o.channel === "table" || ended ? <Button variant="secondary" onClick={backToMenu}><Plus />Order more</Button> : null}
        {store.phone ? <a href={`tel:${store.phone}`} className="text-center text-sm font-semibold text-primary">Call the restaurant</a> : null}
      </div>
      <p className="mt-6 text-center text-xs text-muted-foreground">Keep this page open, or come back to it from the menu.</p>
      <Link to="/order/$slug" params={{ slug: store.slug }} search={table ? { table } : {}} className="sr-only">Back to the menu</Link>
    </div>
  );
}

/* ---------------- after ordering: follow, review, chat ---------------- */

const LINK_ICONS: Record<keyof BrandLinks, typeof Star> = { instagram: Share, googleReview: Star, website: ExternalLink, stays: MapPin, voyage: Sparkles };

function StayConnected({ store, code }: { store: Storefront; code: string }) {
  const brand = store.branding ?? {};
  const links = (Object.keys(LINK_LABELS) as (keyof BrandLinks)[]).filter((k) => brand.links?.[k]);
  if (!links.length && !brand.whatsapp) return null;
  return (
    <section className="mt-3 rounded-2xl border border-border bg-card p-5" aria-label="Stay connected">
      <p className="font-bold">Enjoying {store.name}?</p>
      <p className="mt-0.5 text-sm text-muted-foreground">While you wait, say hello.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {brand.whatsapp ? (
          <a href={waLink(brand.whatsapp, `Hi ${store.name}! I just placed order ${code}.`)} target="_blank" rel="noreferrer"
            className="col-span-2 flex items-center justify-center gap-2 rounded-xl bg-success px-3 py-3 text-sm font-semibold text-white"><Send className="size-4" />Chat with us on WhatsApp</a>
        ) : null}
        {links.map((k) => {
          const Icon = LINK_ICONS[k];
          return (
            <a key={k} href={brand.links?.[k]} target="_blank" rel="noreferrer"
              className={`flex items-center gap-2 rounded-xl border border-border px-3 py-2.5 text-sm font-semibold hover:border-primary ${k === "googleReview" ? "col-span-2 justify-center bg-primary-tint text-primary" : ""}`}>
              <Icon className="size-4 shrink-0" /><span className="truncate">{k === "googleReview" ? "Loved it? Leave us a Google review" : LINK_LABELS[k]}</span>
              {k === "googleReview" ? null : <ExternalLink className="ml-auto size-3.5 shrink-0 text-muted-foreground" />}
            </a>
          );
        })}
      </div>
    </section>
  );
}
