import { supabase } from "@/integrations/supabase/client";
import { getDb, markDirty } from "./db";
import { normalisePhone } from "./customer-logic";
import { sanitizeBranding, cleanSource, type Branding, type ScanRow } from "./marketing-logic";
import type { Customer } from "./types";
import { isTestBrowser } from "./test-browser";

/* Branding, consent, scans and campaigns. Branding and campaigns live in the
   cloud (the guest page and WhatsApp need the internet anyway); a guest's
   consent lives on their guest record, so it works offline and syncs. */

export interface MarketingSettings {
  /** Automatic sending through the WhatsApp Business Platform. */
  auto?: boolean;
  /** Approved marketing template used for automatic campaigns. */
  template?: string;
  language?: string;
  /** Approved utility template for "your order is ready": {{1}} name, {{2}} order code. */
  readyTemplate?: string;
  /** Days before the same guest can get another campaign. */
  cooldownDays?: number;
}

const db = () => supabase as unknown as { from: (t: string) => any; rpc: (f: string, a: Record<string, unknown>) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

export async function loadBrandingAndMarketing(restaurantId: string): Promise<{ branding: Branding; marketing: MarketingSettings }> {
  const { data, error } = await db().from("restaurants").select("branding, marketing").eq("id", restaurantId).maybeSingle();
  if (error) throw new Error("Couldn't load branding. Check the internet and try again.");
  const row = (data ?? {}) as { branding?: Branding; marketing?: MarketingSettings };
  return { branding: row.branding ?? {}, marketing: row.marketing ?? {} };
}

function friendly(error: { code?: string; message?: string }): string {
  if (error.code === "23514") return "The pictures are too large. Try smaller ones.";
  if (error.code === "42501" || /row-level security/i.test(error.message ?? "")) return "Only the owner or a manager can change this.";
  if (/column .* does not exist|schema cache/i.test(error.message ?? "")) return "The database needs updating first (migration 0009).";
  return error.message ?? "Couldn't save. Try again.";
}

export async function saveBranding(restaurantId: string, branding: Branding): Promise<string | null> {
  const { data, error } = await db().from("restaurants").update({ branding: sanitizeBranding(branding) }).eq("id", restaurantId).select("id");
  if (error) return friendly(error);
  return (data as unknown[] | null)?.length ? null : "Only the owner or a manager can change this.";
}

export async function saveMarketingSettings(restaurantId: string, settings: MarketingSettings): Promise<string | null> {
  const clean: MarketingSettings = {
    auto: !!settings.auto,
    template: (settings.template ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 120),
    language: /^[a-z]{2,3}(_[A-Z]{2})?$/.test(settings.language ?? "") ? settings.language! : "en",
    readyTemplate: (settings.readyTemplate ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 120),
    cooldownDays: Math.min(30, Math.max(0, Math.round(Number(settings.cooldownDays ?? 3)))),
  };
  const { data, error } = await db().from("restaurants").update({ marketing: clean }).eq("id", restaurantId).select("id");
  if (error) return friendly(error);
  return (data as unknown[] | null)?.length ? null : "Only the owner or a manager can change this.";
}

/**
 * Shrink a photo in the browser before saving it, so the guest page stays quick
 * on mobile data. Returns a WebP (or JPEG) data URL.
 */
export async function compressImage(file: File, maxWidth: number, maxHeight: number, quality = 0.78): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Choose a picture file.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't open that picture."));
      el.src = url;
    });
    const scale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't process that picture.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let out = canvas.toDataURL("image/webp", quality);
    if (!out.startsWith("data:image/webp")) out = canvas.toDataURL("image/jpeg", quality);
    // Step quality down until it fits comfortably.
    for (let q = quality - 0.12; out.length > 240_000 && q > 0.3; q -= 0.12) out = canvas.toDataURL(out.startsWith("data:image/webp") ? "image/webp" : "image/jpeg", q);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------- consent */

/** Record a guest's yes or no to WhatsApp offers on their guest record. */
export async function setWhatsappConsent(phone: string, optIn: boolean, source: string, name?: string): Promise<Customer | null> {
  const id = normalisePhone(phone);
  if (!id) return null;
  const d = getDb();
  const existing = await d.customers.get(id);
  if (existing?.whatsapp?.optIn === optIn && !(name && !existing.name)) return existing;
  const customer: Customer = {
    ...(existing ?? { id, phone: id, createdAt: Date.now() }),
    ...(name && !existing?.name ? { name } : {}),
    whatsapp: { ...(existing?.whatsapp ?? {}), optIn, at: Date.now(), source },
  };
  await d.customers.put(customer);
  await markDirty(["customer", id]);
  return customer;
}

