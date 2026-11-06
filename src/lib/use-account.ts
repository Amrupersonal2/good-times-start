import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useStaff } from "./auth-context";
import type { Account, OrderingConfig, Plan } from "./saas-logic";

export interface Outlet {
  id: string;
  name: string;
  slug: string | null;
  city: string;
  ordering: OrderingConfig;
  account_id: string | null;
}

export interface AccountView {
  outlet: Outlet;
  account: Account | null;
  plan: Plan | null;
  plans: Plan[];
  /** Outlets of this account that the signed-in person belongs to. */
  outlets: Outlet[];
}

/** The active outlet, its account and plan. Cloud only: null when signed out or offline. */
export function useAccount() {
  const { user } = useStaff();
  const restaurantId = user?.restaurantId ?? null;
  return useQuery({
    queryKey: ["account", restaurantId],
    enabled: !!restaurantId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AccountView | null> => {
      if (!restaurantId) return null;
      const { data: outlet, error } = await supabase.from("restaurants").select("id, name, slug, city, ordering, account_id").eq("id", restaurantId).maybeSingle();
      if (error || !outlet) return null;
      const [account, plans, outlets] = await Promise.all([
        outlet.account_id ? supabase.from("accounts").select("*").eq("id", outlet.account_id).maybeSingle() : Promise.resolve({ data: null }),
        supabase.from("plans").select("*").order("sort"),
        outlet.account_id ? supabase.from("restaurants").select("id, name, slug, city, ordering, account_id").eq("account_id", outlet.account_id).order("created_at") : Promise.resolve({ data: [outlet] }),
      ]);
      const planList = (plans.data ?? []) as unknown as Plan[];
      const acc = (account.data ?? null) as unknown as Account | null;
      return {
        outlet: outlet as unknown as Outlet,
        account: acc,
        plan: planList.find((p) => p.id === acc?.plan_id) ?? null,
        plans: planList,
        outlets: (outlets.data ?? []) as unknown as Outlet[],
      };
    },
  });
}

/** Whether this person runs the XTSY POS platform (sees the admin console). */
export function usePlatformAdmin() {
  const { user } = useStaff();
  return useQuery({
    queryKey: ["platform-admin", user?.id ?? null],
    enabled: !!user,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      return !!data;
    },
  });
}
