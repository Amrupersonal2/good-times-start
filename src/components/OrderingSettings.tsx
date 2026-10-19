import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import QRCode from "qrcode";
import { Copy, ExternalLink, Printer, QrCode } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { getDb } from "@/lib/db";
import { isAdmin, useStaff } from "@/lib/auth-context";
import { useAccount } from "@/lib/use-account";
import { saveOrderingConfig } from "@/lib/guest-order-actions";
import { orderPageUrl } from "@/lib/guest-order-logic";
import { hasFeature, slugError, type OrderingConfig } from "@/lib/saas-logic";
import { useRestaurantSettings } from "@/lib/use-settings";

const inputClass = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm disabled:bg-secondary disabled:text-muted-foreground";

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
      {children}
      <span><span className="font-medium">{title}</span>{hint ? <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span> : null}</span>
    </label>
  );
}

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** An A4 sheet of table cards, each with its QR code, printed from its own window. */
async function printTableCards(restaurant: string, cards: { label: string; section: string; url: string }[]) {
  const images = await Promise.all(cards.map((c) => QRCode.toDataURL(c.url, { width: 360, margin: 1, errorCorrectionLevel: "M" })));
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) { toast.error("Allow pop-ups for this site to print the QR cards"); return; }
  const body = cards.map((c, i) => `
    <div class="card">
      <div class="name">${escapeHtml(restaurant)}</div>
      <img src="${images[i]}" alt="" />
      <div class="table">Table ${escapeHtml(c.label)}</div>
      <div class="hint">Scan to see the menu and order</div>
    </div>`).join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Table QR codes</title><style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Figtree, system-ui, sans-serif; margin: 0; color: #17352e; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8mm; }
    .card { border: 1.5px solid #17352e; border-radius: 6mm; padding: 6mm; text-align: center; break-inside: avoid; }
    .name { font-weight: 800; font-size: 14pt; }
    img { width: 58mm; height: 58mm; margin: 4mm auto; display: block; }
    .table { font-weight: 800; font-size: 22pt; }
    .hint { font-size: 10pt; margin-top: 2mm; color: #5b6f69; }
  </style></head><body><div class="grid">${body}</div><script>window.onload = () => { window.print(); };</script></body></html>`);
  win.document.close();
}

export function OrderingSettings() {
  const { user } = useStaff();
  const settings = useRestaurantSettings();
  const query = useAccount();
  const queryClient = useQueryClient();
  const view = query.data;
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const [form, setForm] = useState<OrderingConfig>({});
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const canEdit = isAdmin(user);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    if (!view) return;
    setForm(view.outlet.ordering ?? {});
    setSlug(view.outlet.slug ?? "");
  }, [view]);
  const savedSlug = view?.outlet.slug ?? "";
  const onlineUrl = savedSlug ? orderPageUrl(origin, savedSlug) : "";
  useEffect(() => {
    if (!onlineUrl) { setQr(""); return; }
    QRCode.toDataURL(onlineUrl, { width: 280, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [onlineUrl]);

  if (!user?.restaurantId) return <p className="py-8 text-sm text-muted-foreground">Sign in and join a restaurant to take orders from tables and online.</p>;
  if (query.isLoading) return <p className="py-8 text-sm text-muted-foreground">Loading…</p>;
  if (!view) return <p className="py-8 text-sm text-muted-foreground">Guest ordering needs an internet connection to set up. Try again when you're online.</p>;

  const qrAllowed = hasFeature(view.account, view.plan, "qr_ordering");
  const onlineAllowed = hasFeature(view.account, view.plan, "online_ordering");
  const problem = slugError(slug);
  const set = (patch: Partial<OrderingConfig>) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(view.outlet.ordering ?? {}) || slug !== savedSlug;

  const save = async () => {
    if (problem) return;
    setBusy(true);
    const clean: OrderingConfig = {
      ...form,
      prepMinutes: Math.min(180, Math.max(5, Math.round(Number(form.prepMinutes ?? 20)))),
      minOrder: Math.max(0, Math.round(Number(form.minOrder ?? 0))),
      message: (form.message ?? "").trim().slice(0, 160),
    };
    const error = await saveOrderingConfig(view.outlet.id, { ordering: clean as Record<string, unknown>, ...(slug !== savedSlug ? { slug } : {}) });
    setBusy(false);
    if (error) { toast.error(error); return; }
    toast.success("Guest ordering saved");
    void queryClient.invalidateQueries({ queryKey: ["account"] });
  };
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.success("Link copied"); } catch { toast.error("Couldn't copy. Select the link and copy it."); }
  };

  return (
    <div className="space-y-8 py-2">

      <section className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div>
          <h2 className="text-base font-bold">Guest ordering</h2>
          <p className="mt-1 text-sm text-muted-foreground">Guests order from their phone. Accepting an order sends the KOT and opens the bill.</p>
        </div>
        <div className="space-y-3">
          <Row title="QR ordering at tables" hint="Each table's QR code opens its menu. Orders join the table's bill.">
            <Switch checked={!!form.table} disabled={!canEdit || !qrAllowed} onCheckedChange={(v) => set({ table: v })} className="mt-0.5" />
          </Row>
          <Row title="Online ordering for pickup" hint="Share the link on WhatsApp, Instagram and Google. Guests order ahead and collect.">
            <Switch checked={!!form.online} disabled={!canEdit || !onlineAllowed} onCheckedChange={(v) => set({ online: v })} className="mt-0.5" />
          </Row>
          <Row title="Pause guest orders" hint="For a rush or closing time. Guests still see the menu but can't order.">
            <Switch checked={!!form.paused} disabled={!canEdit} onCheckedChange={(v) => set({ paused: v })} className="mt-0.5" />
          </Row>
          <Row title="Let guests pay by UPI from their phone" hint={settings.upiVpa ? `Pays ${settings.upiVpa} directly. Staff check the payment before settling.` : "Add your UPI ID under Restaurant first."}>
            <Switch checked={!!form.upi && !!settings.upiVpa} disabled={!canEdit || !settings.upiVpa} onCheckedChange={(v) => set({ upi: v })} className="mt-0.5" />
          </Row>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Usual pickup time (minutes)
              <input type="number" min={5} max={180} disabled={!canEdit} value={form.prepMinutes ?? 20} onChange={(e) => set({ prepMinutes: Number(e.target.value) })} className={inputClass} />
            </label>
            <label className="block text-sm font-medium">Minimum pickup order (₹)
              <input type="number" min={0} disabled={!canEdit} value={form.minOrder ?? 0} onChange={(e) => set({ minOrder: Number(e.target.value) })} className={inputClass} />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">Message on the ordering page
              <input maxLength={160} disabled={!canEdit} value={form.message ?? ""} onChange={(e) => set({ message: e.target.value })} placeholder="Breakfast 8:45–10:45 · Free Wi-Fi: TAB-Guest" className={inputClass} />
            </label>
            <label className="block text-sm font-medium sm:col-span-2">Web address
              <span className="mt-1 flex items-center overflow-hidden rounded-lg border border-input bg-card text-sm">
                <span className="shrink-0 bg-secondary px-3 py-2.5 text-muted-foreground">{origin.replace(/^https?:\/\//, "")}/order/</span>
                <input value={slug} disabled={!canEdit} maxLength={40} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} className="min-w-0 flex-1 px-2 py-2.5 outline-none" />
              </span>
              {problem ? <span className="mt-1 block text-xs text-destructive">{problem}</span> : <span className="mt-1 block text-xs font-normal text-muted-foreground">Changing it stops old QR codes and links from working.</span>}
            </label>
          </div>
          {canEdit ? <Button disabled={!dirty || busy || !!problem} onClick={() => void save()}>{busy ? "Saving…" : "Save guest ordering"}</Button>
            : <p className="text-sm text-muted-foreground">Only the owner or a manager can change these.</p>}
        </div>
      </section>

      {savedSlug ? (
        <section className="grid gap-4 border-t border-border pt-8 lg:grid-cols-[16rem_1fr]">
          <div>
            <h2 className="text-base font-bold">Links and QR codes</h2>
            <p className="mt-1 text-sm text-muted-foreground">Print a card for each table, and share the pickup link anywhere.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            {qr ? <img src={qr} alt="QR code for online ordering" width={140} height={140} className="rounded-lg border border-border bg-white p-1" /> : <QrCode className="size-20 text-muted-foreground" />}
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-semibold">Online ordering link</p>
              <p className="break-all rounded-lg bg-secondary px-3 py-2 text-xs">{onlineUrl}</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void copy(onlineUrl)}><Copy />Copy link</Button>
                <Button size="sm" variant="outline" asChild><a href={onlineUrl} target="_blank" rel="noreferrer"><ExternalLink />Open</a></Button>
                {qr ? <Button size="sm" variant="outline" asChild><a href={qr} download={`${savedSlug}-order-qr.png`}><QrCode />Download QR</a></Button> : null}
              </div>
            </div>
            <div className="sm:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">Table QR codes ({tables.length})</p>
                <Button size="sm" disabled={!tables.length} onClick={() => void printTableCards(settings.name || view.outlet.name,
                  [...tables].sort((a, b) => a.section.localeCompare(b.section) || a.label.localeCompare(b.label, undefined, { numeric: true }))
                    .map((t) => ({ label: t.label, section: t.section, url: orderPageUrl(origin, savedSlug, t.id) })))}><Printer />Print table cards (A4)</Button>
              </div>
              {tables.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {tables.map((t) => <li key={t.id}><a href={orderPageUrl(origin, savedSlug, t.id)} target="_blank" rel="noreferrer" className="inline-block rounded-md border border-border px-2 py-1 text-xs font-semibold hover:border-primary">{t.label}</a></li>)}
                </ul>
              ) : <p className="mt-1 text-sm text-muted-foreground">Add tables in Tables first.</p>}
              <p className="mt-2 text-xs text-muted-foreground">Each card opens that table's menu. Tap a table above to try it as a guest.</p>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
