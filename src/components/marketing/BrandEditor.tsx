import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { BadgePercent, Check, Plus, Share, Star, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dropdown } from "@/components/Dropdown";
import { getDb } from "@/lib/db";
import { compressImage, saveBranding } from "@/lib/marketing-actions";
import { BRAND_SWATCHES, LINK_LABELS, activeOffers, brandPalette, sanitizeBranding, type BrandLinks, type Branding, type Offer } from "@/lib/marketing-logic";
import { cn } from "@/lib/utils";

type Patch<T> = { [K in keyof T]?: T[K] | undefined };
function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

const input = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 border-t border-border py-7 first:border-t-0 first:pt-0 lg:grid-cols-[15rem_1fr]">
      <div><h2 className="text-base font-bold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{hint}</p></div>
      <div className="min-w-0 space-y-3">{children}</div>
    </section>
  );
}

function ImagePicker({ label, hint, value, onChange, maxWidth, maxHeight, shape }: {
  label: string; hint: string; value: string | undefined; onChange: (v: string | undefined) => void; maxWidth: number; maxHeight: number; shape: "square" | "wide";
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try { onChange(await compressImage(file, maxWidth, maxHeight)); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't use that picture"); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
  };
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => ref.current?.click()} aria-label={`Choose ${label.toLowerCase()}`}
        className={cn("flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-input bg-secondary text-muted-foreground hover:border-primary", shape === "square" ? "size-20" : "h-20 w-36")}>
        {value ? <img src={value} alt="" className={cn("size-full", shape === "square" ? "object-contain p-1" : "object-cover")} /> : <Upload className="size-5" />}
      </button>
      <div className="min-w-0 text-sm">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Preparing…" : value ? "Change" : "Upload"}</Button>
          {value ? <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}><X />Remove</Button> : null}
        </div>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => void pick(e.target.files?.[0])} />
    </div>
  );
}

