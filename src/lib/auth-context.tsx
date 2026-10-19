import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { loginForEmail, type LoginId, type LoginRow } from "./staff-login-logic";

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
  /** admin, billdesk or waiter; null for any other account (such as the owner's own). */
  login: LoginId | null;
  /** That login's switch, devices and WhatsApp number, as the admin set them. */
  loginRow: LoginRow | null;
}

interface AuthState {
  user: SignedInStaff | null;
  /** True until the first session check finishes. */
  loading: boolean;
  refresh: () => Promise<void>;
}

/*
 * The signed-in person and their role are remembered on this device, so the
 * app opens instantly and keeps enforcing roles when the internet is down.
 * The cloud copy refreshes it whenever there's a connection.
 */
const STAFF_CACHE = "xtsy-pos-staff";
function readCachedStaff(id: string): SignedInStaff | null {
  try {
    const raw = window.localStorage.getItem(STAFF_CACHE);
    const parsed = raw ? (JSON.parse(raw) as SignedInStaff) : null;
    return parsed && parsed.id === id ? parsed : null;
  } catch { return null; }
}
function writeCachedStaff(staff: SignedInStaff | null) {
  try {
    if (staff) window.localStorage.setItem(STAFF_CACHE, JSON.stringify(staff));
    else window.localStorage.removeItem(STAFF_CACHE);
  } catch { /* storage unavailable */ }
}
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

async function resolveStaff(id: string, email: string): Promise<SignedInStaff> {
  const [profile, members, loginQuery] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", id).maybeSingle(),
    supabase.from("restaurant_members").select("restaurant_id, role, restaurants(name)").eq("user_id", id),
    (supabase as unknown as { from: (t: string) => any }).from("staff_logins").select("login, active, devices, whatsapp, display_name").eq("user_id", id).maybeSingle(), // eslint-disable-line @typescript-eslint/no-explicit-any
  ]);
  // Never mistake "couldn't reach the cloud" for "belongs to no restaurant".
  if (members.error) throw members.error;
  const memberships: Membership[] = (members.data ?? []).map((row) => ({
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurants?.name ?? "Restaurant",
    role: row.role,
  }));
  // One outlet: the restaurant this person belongs to.
  const active = memberships[0];
  const loginRow = ((loginQuery as { data: LoginRow | null }).data ?? null);
  return {
    id,
    email,
    login: loginRow?.login ?? loginForEmail(email),
    loginRow,
    displayName: loginRow?.display_name || profile.data?.display_name || email.split("@")[0] || "Staff",
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
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SignedInStaff | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    // The session is stored on the device: no network needed to know who's signed in.
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session) { setUser(null); setLoading(false); return; }
    const cached = readCachedStaff(session.user.id);
    if (cached) { setUser(cached); setLoading(false); }
    try {
      const fresh = await withTimeout(resolveStaff(session.user.id, session.user.email ?? ""), 8000);
      writeCachedStaff(fresh);
      setUser(fresh);
    } catch {
      // Offline or slow: keep the remembered role. A first sign-in on a new device needs the internet once.
      if (!cached) setUser({ id: session.user.id, email: session.user.email ?? "", displayName: session.user.email?.split("@")[0] ?? "Staff", role: "unknown", restaurantId: null, restaurantName: "", memberships: [], login: loginForEmail(session.user.email), loginRow: null });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!(["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"] as string[]).includes(event)) return;
      if (!session?.user) {
        writeCachedStaff(null);
        if (active) setUser(null);
        return;
      }
      void resolveStaff(session.user.id, session.user.email ?? "").then((resolved) => {
        writeCachedStaff(resolved);
        if (active) setUser(resolved);
      }).catch(() => { /* offline: keep what we have */ });
    });
    void load().catch(() => { if (active) setLoading(false); });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [load]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh: load }}>
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