/** Remember when guests were last messaged, so nobody gets campaigns too often. */
export async function markMessaged(customerIds: string[], at = Date.now()): Promise<void> {
  const d = getDb();
  const changed: string[] = [];
  await d.transaction("rw", d.customers, async () => {
    for (const id of customerIds) {
      const c = await d.customers.get(id);
      if (!c?.whatsapp) continue;
      await d.customers.put({ ...c, whatsapp: { ...c.whatsapp, lastMessagedAt: at } });
      changed.push(id);
    }
  });
  if (changed.length) await markDirty(...changed.map((id): ["customer", string] => ["customer", id]));
}

/* ---------------------------------------------------------- guest page */

/** Count a menu open, once per browser session per source. Never blocks the page. */
export async function logScan(slug: string, source: string): Promise<void> {
  if (isTestBrowser()) return;
  const clean = cleanSource(source) || "direct";
  const key = `xtsy-scan:${slug}:${clean}`;
  try { if (window.sessionStorage.getItem(key)) return; window.sessionStorage.setItem(key, "1"); } catch { /* private mode: count anyway */ }
  try { await db().rpc("log_qr_scan", { _slug: slug, _source: clean }); } catch { /* counting is best-effort */ }
}

export async function recordGuestChoice(id: string, token: string, optIn: boolean, source: string): Promise<void> {
  try { await db().rpc("guest_order_marketing", { _id: id, _token: token, _opt_in: optIn, _source: cleanSource(source) }); } catch { /* best-effort */ }
}

/* ------------------------------------------------------------- results */

export async function loadScans(restaurantId: string, days: number): Promise<{ scans: ScanRow[]; ordersBySource: Map<string, number>; optIns: number }> {
  const since = new Date(Date.now() - days * 86_400_000);
  const [scans, orders] = await Promise.all([
    db().from("qr_scans").select("day, source, scans").eq("restaurant_id", restaurantId).gte("day", since.toISOString().slice(0, 10)),
    db().from("guest_orders").select("source, table_id, whatsapp_opt_in, status").eq("restaurant_id", restaurantId).gte("created_at", since.toISOString()).limit(5000),
  ]);
  if (scans.error) throw new Error(friendly(scans.error));
  const ordersBySource = new Map<string, number>();
  let optIns = 0;
  for (const o of (orders.data ?? []) as { source: string | null; table_id: string | null; whatsapp_opt_in: boolean; status: string }[]) {
    if (o.status === "rejected" || o.status === "cancelled") continue;
    const source = o.source || (o.table_id ? cleanSource(o.table_id) : "direct");
    ordersBySource.set(source, (ordersBySource.get(source) ?? 0) + 1);
    if (o.whatsapp_opt_in) optIns += 1;
  }
  return { scans: (scans.data ?? []) as ScanRow[], ordersBySource, optIns };
}

/* ----------------------------------------------------------- campaigns */

export interface Campaign {
  id: string; name: string; message: string; audience: string; mode: "manual" | "auto"; template: string;
  recipients: number; sent: number; failed: number; created_at: string;
}

export async function loadCampaigns(restaurantId: string): Promise<Campaign[]> {
  const { data, error } = await db().from("marketing_campaigns").select("id, name, message, audience, mode, template, recipients, sent, failed, created_at")
    .eq("restaurant_id", restaurantId).order("created_at", { ascending: false }).limit(50);
  if (error) throw new Error(friendly(error));
  return (data ?? []) as Campaign[];
}

export async function createCampaign(restaurantId: string, c: { name: string; message: string; audience: string; mode: "manual" | "auto"; template?: string; recipients: number }): Promise<string> {
  const { data, error } = await db().from("marketing_campaigns").insert({
    restaurant_id: restaurantId, name: c.name.trim().slice(0, 80) || "Campaign", message: c.message.slice(0, 1000),
    audience: c.audience, mode: c.mode, template: c.template ?? "", recipients: c.recipients,
  }).select("id").single();
  if (error || !data) throw new Error(error ? friendly(error) : "Couldn't start the campaign.");
  return (data as { id: string }).id;
}

export async function recordSend(restaurantId: string, campaignId: string, wa: string, name: string, status: "sent" | "skipped"): Promise<void> {
  await db().from("marketing_sends").upsert({ campaign_id: campaignId, restaurant_id: restaurantId, phone: wa, name, status, at: new Date().toISOString() }, { onConflict: "campaign_id,phone" });
}

export async function loadSentPhones(campaignId: string): Promise<Set<string>> {
  const { data } = await db().from("marketing_sends").select("phone, status").eq("campaign_id", campaignId);
  return new Set(((data ?? []) as { phone: string; status: string }[]).filter((r) => r.status !== "failed").map((r) => r.phone));
}
