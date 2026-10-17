import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardList, LayoutGrid, ChefHat, BarChart3, UtensilsCrossed, Settings, Package, Users, LineChart, Tablet, Wifi, WifiOff, RefreshCw, AlertTriangle, X, Sparkles, LogIn, LogOut, Store, Building2, ShieldCheck } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ROLE_LABELS, isAdmin, useStaff } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { getSyncSnapshot, saveSyncError, syncCloudData } from "@/lib/cloud-sync";
import { diagnoseCloudSync } from "@/lib/sync-diagnosis.functions";
import logo from "@/assets/logo.png";
import { getDb, getMaterialLevels } from "@/lib/db";
import { useRestaurantSettings } from "@/lib/use-settings";
import { InstallButton } from "@/components/AppInstall";
import { isLow } from "@/lib/stock-logic";
import { GuestOrdersButton } from "@/components/GuestOrders";
import { useAccount, usePlatformAdmin } from "@/lib/use-account";
import { accountState } from "@/lib/saas-logic";

const NAV = [
  { to: "/", label: "Billing", icon: ClipboardList },
  { to: "/tables", label: "Tables", icon: LayoutGrid },
  { to: "/kitchen", label: "Kitchen", icon: ChefHat },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/customers", label: "Guests", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/waiter", label: "Waiter", icon: Tablet },
  { to: "/account", label: "Business", icon: Building2 },
  { to: "/settings", label: "Settings", icon: Settings },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
] as const;

type NavPath = (typeof NAV)[number]["to"];

/** Screens each role works with. Signed-out devices (single-user mode) see everything. */
const ROLE_SCREENS: Record<string, NavPath[]> = {
  kitchen: ["/kitchen", "/stock", "/settings"],
  captain: ["/waiter", "/", "/tables", "/kitchen", "/menu", "/settings"],
  cashier: ["/", "/tables", "/kitchen", "/menu", "/stock", "/customers", "/reports", "/waiter", "/settings"],
};

export function screensFor(role: string | undefined): readonly NavPath[] {
  // Business (plan, outlets) is for owners and managers; Admin only shows for XTSY POS administrators.
  return (role && ROLE_SCREENS[role]) || NAV.map((n) => n.to).filter((to) => to !== "/admin" && (to !== "/account" || role === "owner" || role === "manager"));
}

export { useRestaurantSettings } from "@/lib/use-settings";

