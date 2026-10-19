import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, RefreshCw, Send, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dropdown } from "@/components/Dropdown";
import { Segmented } from "@/components/Segmented";
import { ConfirmButton } from "@/components/ConfirmButton";
import { getDb } from "@/lib/db";
import { orderPageUrl } from "@/lib/guest-order-logic";
import {
  SEGMENTS, STARTER_MESSAGES, activeOffers, audienceCsv, audienceVcard, buildAudience, fillTemplate, pickRecipients, waLink, withOptOut,
  type Branding, type Recipient, type SegmentId,
} from "@/lib/marketing-logic";
import { createCampaign, loadCampaigns, loadSentPhones, markMessaged, recordSend, saveMarketingSettings, type MarketingSettings } from "@/lib/marketing-actions";
import { sendWhatsappCampaign, whatsappStatus } from "@/lib/whatsapp.functions";
import { cn } from "@/lib/utils";

const input = "mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm";

function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

interface Running { id: string; name: string; message: string; mode: "manual" | "auto"; recipients: Recipient[]; done: Set<string> }

export function WhatsAppCenter({ restaurantId, restaurantName, slug, brand, settings }: { restaurantId: string; restaurantName: string; slug: string | null; brand: Branding; settings: MarketingSettings }) {
  const queryClient = useQueryClient();
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const data = useLiveQuery(async () => {
    const d = getDb();
    const [customers, orders] = await Promise.all([d.customers.toArray(), d.orders.where("status").equals("settled").toArray()]);
    return buildAudience(customers, orders);
  }, [], null);
  const guests = data ?? [];
  const yes = guests.filter((g) => g.optIn).length;

  const offers = activeOffers(brand.offers, Date.now());
  const [segment, setSegment] = useState<SegmentId>("all");
  const [name, setName] = useState("");
  const [text, setText] = useState(STARTER_MESSAGES[0]?.text ?? "");
  const [offer, setOffer] = useState(offers[0]?.title ?? "");
  const [link, setLink] = useState("");
  useEffect(() => { if (slug && !link) setLink(orderPageUrl(origin, slug, undefined, "whatsapp")); }, [slug, origin, link]);
  const cooldown = settings.cooldownDays ?? 3;
  const picked = useMemo(() => pickRecipients(guests, segment, Date.now(), cooldown), [guests, segment, cooldown]);
  const counts = useMemo(() => Object.fromEntries(SEGMENTS.map((s) => [s.id, pickRecipients(guests, s.id, Date.now(), cooldown).ready.length])), [guests, cooldown]);
  const messageFor = (r: { name: string } | undefined) => withOptOut(fillTemplate(text, { name: r?.name ?? "Asha", restaurant: restaurantName, link, offer }));

  const status = useQuery({
    queryKey: ["wa-status", restaurantId],
    queryFn: () => whatsappStatus({ data: { restaurantId } }),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const autoReady = !!status.data?.configured && !!settings.auto && !!settings.template;
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [running, setRunning] = useState<Running | null>(null);

  const start = async () => {
    if (!picked.ready.length) return;
    try {
      const campaignName = name.trim() || `${SEGMENTS.find((s) => s.id === segment)?.label ?? "Campaign"} · ${new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
      const id = await createCampaign(restaurantId, { name: campaignName, message: text, audience: segment, mode, ...(mode === "auto" ? { template: settings.template ?? "" } : {}), recipients: picked.ready.length });
      setRunning({ id, name: campaignName, message: text, mode, recipients: picked.ready, done: new Set() });
      void queryClient.invalidateQueries({ queryKey: ["campaigns", restaurantId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the campaign");
    }
  };

  if (running) return <Sender running={running} restaurantId={restaurantId} settings={settings} messageFor={messageFor} onClose={() => { setRunning(null); void queryClient.invalidateQueries({ queryKey: ["campaigns", restaurantId] }); }} />;

  return (
    <div className="space-y-8">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Users} label="Guests on record" value={guests.length} />
        <Stat icon={Check} label="Said yes to WhatsApp offers" value={yes} />
        <Stat icon={Send} label="Ready for this campaign" value={picked.ready.length} />
      </div>

      <section className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          <h2 className="text-base font-bold">New campaign</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="text-sm font-medium">Who gets it
              <Dropdown ariaLabel="Audience" className="mt-1 h-11" value={segment} onChange={setSegment}
                options={SEGMENTS.map((s) => ({ value: s.id, label: s.label, hint: String(counts[s.id] ?? 0) }))} />
              <span className="mt-1 block text-xs font-normal text-muted-foreground">{SEGMENTS.find((s) => s.id === segment)?.hint}</span>
            </div>
            <label className="block text-sm font-medium">Campaign name (for you)
              <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Weekend momo offer" className={input} />
            </label>
          </div>
          <div>
            <p className="text-sm font-medium">Start from</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {STARTER_MESSAGES.map((m) => <button key={m.id} type="button" onClick={() => setText(m.text)} className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", text === m.text ? "bg-primary text-primary-foreground" : "bg-secondary")}>{m.label}</button>)}
            </div>
          </div>
          <label className="block text-sm font-medium">Message
            <textarea value={text} maxLength={900} rows={4} onChange={(e) => setText(e.target.value)} className={input} />
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{"{first}"} first name · {"{name}"} full name · {"{offer}"} · {"{link}"} · {"{restaurant}"}. "Reply STOP to stop offers." is added for you.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-medium">Offer text
              <input value={offer} maxLength={80} list="wa-offers" onChange={(e) => setOffer(e.target.value)} placeholder="Chai + bun combo ₹99" className={input} />
              <datalist id="wa-offers">{offers.map((o) => <option key={o.id} value={o.title} />)}</datalist>
            </label>
            <label className="block text-sm font-medium">Link
              <input value={link} maxLength={300} onChange={(e) => setLink(e.target.value)} className={input} />
            </label>
          </div>
          {picked.skipped.length ? (
            <p className="text-xs text-muted-foreground">
              Not included: {Object.entries(picked.skipped.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.reason]: (acc[s.reason] ?? 0) + 1 }), {})).map(([r, n]) => `${n} ${r}`).join(" · ")}.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Segmented ariaLabel="How to send" value={mode} onChange={(v) => setMode(v)} options={[{ value: "manual", label: "One-tap from this phone" }, { value: "auto", label: "Automatic" }]} />
            {mode === "auto" && !autoReady ? <span className="text-xs text-muted-foreground">Set up automatic sending below first.</span> : null}
          </div>
          <ConfirmButton id="wa-start" disabled={!picked.ready.length || !text.trim() || (mode === "auto" && !autoReady)} onConfirm={start}
            className={buttonVariants({ size: "lg" })} armedClassName="!bg-gold !text-gold-foreground" confirm={`Tap again to start: ${picked.ready.length} guest${picked.ready.length === 1 ? "" : "s"}`}>
            <Send />{picked.ready.length ? `Start campaign · ${picked.ready.length} guest${picked.ready.length === 1 ? "" : "s"}` : "No guests to message yet"}
          </ConfirmButton>
          {!yes ? <p className="text-sm text-muted-foreground">Nobody has said yes yet. Guests can say yes when they order by QR, or you can record it on the Guests screen when a guest agrees in person.</p> : null}
        </div>

        <div>
          <p className="text-sm font-medium">Preview</p>
          <div className="mt-2 rounded-2xl bg-secondary p-3">
            <div className="ml-auto max-w-[95%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-success/15 px-3 py-2 text-sm shadow-sm">{messageFor(picked.ready[0])}</div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Showing it as {picked.ready[0]?.name || "Asha"} would see it.</p>
        </div>
      </section>

      <AutoSetup restaurantId={restaurantId} settings={settings} configured={status.data?.configured ?? null} />
      <History restaurantId={restaurantId} />
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value.toLocaleString("en-IN")}</p>
    </div>
  );
}

/* ------------------------------------------------------------- sending */

function Sender({ running, restaurantId, settings, messageFor, onClose }: {
  running: Running; restaurantId: string; settings: MarketingSettings; messageFor: (r: { name: string }) => string; onClose: () => void;
}) {
  const [done, setDone] = useState<Set<string>>(running.done);
  const [failed, setFailed] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadSentPhones(running.id).then((s) => setDone((d) => new Set([...d, ...s]))); }, [running.id]);
  const remaining = running.recipients.filter((r) => !done.has(r.wa));
  const current = remaining[0];
  const progress = running.recipients.length ? (running.recipients.length - remaining.length) / running.recipients.length : 1;

  const mark = async (r: Recipient, status: "sent" | "skipped") => {
    setDone((d) => new Set(d).add(r.wa));
    await recordSend(restaurantId, running.id, r.wa, r.name, status);
    if (status === "sent") await markMessaged([r.id]);
  };

  const sendAuto = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < remaining.length; i += 25) {
        const batch = remaining.slice(i, i + 25);
        const { results } = await sendWhatsappCampaign({ data: {
          restaurantId, campaignId: running.id, template: settings.template ?? "", language: settings.language ?? "en",
          params: ["{name}"], recipients: batch.map((r) => ({ wa: r.wa, name: r.name })),
        } });
        const ok = results.filter((r) => r.ok).map((r) => r.wa);
        setDone((d) => new Set([...d, ...ok]));
        setFailed((f) => { const n = new Map(f); for (const r of results) if (!r.ok) n.set(r.wa, r.error ?? "Failed"); return n; });
        await markMessaged(batch.filter((r) => ok.includes(r.wa)).map((r) => r.id));
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sending stopped. Try again to continue where it left off.");
    } finally {
      setBusy(false);
    }
  };

  const copyMessage = async () => {
    try { await navigator.clipboard.writeText(messageFor({ name: "" })); toast.success("Message copied"); } catch { toast.error("Couldn't copy"); }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{running.mode === "auto" ? "Automatic campaign" : "One-tap campaign"}</p>
          <h2 className="text-xl font-bold">{running.name}</h2>
        </div>
        <Button variant="ghost" onClick={onClose}><X />Close</Button>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-success transition-all" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="mt-1 text-sm text-muted-foreground">{running.recipients.length - remaining.length} of {running.recipients.length} done{failed.size ? ` · ${failed.size} failed` : ""}</p>
      </div>

      {running.mode === "manual" ? (
        current ? (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Next guest</p>
            <p className="text-2xl font-bold">{current.name || `Guest ···${current.wa.slice(-4)}`}</p>
            <p className="text-sm text-muted-foreground">+{current.wa}</p>
            <div className="mt-3 whitespace-pre-wrap rounded-xl bg-secondary p-3 text-sm">{messageFor(current)}</div>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={waLink(current.wa, messageFor(current))} target="_blank" rel="noreferrer" onClick={() => void mark(current, "sent")}
                className={cn(buttonVariants({ size: "lg" }), "flex-1 bg-success text-white hover:bg-success/90")}><Send />Open WhatsApp & send</a>
              <Button size="lg" variant="outline" onClick={() => void mark(current, "skipped")}>Skip</Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">WhatsApp opens with the message ready. Tap send there, come back, and the next guest is waiting.</p>
          </div>
        ) : <Finished onClose={onClose} />
      ) : (
        remaining.length ? (
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm">Sends the approved template <strong>{settings.template}</strong> to {remaining.length} guest{remaining.length === 1 ? "" : "s"}, 25 at a time. Nobody gets it twice, even if you send again.</p>
            <ConfirmButton id="wa-auto-send" disabled={busy} onConfirm={sendAuto} className={cn(buttonVariants({ size: "lg" }), "mt-4 w-full")} armedClassName="!bg-gold !text-gold-foreground" confirm={`Tap again to send to ${remaining.length}`}>
              {busy ? <><RefreshCw className="animate-spin" />Sending…</> : <><Send />Send now</>}
            </ConfirmButton>
          </div>
        ) : <Finished onClose={onClose} />
      )}

      {failed.size ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="font-semibold">Couldn't send to {failed.size}</p>
          <ul className="mt-1 space-y-0.5 text-xs">{[...failed].slice(0, 8).map(([wa, err]) => <li key={wa}>+{wa}: {err}</li>)}</ul>
        </div>
      ) : null}

      <div className="rounded-2xl border border-border p-4">
        <p className="text-sm font-semibold">Or send as a WhatsApp Business broadcast</p>
        <p className="mt-1 text-xs text-muted-foreground">Save these contacts to your phone, add them to a broadcast list in WhatsApp Business, and paste the message. Broadcasts only reach people who have your number saved.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => saveFile(`${running.name}.vcf`, audienceVcard(running.recipients, running.name.slice(0, 20)), "text/vcard")}><Download />Contacts (.vcf)</Button>
          <Button size="sm" variant="outline" onClick={() => saveFile(`${running.name}.csv`, audienceCsv(running.recipients), "text/csv")}><Download />Spreadsheet (.csv)</Button>
          <Button size="sm" variant="outline" onClick={() => void copyMessage()}><Copy />Copy message</Button>
        </div>
      </div>
    </div>
  );
}

function Finished({ onClose }: { onClose: () => void }) {
  return (
    <div className="rounded-2xl border border-success/40 bg-success/5 p-6 text-center">
      <Check className="mx-auto size-8 text-success" />
      <p className="mt-2 text-lg font-bold">Campaign finished</p>
      <p className="text-sm text-muted-foreground">These guests won't get another campaign until the cool-down passes.</p>
      <Button className="mt-4" onClick={onClose}>Done</Button>
    </div>
  );
}

/* ------------------------------------------------------ automatic setup */

function AutoSetup({ restaurantId, settings, configured }: { restaurantId: string; settings: MarketingSettings; configured: boolean | null }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MarketingSettings>(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm(settings); }, [settings]);
  const dirty = JSON.stringify(form) !== JSON.stringify(settings);
  const save = async () => {
    setBusy(true);
    const error = await saveMarketingSettings(restaurantId, form);
    setBusy(false);
    if (error) { toast.error(error); return; }
    toast.success("WhatsApp settings saved");
    void queryClient.invalidateQueries({ queryKey: ["branding", restaurantId] });
  };
  return (
    <section className="grid gap-4 border-t border-border pt-8 lg:grid-cols-[15rem_1fr]">
      <div>
        <h2 className="flex items-center gap-2 text-base font-bold"><Sparkles className="size-4 text-primary" />Automatic sending</h2>
        <p className="mt-1 text-sm text-muted-foreground">Optional. Sends campaigns and "your order is ready" messages by themselves through the WhatsApp Business Platform. Meta charges per message.</p>
      </div>
      <div className="space-y-3">
        <p className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium", configured ? "bg-success/10 text-success" : "bg-secondary")}>
          <ShieldCheck className="size-4" />{configured === null ? "Checking…" : configured ? "WhatsApp keys are connected." : "Not connected yet. One-tap sending works without this."}
        </p>
        {!configured ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>In Meta Business Suite, verify the business and add a WhatsApp number (not one used in the WhatsApp app).</li>
            <li>In WhatsApp Manager, create a <strong>Marketing</strong> template whose text uses {"{{1}}"} for the guest's first name, and a <strong>Utility</strong> template "order ready" with {"{{1}}"} name and {"{{2}}"} order code. Wait for approval.</li>
            <li>Ask Lovable to add two secrets: <code>WHATSAPP_ACCESS_TOKEN</code> and <code>WHATSAPP_PHONE_NUMBER_ID</code>.</li>
            <li>Come back here, switch it on and enter the template names.</li>
          </ol>
        ) : null}
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Switch checked={!!form.auto} onCheckedChange={(v) => setForm((f) => ({ ...f, auto: v }))} className="mt-0.5" />
          <span><span className="font-medium">Use automatic sending</span><span className="mt-0.5 block text-xs text-muted-foreground">Only for guests who said yes, and only with approved templates.</span></span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">Marketing template name
            <input value={form.template ?? ""} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, template: e.target.value }))} placeholder="weekly_offer" className={input} />
          </label>
          <label className="block text-sm font-medium">"Order ready" template name
            <input value={form.readyTemplate ?? ""} maxLength={120} onChange={(e) => setForm((f) => ({ ...f, readyTemplate: e.target.value }))} placeholder="order_ready" className={input} />
          </label>
          <label className="block text-sm font-medium">Template language code
            <input value={form.language ?? "en"} maxLength={6} onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} placeholder="en" className={input} />
          </label>
          <label className="block text-sm font-medium">Days between campaigns to the same guest
            <input type="number" min={0} max={30} value={form.cooldownDays ?? 3} onChange={(e) => setForm((f) => ({ ...f, cooldownDays: Number(e.target.value) }))} className={input} />
          </label>
        </div>
        <Button disabled={!dirty || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save WhatsApp settings"}</Button>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- history */

function History({ restaurantId }: { restaurantId: string }) {
  const campaigns = useQuery({ queryKey: ["campaigns", restaurantId], queryFn: () => loadCampaigns(restaurantId), staleTime: 30_000 });
  return (
    <section className="border-t border-border pt-8">
      <h2 className="text-base font-bold">Past campaigns</h2>
      {campaigns.isError ? <p className="mt-2 text-sm text-muted-foreground">{campaigns.error instanceof Error ? campaigns.error.message : "Couldn't load campaigns."}</p>
        : !campaigns.data?.length ? <p className="mt-2 text-sm text-muted-foreground">{campaigns.isLoading ? "Loading…" : "None yet."}</p> : (
          <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {campaigns.data.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 p-3.5">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {c.mode === "auto" ? "Automatic" : "One-tap"} · {SEGMENTS.find((s) => s.id === c.audience)?.label ?? c.audience}</p>
                </div>
                <p className="text-sm tabular-nums"><strong>{c.sent}</strong> of {c.recipients} sent{c.failed ? <span className="text-destructive"> · {c.failed} failed</span> : null}</p>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
