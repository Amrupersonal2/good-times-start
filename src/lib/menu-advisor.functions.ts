import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isAdvisorOwner, menuAdvisorInput } from "./menu-advisor";

export const analyzeSalesMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => menuAdvisorInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: membership, error } = await context.supabase.from("restaurant_members")
      .select("role").eq("restaurant_id", data.restaurantId).eq("user_id", context.userId).maybeSingle();
    if (error || !isAdvisorOwner(membership?.role)) return { ok: false as const, error: "Only the owner of this restaurant can request menu analysis." };
    const { runMenuAdvisor } = await import("./menu-advisor.server");
    return runMenuAdvisor(data);
  });