function SyncChip() {
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const staff = useStaff().user;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshot = useLiveQuery(async () => {
    await getDb().outbox.count();
    await getDb().meta.toArray();
    return getSyncSnapshot();
  }, [], { pendingOrders: 0, lastSyncAt: null, error: "", pendingStock: 0 });
  const pending = snapshot.pendingOrders + snapshot.pendingStock;

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const restaurantId = staff?.restaurantId ?? null;

  const retry = async () => {
    if (!staff) { await navigate({ to: "/auth" }); return; }
    if (!restaurantId) return;
    if (!online) { await saveSyncError(new Error("No internet connection. Orders remain safely stored on this device.")); return; }
    setBusy(true);
    try {
      await syncCloudData(restaurantId);
    } catch (error) {
      await saveSyncError(error);
    } finally {
      setBusy(false);
    }
  };
  const runDiagnosis = async () => {
    if (!description.trim() || !isAdmin(staff)) return;
    setDiagnosing(true);
    setDiagnosis("");
    try {
      const result = await diagnoseCloudSync({ data: { description: description.trim(), errorDetails: snapshot.error.slice(0, 350) } });
      setDiagnosis(result.diagnosis);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Diagnosis is unavailable right now.";
      setDiagnosis(text.slice(0, 350));
    } finally {
      setDiagnosing(false);
    }
  };
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };

  const tone = !online || snapshot.error ? "border-gold/60 bg-gold/15 text-gold-foreground" : "border-border bg-card text-foreground";
  const label = !online ? "Offline" : snapshot.error ? "Sync needs attention" : pending ? `${pending} to sync` : staff ? "Synced" : "This device only";

  return <>
    <div className="flex items-center gap-2">
      {staff ? <span className="hidden text-right text-xs leading-tight sm:block">
        <span className="block font-semibold">{staff.displayName}</span>
        <span className="text-muted-foreground">{staff.role === "unknown" ? "No restaurant yet" : ROLE_LABELS[staff.role]}</span>
      </span> : null}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className={`gap-1.5 ${tone}`} aria-label={`Sync status: ${label}`}>
        {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        <span className="hidden sm:inline">{label}</span>
        {busy ? <RefreshCw className="size-3 animate-spin" /> : null}
        {snapshot.error ? <AlertTriangle className="size-3.5" /> : null}
      </Button>
      {staff
        ? <Button size="icon" variant="ghost" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut /></Button>
        : <Button size="sm" variant="ghost" onClick={() => void navigate({ to: "/auth" })}><LogIn />Sign in</Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <DialogTitle>Sync</DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">Bills are saved on this device first, so billing never stops when the internet does.</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><X /></Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Bills waiting to upload</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingOrders}</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Other changes waiting</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingStock}</div></div>
        </div>
        <p className="text-sm text-muted-foreground">Last synced: {snapshot.lastSyncAt ? format(new Date(snapshot.lastSyncAt), "dd MMM yyyy, h:mm a") : "not yet"}</p>
        {snapshot.error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><strong className="flex items-center gap-2"><AlertTriangle className="size-4" />Sync needs attention</strong><p className="mt-1 break-words">{snapshot.error}</p></div> : null}
        {!staff ? <p className="text-sm text-muted-foreground">Sign in to share bills, tables and kitchen tickets with your other devices.</p> : null}
        <Button onClick={() => void retry()} disabled={busy || !online || (!!staff && !restaurantId)} className="w-full"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Syncing…" : staff ? "Sync now" : "Sign in to sync"}</Button>
        {isAdmin(staff) ? <section className="border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Ask AI about a sync problem</h3>
          <label className="mt-3 block text-sm">What happened?
            <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 1200))} maxLength={1200} rows={3} placeholder="For example: bills have stayed waiting since the Wi-Fi came back." className="mt-1 w-full resize-y rounded-lg border border-input bg-card p-3" />
          </label>
          <Button variant="secondary" className="mt-2 w-full" disabled={diagnosing || description.trim().length < 5} onClick={() => void runDiagnosis()}>{diagnosing ? "Checking…" : "Suggest a fix"}</Button>
          {diagnosis ? <div role="status" className="mt-3 whitespace-pre-wrap rounded-lg bg-secondary p-3 text-sm">{diagnosis}</div> : null}
        </section> : null}
      </DialogContent>
    </Dialog>
  </>;
}

/** Shown to a signed-in account that doesn't belong to a restaurant yet. */
function RestaurantSetup() {
  const { user, createRestaurant, refresh } = useStaff();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await createRestaurant(name.trim());
      await navigate({ to: "/setup" });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn't create the restaurant. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid max-w-3xl gap-6 p-4 py-10 lg:grid-cols-2 lg:p-8">
      <section className="rounded-xl border border-border bg-card p-6">
        <Store className="size-6 text-primary" />
        <h1 className="mt-3 text-xl font-bold">Set up your restaurant</h1>
        <p className="mt-1 text-sm text-muted-foreground">You'll be the owner, with a 14-day free trial. A short setup then walks you through GST, menu, tables, printing and staff.</p>
        <form className="mt-5 space-y-3" onSubmit={(event) => void submit(event)}>
          <label className="block text-sm font-medium">Restaurant name
            <input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="TAB Bistro" className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2.5" />
          </label>
          {message ? <p role="alert" className="text-sm text-destructive">{message}</p> : null}
          <Button type="submit" disabled={busy || !name.trim()} className="w-full">{busy ? "Creating…" : "Create restaurant"}</Button>
        </form>
      </section>
      <section className="rounded-xl border border-dashed border-border p-6">
        <h2 className="text-base font-semibold">Joining your team's restaurant?</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ask the owner to invite <strong className="text-foreground">{user?.email}</strong> from Settings, then check again.</p>
        <Button variant="outline" className="mt-4" onClick={() => void refresh()}><RefreshCw />Check for my invite</Button>
      </section>
    </div>
  );
}

