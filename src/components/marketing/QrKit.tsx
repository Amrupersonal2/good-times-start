import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import QRCode from "qrcode";
import { Check, Copy, Download, LayoutGrid, Printer, QrCode, Store, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dropdown } from "@/components/Dropdown";
import { getDb } from "@/lib/db";
import { orderPageUrl } from "@/lib/guest-order-logic";
import { SCAN_SOURCES, activeOffers, cleanSource, type Branding } from "@/lib/marketing-logic";
import { PRINT_DESIGNS, QR_LIGHT, buildPrintSheet, qrInk, type PrintCard, type PrintDesign } from "@/lib/qr-print";
import type { OrderingConfig } from "@/lib/saas-logic";
import { cn } from "@/lib/utils";

const input = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";
const HEADLINES: Record<PrintDesign, string> = { tent: "Scan to order", sticker: "Scan to order", poster: "Order from your phone", standee: "Order ahead, skip the queue" };
const ICONS: Record<PrintDesign, typeof QrCode> = { tent: UtensilsCrossed, sticker: LayoutGrid, poster: QrCode, standee: Store };

async function qrImage(url: string, brand: Branding, width = 720) {
  // High error correction leaves room for the logo printed in the middle.
  return QRCode.toDataURL(url, { width, margin: 1, errorCorrectionLevel: "H", color: { dark: qrInk(brand), light: QR_LIGHT } });
}

