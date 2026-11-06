import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { sendTemplate, whatsappKeys } from "./whatsapp/cloud-api.server";

/* Automatic WhatsApp sending. Every call checks, on the server, that the
   signed-in person may do it; the browser never sees the WhatsApp keys. */

type Ctx = { supabase: { from: (table: string) => any }; userId: string }; // eslint-disable-line @typescript-eslint/no-explicit-any

async function roleIn(ctx: Ctx, restaurantId: string): Promise<string | null> {
  const { data } = await ctx.supabase.from("restaurant_members").select("role")
    .eq("restaurant_id", restaurantId).eq("user_id", ctx.userId).maybeSingle();
  return (data as { role?: string } | null)?.role ?? null;
}
const isAdminRole = (role: string | null) => role === "owner" || role === "manager";

/** Is automatic sending switched on for this deployment? */
export const whatsappStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ restaurantId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    if (!isAdminRole(await roleIn(context as unknown as Ctx, data.restaurantId))) throw new Error("Only the owner or a manager can do this.");
    return { configured: !!whatsappKeys() };
  });

const campaignInput = z.object({
  restaurantId: z.string().uuid(),
  campaignId: z.string().uuid(),
  template: z.string().trim().regex(/^[a-z0-9_]{1,512}$/, "Template names use lower-case letters, numbers and underscores"),
  language: z.string().trim().regex(/^[a-z]{2,3}(_[A-Z]{2})?$/).default("en"),
  /** Values for {{1}}, {{2}}… The text "{name}" is replaced with each guest's first name. */
  params: z.array(z.string().max(200)).max(5).default([]),
  recipients: z.array(z.object({ wa: z.string().regex(/^[0-9]{11,15}$/), name: z.string().max(80).default("") })).min(1).max(25),
});

/** Send one batch of a campaign (the screen sends 25 at a time and shows progress). */
export const sendWhatsappCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => campaignInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    if (!isAdminRole(await roleIn(ctx, data.restaurantId))) throw new Error("Only the owner or a manager can send campaigns.");
    const keys = whatsappKeys();
    if (!keys) throw new Error("Automatic WhatsApp isn't set up yet. Use one-tap sending, or add the WhatsApp keys first.");
    // The campaign must belong to this restaurant (row-level security also checks).
    const { data: campaign } = await ctx.supabase.from("marketing_campaigns").select("id").eq("id", data.campaignId).eq("restaurant_id", data.restaurantId).maybeSingle();
    if (!campaign) throw new Error("Campaign not found.");
    // Never message anyone twice in one campaign, even if the screen retries.
    const { data: already } = await ctx.supabase.from("marketing_sends").select("phone").eq("campaign_id", data.campaignId).eq("status", "sent");
    const done = new Set(((already ?? []) as { phone: string }[]).map((r) => r.phone));

    const results: { wa: string; ok: boolean; error?: string }[] = [];
    for (const r of data.recipients) {
      if (done.has(r.wa)) { results.push({ wa: r.wa, ok: true }); continue; }
      const first = r.name.trim().split(/\s+/)[0] || "there";
      const sent = await sendTemplate(keys, { to: r.wa, template: data.template, language: data.language, bodyParams: data.params.map((p) => p.replace(/\{name\}/g, first)) });
      results.push(sent.ok ? { wa: r.wa, ok: true } : { wa: r.wa, ok: false, error: sent.error });
      await ctx.supabase.from("marketing_sends").upsert({
        campaign_id: data.campaignId, restaurant_id: data.restaurantId, phone: r.wa, name: r.name,
        status: sent.ok ? "sent" : "failed", error: sent.ok ? "" : sent.error, at: new Date().toISOString(),
      }, { onConflict: "campaign_id,phone" });
    }
    return { results };
  });

/**
 * Tell a guest their order is ready, automatically. Any staff member may
 * trigger it, but only for a guest who said yes on that order, and only with
 * the template the owner chose.
 */
export const sendOrderReadyMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ guestOrderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { data: order } = await ctx.supabase.from("guest_orders")
      .select("restaurant_id, code, customer_name, customer_phone, whatsapp_opt_in").eq("id", data.guestOrderId).maybeSingle();
    const o = order as { restaurant_id: string; code: string; customer_name: string; customer_phone: string; whatsapp_opt_in: boolean } | null;
    if (!o || !(await roleIn(ctx, o.restaurant_id))) throw new Error("Order not found.");
    if (!o.whatsapp_opt_in) return { sent: false, reason: "The guest didn't ask for WhatsApp updates." };
    const digits = o.customer_phone.replace(/\D/g, "");
    const to = digits.length === 10 ? `91${digits}` : digits;
    if (!/^[0-9]{11,15}$/.test(to)) return { sent: false, reason: "No WhatsApp number on this order." };
    const { data: rest } = await ctx.supabase.from("restaurants").select("marketing").eq("id", o.restaurant_id).maybeSingle();
    const m = ((rest as { marketing?: Record<string, unknown> } | null)?.marketing ?? {}) as { auto?: boolean; readyTemplate?: string; language?: string };
    const keys = whatsappKeys();
    if (!keys || !m.auto || !m.readyTemplate) return { sent: false, reason: "Automatic order updates are off." };
    const sent = await sendTemplate(keys, { to, template: m.readyTemplate, language: m.language || "en", bodyParams: [o.customer_name.split(/\s+/)[0] || "there", o.code] });
    return sent.ok ? { sent: true, reason: "" } : { sent: false, reason: sent.error };
  });
