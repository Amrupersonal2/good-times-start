import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type StaffRole = Database["public"]["Enums"]["restaurant_role"];

export const ROLE_LABELS: Record<StaffRole, string> = {
  owner: "Owner",
  manager: "Manager",
  cashier: "Cashier",
  captain: "Captain (waiter)",
  kitchen: "Kitchen",
};

export interface Membership {
  restaurantId: string;
  restaurantName: string;
  role: StaffRole;
}

export interface SignedInStaff {
  id: string;
  email: string;
  displayName: string;
  /** Role in the active restaurant; "unknown" until the user belongs to one. */
  role: StaffRole | "unknown";
  restaurantId: string | null;
  restaurantName: string;
  memberships: Membership[];
}

interface AuthState {
  user: SignedInStaff | null;
  /** True until the first session check finishes. */
  loading: boolean;
  refresh: () => Promise<void>;
  createRestaurant: (name: string) => Promise<void>;
  switchRestaurant: (restaurantId: string) => void;
}

const ACTIVE_KEY = "xtsy-pos-active-restaurant";

function readActive(): string | null {
  try { return window.localStorage.getItem(ACTIVE_KEY); } catch { return null; }
}
function writeActive(id: string) {
  try { window.localStorage.setItem(ACTIVE_KEY, id); } catch { /* storage unavailable */ }
}

async function resolveStaff(id: string, email: string): Promise<SignedInStaff> {
  // Joining is automatic: any invite sent to this email becomes a membership.
  await supabase.rpc("accept_restaurant_invites");
  const [profile, members] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", id).maybeSingle(),
    supabase.from("restaurant_members").select("restaurant_id, role, restaurants(name)").eq("user_id", id),
  ]);
  const memberships: Membership[] = (members.data ?? []).map((row) => ({
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurants?.name ?? "Restaurant",
    role: row.role,
  }));
  const preferred = readActive();
  const active = memberships.find((m) => m.restaurantId === preferred) ?? memberships[0];
  return {
    id,
    email,
    displayName: profile.data?.display_name || email.split("@")[0] || "Staff",
    role: active?.role ?? "unknown",
    restaurantId: active?.restaurantId ?? null,
    restaurantName: active?.restaurantName ?? "",
    memberships,
  };
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refresh: async () => {},
  createRestaurant: async () => {},
  switchRestaurant: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SignedInStaff | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    setUser(data.user ? await resolveStaff(data.user.id, data.user.email ?? "") : null);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!(["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"] as string[]).includes(event)) return;
      if (!session?.user) {
        if (active) setUser(null);
        return;
      }
      void resolveStaff(session.user.id, session.user.email ?? "").then((resolved) => {
        if (active) setUser(resolved);
      });
    });
    void load().catch(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [load]);

  const createRestaurant = useCallback(async (name: string) => {
    const { data, error } = await supabase.rpc("create_restaurant", { _name: name });
    if (error) throw error;
    if (typeof data === "string") writeActive(data);
    await load();
  }, [load]);

  const switchRestaurant = useCallback((restaurantId: string) => {
    writeActive(restaurantId);
    void load();
  }, [load]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh: load, createRestaurant, switchRestaurant }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useStaff() {
  return useContext(AuthContext);
}

/** Owners and managers can change restaurant details, menu prices and staff. */
export function isAdmin(user: SignedInStaff | null): boolean {
  return user?.role === "owner" || user?.role === "manager";
}
