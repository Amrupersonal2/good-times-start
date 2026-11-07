import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/*
 * Records the public IP and approximate (IP-based) location a terminal checks in from.
 * Read from the request on the server so a device can't report a fake address.
 */
const schema = z.object({ restaurantId: z.string().uuid(), deviceId: z.string().regex(/^[a-z0-9-]{8,64}$/) });

export const recordTerminalNetwork = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: member } = await context.supabase.from("restaurant_members").select("role")
      .eq("user_id", context.userId).eq("restaurant_id", data.restaurantId).limit(1).maybeSingle();
    if (!member) return { ok: false };

    const req = getRequest();
    const h = req.headers;
    const ip = (h.get("cf-connecting-ip") || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "").trim().slice(0, 64);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cf = (req as any).cf as { city?: string; region?: string; country?: string } | undefined;
    const parts = [cf?.city || h.get("cf-ipcity"), cf?.region || h.get("cf-region"), cf?.country || h.get("cf-ipcountry")]
      .filter((p): p is string => !!p && p !== "XX");
    const location = parts.join(", ").slice(0, 160);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabaseAdmin as any).from("terminals")
      .update({ last_ip: ip || null, last_location: location || null, network_seen_at: new Date().toISOString() })
      .eq("restaurant_id", data.restaurantId).eq("device_id", data.deviceId);
    return { ok: true };
  });