export function QrKit({ slug, restaurantName, brand, ordering }: { slug: string; restaurantName: string; brand: Branding; ordering: OrderingConfig }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const sorted = useMemo(() => [...tables].sort((a, b) => a.section.localeCompare(b.section) || a.label.localeCompare(b.label, undefined, { numeric: true })), [tables]);
  const sections = useMemo(() => [...new Set(sorted.map((t) => t.section))], [sorted]);
  const [design, setDesign] = useState<PrintDesign>("tent");
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = all tables
  const [source, setSource] = useState("poster");
  const [headline, setHeadline] = useState(HEADLINES.tent);
  const [subline, setSubline] = useState("Scan · Order · Relax");
  const offers = activeOffers(brand.offers, Date.now());
  const [offer, setOffer] = useState("");
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = PRINT_DESIGNS.find((d) => d.id === design)!;
  const chosen = sorted.filter((t) => !picked || picked.has(t.id));
  const linkFor = (tableId?: string) => orderPageUrl(origin, slug, tableId, tableId ? cleanSource(tableId) : source);
  const shareUrl = linkFor();

  useEffect(() => { setHeadline(HEADLINES[design]); }, [design]);
  useEffect(() => {
    let live = true;
    void qrImage(meta.perTable && chosen[0] ? linkFor(chosen[0].id) : shareUrl, brand, 360).then((d) => { if (live) setPreview(d); }).catch(() => setPreview(""));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [design, source, slug, brand.color, chosen[0]?.id]);

  const toggle = (id: string) => setPicked((p) => {
    const next = new Set(p ?? sorted.map((t) => t.id));
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleSection = (section: string) => setPicked((p) => {
    const next = new Set(p ?? sorted.map((t) => t.id));
    const ids = sorted.filter((t) => t.section === section).map((t) => t.id);
    const allIn = ids.every((id) => next.has(id));
    for (const id of ids) if (allIn) next.delete(id); else next.add(id);
    return next;
  });

  const print = async () => {
    setBusy(true);
    try {
      const targets = meta.perTable ? chosen.map((t) => ({ label: `Table ${t.label}`, url: linkFor(t.id) })) : Array.from({ length: meta.perSheet }, () => ({ label: "", url: shareUrl }));
      if (!targets.length) { toast.error("Choose at least one table"); return; }
      const cards: PrintCard[] = await Promise.all(targets.map(async (t) => ({ ...t, qr: await qrImage(t.url, brand) })));
      const html = buildPrintSheet(design, cards, { restaurant: restaurantName, brand, headline: headline.trim() || HEADLINES[design], subline: subline.trim(), ...(offer ? { offer } : {}) });
      const win = window.open("", "_blank", "width=900,height=1000");
      if (!win) { toast.error("Allow pop-ups for this site to print"); return; }
      win.document.write(html);
      win.document.close();
    } catch {
      toast.error("Couldn't prepare the QR codes. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const download = async () => {
    const data = await qrImage(shareUrl, brand, 1080);
    const a = document.createElement("a");
    a.href = data;
    a.download = `${slug}-qr-${source}.png`;
    a.click();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(shareUrl); toast.success("Link copied"); } catch { toast.error("Couldn't copy. Select the link and copy it."); }
  };

  const orderingOff = !ordering.table && !ordering.online;
  return (
    <div className="space-y-6">
      {orderingOff || (meta.perTable && !ordering.table) ? (
        <div className="rounded-xl border border-gold/50 bg-gold/10 p-4 text-sm">
          <p className="font-semibold">{meta.perTable ? "QR ordering at tables is switched off." : "Guest ordering is switched off."} Guests who scan will see the menu but can't order.</p>
          <Link to="/settings" hash="ordering" className="mt-1 inline-block font-semibold text-primary">Turn it on in Settings → Ordering</Link>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="What to print">
        {PRINT_DESIGNS.map((d) => {
          const Icon = ICONS[d.id];
          return (
            <button key={d.id} type="button" role="radio" aria-checked={design === d.id} onClick={() => setDesign(d.id)}
              className={cn("rounded-2xl border p-4 text-left transition-colors", design === d.id ? "border-primary bg-primary-tint" : "border-border bg-card hover:border-primary/50")}>
              <span className="flex items-center justify-between"><Icon className="size-5 text-primary" />{design === d.id ? <Check className="size-4 text-primary" /> : null}</span>
              <span className="mt-2 block font-semibold">{d.label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{d.hint}</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-4">
          {meta.perTable ? (
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Tables ({chosen.length} of {sorted.length})</p>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>All</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>None</Button>
                </div>
              </div>
              {sorted.length ? (
                <div className="mt-2 space-y-2">
                  {sections.map((section) => (
                    <div key={section}>
                      <button type="button" onClick={() => toggleSection(section)} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">{section || "Tables"}</button>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {sorted.filter((t) => t.section === section).map((t) => {
                          const on = !picked || picked.has(t.id);
                          return <button key={t.id} type="button" aria-pressed={on} onClick={() => toggle(t.id)}
                            className={cn("min-w-11 rounded-lg border px-2.5 py-1.5 text-sm font-semibold", on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card")}>{t.label}</button>;
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="mt-1 text-sm text-muted-foreground">Add tables in Tables first.</p>}
              <p className="mt-2 text-xs text-muted-foreground">Each code opens that table's menu, and orders join that table's bill. Scans are counted per table in Results.</p>
            </div>
          ) : (
            <div className="text-sm font-medium">Where will it go?
              <Dropdown ariaLabel="Where the QR code will be used" className="mt-1 h-11" value={source} onChange={setSource} options={SCAN_SOURCES.map((s) => ({ value: s.id, label: s.label }))} />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">Results shows how many people scanned each one and how many ordered.</span>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Headline
              <input value={headline} maxLength={40} onChange={(e) => setHeadline(e.target.value)} className={input} />
            </label>
            <label className="block text-sm font-medium">Line under the code
              <input value={subline} maxLength={50} onChange={(e) => setSubline(e.target.value)} className={input} />
            </label>
            {!meta.perTable ? (
              <div className="text-sm font-medium sm:col-span-2">Feature an offer
                <Dropdown ariaLabel="Offer to feature" className="mt-1 h-11" value={offer} onChange={setOffer}
                  options={[{ value: "", label: "No offer" }, ...offers.map((o) => ({ value: o.title, label: o.title }))]} />
                {!offers.length ? <span className="mt-1 block text-xs font-normal text-muted-foreground">Add offers under Brand.</span> : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || (meta.perTable && !chosen.length)} onClick={() => void print()}><Printer />{busy ? "Preparing…" : meta.perTable ? `Print ${chosen.length} ${meta.label.toLowerCase()}${chosen.length === 1 ? "" : "s"}` : `Print ${meta.label.toLowerCase()}`}</Button>
          </div>
          <p className="text-xs text-muted-foreground">Prints on A4. For tents, print on thick paper or card, cut along the outside and fold on the dashed line.</p>
        </div>

        <aside className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-semibold">{meta.perTable ? `Sample: Table ${chosen[0]?.label ?? ""}` : "Code for sharing"}</p>
          <div className="relative mx-auto mt-3 w-44">
            {preview ? <img src={preview} alt="QR code preview" className="w-44 rounded-lg border border-border bg-white p-1" /> : <div className="h-44 rounded-lg bg-secondary" />}
            {brand.logo && preview ? <span className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 rounded-md bg-white p-0.5"><img src={brand.logo} alt="" className="size-full object-contain" /></span> : null}
          </div>
          {!meta.perTable ? <>
            <p className="mt-3 break-all rounded-lg bg-secondary px-2 py-1.5 text-[11px]">{shareUrl}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void copy()}><Copy />Copy link</Button>
              <Button size="sm" variant="outline" onClick={() => void download()}><Download />PNG</Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Use the PNG in Instagram stories, Google posts or WhatsApp status.</p>
          </> : null}
        </aside>
      </div>
    </div>
  );
}