/** What a guest sees after scanning, updated as you type. */
function PhonePreview({ name, brand }: { name: string; brand: Branding }) {
  const palette = brandPalette(brand.color);
  const offers = activeOffers(brand.offers, Date.now());
  return (
    <div className="mx-auto w-[17rem] rounded-[2.2rem] border-[6px] border-foreground/85 bg-background shadow-xl" style={(palette ?? undefined) as CSSProperties | undefined} aria-label="Preview of the guest ordering page">
      <div className="h-[30rem] overflow-hidden rounded-[1.7rem]">
        <div className="relative overflow-hidden bg-sidebar">
          {brand.cover ? <img src={brand.cover} alt="" className="absolute inset-0 size-full object-cover" /> : <div className="absolute -right-6 -top-6 size-24 rounded-full bg-primary/40" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
          <div className={cn("relative px-3 pb-3", brand.cover ? "pt-16" : "pt-5")}>
            <div className="flex items-end gap-2">
              {brand.logo ? <img src={brand.logo} alt="" className="size-10 rounded-xl bg-white object-contain p-0.5 ring-2 ring-white/70" /> : null}
              <div className="min-w-0"><p className="truncate text-base font-extrabold text-white">{name || "Your restaurant"}</p>{brand.tagline ? <p className="truncate text-[11px] text-white/90">{brand.tagline}</p> : null}</div>
            </div>
          </div>
        </div>
        <div className="space-y-2 p-2.5">
          {brand.welcome ? <p className="rounded-xl border border-border bg-card p-2 text-[11px]">{brand.welcome}</p> : null}
          {offers[0] ? (
            <div className="rounded-xl bg-primary p-2.5 text-primary-foreground">
              <p className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider opacity-85"><BadgePercent className="size-3" />Offer</p>
              <p className="text-sm font-extrabold leading-tight">{offers[0].title}</p>
              {offers[0].detail ? <p className="text-[10px] opacity-90">{offers[0].detail}</p> : null}
            </div>
          ) : null}
          <div className="flex gap-1">{["Starters", "Mains", "Drinks"].map((c, i) => <span key={c} className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", i === 0 ? "bg-primary text-primary-foreground" : "bg-card ring-1 ring-border")}>{c}</span>)}</div>
          {["Paneer tikka", "Veg momos", "Masala chai"].map((d) => (
            <div key={d} className="flex items-center justify-between rounded-xl border border-border bg-card p-2">
              <span className="text-[11px] font-semibold">{d}</span>
              <span className="rounded-md border border-primary px-2 py-0.5 text-[10px] font-bold text-primary">Add</span>
            </div>
          ))}
          {brand.askOptIn !== false ? <p className="rounded-xl border border-border bg-card p-2 text-[10px]"><Check className="mr-1 inline size-3 text-success" />Get offers on WhatsApp (guest chooses)</p> : null}
        </div>
      </div>
    </div>
  );
}

export function BrandEditor({ restaurantId, restaurantName, saved }: { restaurantId: string; restaurantName: string; saved: Branding }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Branding>(saved);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(saved); }, [saved]);
  const menu = useLiveQuery(() => getDb().menu.toArray(), [], []);
  const dishOptions = useMemo(() => [{ value: "", label: "No dish" }, ...[...menu].sort((a, b) => a.name.localeCompare(b.name)).map((m) => ({ value: m.id, label: m.name, group: m.category }))], [menu]);
  const set = (patch: Patch<Branding>) => setForm((f) => dropUndefined({ ...f, ...patch }) as Branding);
  const setLink = (k: keyof BrandLinks, v: string) => setForm((f) => ({ ...f, links: { ...f.links, [k]: v } }));
  const setOffer = (i: number, patch: Patch<Offer>) => setForm((f) => ({ ...f, offers: (f.offers ?? []).map((o, n) => (n === i ? dropUndefined({ ...o, ...patch }) as Offer : o)) }));
  const clean = sanitizeBranding(form);
  const dirty = JSON.stringify(clean) !== JSON.stringify(sanitizeBranding(saved));
  const size = JSON.stringify(clean).length;

  const save = async () => {
    setBusy(true);
    const error = await saveBranding(restaurantId, form);
    setBusy(false);
    if (error) { toast.error(error); return; }
    toast.success("Brand saved. Guests see it on their next scan.");
    void queryClient.invalidateQueries({ queryKey: ["branding", restaurantId] });
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_19rem]">
      <div>
        <Section title="Look" hint="Your logo, a cover photo and your colour make the menu feel like yours. Pictures are shrunk automatically so the page loads fast on mobile data.">
          <ImagePicker label="Logo" hint="Square works best. Also printed in the middle of every QR code." value={form.logo} onChange={(v) => set({ logo: v })} maxWidth={320} maxHeight={320} shape="square" />
          <ImagePicker label="Cover photo" hint="A wide photo of your food or place, shown at the top." value={form.cover} onChange={(v) => set({ cover: v })} maxWidth={1280} maxHeight={720} shape="wide" />
          <div>
            <p className="text-sm font-medium">Brand colour</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {BRAND_SWATCHES.map((sw) => (
                <button key={sw.hex} type="button" title={sw.name} aria-label={sw.name} aria-pressed={form.color === sw.hex} onClick={() => set({ color: sw.hex })}
                  style={{ backgroundColor: sw.hex }} className={cn("size-9 rounded-full ring-offset-2 ring-offset-card", form.color === sw.hex && "ring-2 ring-foreground")} />
              ))}
              <label className="ml-1 inline-flex items-center gap-2 text-xs text-muted-foreground">Any colour
                <input type="color" value={form.color ?? BRAND_SWATCHES[BRAND_SWATCHES.length - 1]?.hex} onChange={(e) => set({ color: e.target.value })} className="h-9 w-12 cursor-pointer rounded-lg border border-input bg-card" />
              </label>
              {form.color ? <Button size="sm" variant="ghost" onClick={() => set({ color: undefined })}>Default</Button> : null}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Very light colours are deepened a little so buttons stay readable.</p>
          </div>
          <label className="block text-sm font-medium">Tagline
            <input value={form.tagline ?? ""} maxLength={90} onChange={(e) => set({ tagline: e.target.value })} placeholder="Café & kitchen in the pines of New Shillong" className={input} />
          </label>
          <label className="block text-sm font-medium">Welcome note
            <input value={form.welcome ?? ""} maxLength={160} onChange={(e) => set({ welcome: e.target.value })} placeholder="Welcome! Wi-Fi: TAB-Guest · Ask us about tonight's specials" className={input} />
          </label>
        </Section>

        <Section title="Offers" hint="Shown as a banner at the top of the menu. Link a dish and the banner jumps straight to it. Offers disappear by themselves after their last day.">
          {(form.offers ?? []).map((o, i) => (
            <div key={i} className="rounded-xl border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-sm font-medium sm:col-span-2">Offer
                  <input value={o.title} maxLength={60} onChange={(e) => setOffer(i, { title: e.target.value })} placeholder="Chai + bun combo ₹99" className={input} />
                </label>
                <label className="block text-sm font-medium sm:col-span-2">Details (optional)
                  <input value={o.detail ?? ""} maxLength={120} onChange={(e) => setOffer(i, { detail: e.target.value })} placeholder="Every day 4–6 pm" className={input} />
                </label>
                <label className="block text-sm font-medium">Show until (optional)
                  <input type="date" value={o.until ?? ""} onChange={(e) => setOffer(i, { until: e.target.value })} className={input} />
                </label>
                <div className="text-sm font-medium">Dish (optional)
                  <Dropdown ariaLabel="Dish for this offer" className="mt-1 h-11" value={o.itemId ?? ""} onChange={(v) => setOffer(i, { itemId: v || undefined })} options={dishOptions} />
                </div>
              </div>
              <Button size="sm" variant="ghost" className="mt-2 text-destructive" onClick={() => setForm((f) => ({ ...f, offers: (f.offers ?? []).filter((_, n) => n !== i) }))}><Trash2 />Remove offer</Button>
            </div>
          ))}
          {(form.offers ?? []).length < 5 ? <Button variant="outline" onClick={() => setForm((f) => ({ ...f, offers: [...(f.offers ?? []), { id: `o${Date.now().toString(36)}`, title: "" }] }))}><Plus />Add an offer</Button> : null}
        </Section>

        <Section title="Links" hint="After ordering, guests see these: follow, review, and your other businesses. Your Instagram handle and WhatsApp number are also printed on the QR cards.">
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(LINK_LABELS) as (keyof BrandLinks)[]).map((k) => (
              <label key={k} className="block text-sm font-medium">{k === "googleReview" ? <><Star className="mr-1 inline size-3.5" />Google review link</> : k === "instagram" ? <><Share className="mr-1 inline size-3.5" />Instagram handle or link</> : LINK_LABELS[k]}
                <input value={form.links?.[k] ?? ""} maxLength={300} onChange={(e) => setLink(k, e.target.value)}
                  placeholder={{ instagram: "@tabbistro", googleReview: "g.page/r/…/review", website: "xtsy.one", stays: "xtsy.one/stays", voyage: "youtube.com/@XTSY_Voyage" }[k]} className={input} />
              </label>
            ))}
            <label className="block text-sm font-medium">Restaurant WhatsApp number
              <input value={form.whatsapp ?? ""} maxLength={18} inputMode="tel" onChange={(e) => set({ whatsapp: e.target.value })} placeholder="98765 43210" className={input} />
            </label>
          </div>
        </Section>

        <Section title="WhatsApp consent" hint="Guests choose whether they want offers. It's never pre-ticked, and campaigns only ever go to guests who said yes.">
          <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
            <Switch checked={form.askOptIn !== false} onCheckedChange={(v) => set({ askOptIn: v })} className="mt-0.5" />
            <span><span className="font-medium">Ask guests at checkout</span><span className="mt-0.5 block text-xs text-muted-foreground">"Get offers from {restaurantName || "us"} on WhatsApp", with a mobile number.</span></span>
          </label>
        </Section>

        <div className="sticky bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom))] -mx-4 lg:bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-card/95 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8">
          <Button disabled={!dirty || busy || size > 690_000} onClick={() => void save()}>{busy ? "Saving…" : "Save brand"}</Button>
          {dirty ? <Button variant="ghost" onClick={() => setForm(saved)}>Undo changes</Button> : <span className="text-sm text-muted-foreground">All changes saved</span>}
          {size > 690_000 ? <span className="text-sm text-destructive">The pictures are too large together. Use a smaller cover photo.</span> : null}
        </div>
      </div>
      <div className="hidden xl:block"><div className="sticky top-24"><PhonePreview name={restaurantName} brand={clean} /><p className="mt-3 text-center text-xs text-muted-foreground">Live preview</p></div></div>
    </div>
  );
}