export function AppShell({ children, tone = "light" }: { children: ReactNode; tone?: "light" | "dark" }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user } = useStaff();
  const settings = useRestaurantSettings();
  const restaurantName = settings.name || user?.restaurantName || "";
  const needsRestaurant = !!user && !user.restaurantId && pathname !== "/settings";
  const lowStock = useLiveQuery(async () => {
    const [materials, levels] = await Promise.all([getDb().materials.toArray(), getMaterialLevels()]);
    return materials.filter((m) => !m.archived && isLow(m, levels.get(m.id) ?? 0)).length;
  }, [], 0);
  const platformAdmin = usePlatformAdmin().data === true;
  const allowed = [...screensFor(user?.role), ...(platformAdmin ? ["/admin" as const] : [])];
  const nav = NAV.filter((n) => allowed.includes(n.to));
  const account = useAccount().data;
  const plan = accountState(account?.account);
  const current = NAV.find((n) => (n.to === "/" ? pathname === "/" : pathname.startsWith(n.to)));
  const blocked = !!current && !allowed.includes(current.to);
  const home = nav[0]?.to ?? "/";
  const needsDetails = isAdmin(user) && !settings.updatedAt && pathname !== "/settings" && pathname !== "/setup";
  const planWarning = isAdmin(user) && plan.warn && pathname !== "/account";

  return (
    <div className={`flex min-h-screen bg-background text-foreground ${tone === "dark" ? "dark" : ""}`}>
      <aside className="sticky top-0 hidden h-screen w-24 shrink-0 flex-col items-center bg-sidebar py-4 text-sidebar-foreground lg:flex">
        <img src={logo} alt="XTSY POS" width={40} height={40} className="rounded-lg" />
        <nav className="mt-6 flex w-full flex-col gap-1 px-2" aria-label="Main">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link key={to} to={to} aria-current={active ? "page" : undefined}
                className={`relative flex flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] font-semibold transition-colors ${active ? "bg-sidebar-accent text-white" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-white"}`}>
                {active ? <span className="absolute inset-y-2 left-0 w-1 rounded-r bg-gold" aria-hidden="true" /> : null}
                <Icon className="size-5" />
                {label}
                {to === "/stock" && lowStock > 0 ? <span className="absolute right-2 top-1.5 min-w-5 rounded-full bg-gold px-1 text-[10px] font-bold text-gold-foreground" aria-label={`${lowStock} running low`}>{lowStock}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-2 text-center text-[10px] leading-tight text-sidebar-foreground/50">XTSY POS</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={logo} alt="" width={28} height={28} className="rounded-md lg:hidden" />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{restaurantName || "XTSY POS"}</div>
              {restaurantName ? <div className="text-[11px] text-muted-foreground">XTSY POS</div> : null}
            </div>
          </div>
          <div className="flex items-center gap-2"><GuestOrdersButton /><InstallButton /><SyncChip /></div>
        </header>
        {needsDetails && !needsRestaurant ? (
          <Link to="/setup" className="flex items-center gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-foreground lg:px-6">
            <AlertTriangle className="size-4 shrink-0" />Finish setting up: add your GSTIN, menu, tables and staff so bills carry your details.
          </Link>
        ) : null}
        {planWarning && !needsDetails ? (
          <Link to="/account" className="flex items-center gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-foreground lg:px-6">
            <AlertTriangle className="size-4 shrink-0" />{plan.label}.{plan.live ? " See your plan." : " Billing keeps working; guest ordering and new outlets are paused. Renew in Business."}
          </Link>
        ) : null}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          {needsRestaurant ? <RestaurantSetup /> : blocked ? (
            <div className="mx-auto max-w-md p-8 text-center">
              <p className="font-semibold">This screen isn't part of your role</p>
              <p className="mt-1 text-sm text-muted-foreground">Ask the owner if you need access.</p>
              <Link to={home} className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to {NAV.find((n) => n.to === home)?.label}</Link>
            </div>
          ) : children}
        </main>
      </div>

      <nav className="no-scrollbar fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-sidebar-border bg-sidebar pb-[env(safe-area-inset-bottom)] text-sidebar-foreground lg:hidden" aria-label="Main">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link key={to} to={to} aria-current={active ? "page" : undefined}
              className={`flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${active ? "text-gold" : "text-sidebar-foreground/70"}`}>
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
