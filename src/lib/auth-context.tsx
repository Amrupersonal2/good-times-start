import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface SignedInStaff {
  id: string;
  email: string;
  displayName: string;
  role: "owner" | "staff" | "unknown";
}

const AuthContext = createContext<{ user: SignedInStaff | null }>({ user: null });

async function resolveStaff(id: string, email: string): Promise<SignedInStaff> {
  const [profile, role] = await Promise.all([
    supabase.from("profiles").select("display_name").eq("id", id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", id).limit(1).maybeSingle(),
  ]);
  return {
    id,
    email,
    displayName: profile.data?.display_name || email.split("@")[0] || "Staff",
    role: role.data?.role ?? "unknown",
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SignedInStaff | null>(null);

  useEffect(() => {
    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!(["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"] as string[]).includes(event)) return;
      if (!session?.user) {
        setUser(null);
        return;
      }
      void resolveStaff(session.user.id, session.user.email ?? "").then((resolved) => {
        if (active) setUser(resolved);
      });
    });

    void supabase.auth.getUser().then(({ data }) => {
      if (!active || !data.user) return;
      void resolveStaff(data.user.id, data.user.email ?? "").then((resolved) => {
        if (active) setUser(resolved);
      });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return <AuthContext.Provider value={{ user }}>{children}</AuthContext.Provider>;
}

export function useStaff() {
  return useContext(AuthContext);
}