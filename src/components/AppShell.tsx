import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { createContext, useContext, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardList, LayoutGrid, BarChart3, UtensilsCrossed, Settings, Package, Users, LineChart, Tablet, Wifi, WifiOff, RefreshCw, AlertTriangle, Sparkles, LogIn, LogOut, Store, ShieldCheck, LayoutDashboard, PanelLeftClose, PanelLeftOpen, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ROLE_LABELS, isAdmin, useStaff } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { clearSyncNotice, getLiveStatus, getSyncSnapshot, onLiveStatus, saveSyncError, syncCloudData } from "@/lib/cloud-sync";
import { diagnoseCloudSync } from "@/lib/sync-diagnosis.functions";
import logo from "@/assets/logo.png";
import { getDb, getMaterialLevels } from "@/lib/db";
import { useRestaurantSettings } from "@/lib/use-settings";
import { InstallButton } from "@/components/AppInstall";
import { PinGate, PolicySync, usePolicy } from "@/components/PinGate";
import { can, screenPermitted } from "@/lib/permissions";
import { isLow } from "@/lib/stock-logic";
import { GuestOrdersButton } from "@/components/GuestOrders";
import { currentDevice, setAppMode, syncAppModeFromUrl, useAppMode } from "@/lib/app-mode";
import { touchTerminal, useTerminalStatus } from "@/lib/terminal-actions";
import { APPS, APP_LINKS, accessProblem, appsFor, type AppKind } from "@/lib/staff-login-logic";
import { isTestBrowser } from "@/lib/test-browser";

const NAV = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/", label: "Bill", icon: ClipboardList },
  { to: "/tables", label: "Tables", icon: LayoutGrid },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/stock", label: "Stock", icon: Package },
  { to: "/customers", label: "Guests", icon: Users },
  { to: "/reports", label: "Reports", icon: BarChart3 },
  { to: "/insights", label: "Insights", icon: LineChart },
  { to: "/marketing", label: "Marketing", icon: Sparkles },
  { to: "/waiter", label: "Waiter", icon: Tablet },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

type NavPath = (typeof NAV)[number]["to"];

/** Screens each role may open. */
const ROLE_SCREENS: Record<string, NavPath[]> = {
  owner: NAV.map((n) => n.to),
  manager: NAV.map((n) => n.to),
  kitchen: ["/stock", "/settings"],
  captain: ["/waiter", "/", "/tables", "/menu", "/settings"],
  cashier: ["/", "/dashboard", "/tables", "/menu", "/stock", "/customers", "/reports", "/settings"],
};

/** Reception's screens also follow Settings → Roles. */
function policyAllows(role: string, to: NavPath): boolean {
  if (role !== "cashier") return true;
  if (to === "/dashboard") return can({ role }, "dashboard.view");
  if (to === "/settings") return can({ role }, "settings.open");
  if (to === "/tables" || to === "/") return true; // bills open from Tables, so Reception always has it
  if (to === "/menu" || to === "/stock" || to === "/customers" || to === "/reports") return screenPermitted(role, to);
  return true;
}

/** Screens each app shows, in menu order. */
const APP_SCREENS: Record<AppKind, NavPath[]> = {
  manager: ["/dashboard", "/insights", "/tables", "/menu", "/stock", "/customers", "/reports", "/marketing", "/settings"],
  pos: ["/tables", "/customers", "/menu", "/stock", "/reports", "/dashboard", "/settings"],
  waiter: ["/waiter"],
};

export function screensFor(role: string | undefined, app: AppKind = "manager"): readonly NavPath[] {
  // Signed out, or signed in without a restaurant yet: no screens.
  if (!role || role === "unknown") return [];
  const allowed = ROLE_SCREENS[role] ?? [];
  return APP_SCREENS[app].filter((to) => allowed.includes(to) && policyAllows(role, to));
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
  }, [], { pendingOrders: 0, lastSyncAt: null, error: "", notice: "", pendingStock: 0 });
  const pending = snapshot.pendingOrders + snapshot.pendingStock;
  const live = useSyncExternalStore(onLiveStatus, getLiveStatus, () => "off" as const);

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

  const tone = !online || snapshot.error || snapshot.notice ? "border-gold/60 bg-gold/15 text-gold-foreground" : "border-border bg-card text-foreground";
  const label = !online ? "Offline" : snapshot.error ? "Sync needs attention" : pending ? `${pending} to sync` : !staff ? "This device only" : live === "reconnecting" ? "Reconnecting…" : live === "live" ? "Live" : "Synced";

  return <>
    <div className="flex items-center gap-2">
      {staff ? <span className="hidden text-right text-xs leading-tight sm:block">
        <span className="block font-semibold">{staff.displayName}</span>
        <span className="text-muted-foreground">{staff.role === "unknown" ? "No restaurant yet" : ROLE_LABELS[staff.role]}</span>
      </span> : null}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className={`gap-1.5 ${tone}`} aria-label={`Sync status: ${label}`}>
        {online ? (live === "live" && !snapshot.error && !pending ? <span className="size-2 rounded-full bg-success" aria-hidden="true" /> : <Wifi className="size-3.5" />) : <WifiOff className="size-3.5" />}
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
        {/* The dialog's own ✕ closes it; a second Close button sat on top of it. */}
        <div className="pr-8">
          <DialogTitle>Sync</DialogTitle>
          <p className="mt-1 text-sm text-muted-foreground">Bills are saved on this device first, so billing never stops when the internet does.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Bills waiting to upload</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingOrders}</div></div>
          <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Other changes waiting</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingStock}</div></div>
        </div>
        <p className="text-sm text-muted-foreground">Last synced: {snapshot.lastSyncAt ? format(new Date(snapshot.lastSyncAt), "dd MMM yyyy, h:mm a") : "not yet"}</p>
        {snapshot.error ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"><strong className="flex items-center gap-2"><AlertTriangle className="size-4" />Sync needs attention</strong><p className="mt-1 break-words">{snapshot.error}</p></div> : null}
        {snapshot.notice ? <div role="status" className="rounded-lg border border-gold/50 bg-gold/10 p-3 text-sm"><p className="break-words">{snapshot.notice}</p><Button size="sm" variant="ghost" className="mt-1 -ml-2" onClick={() => void clearSyncNotice()}>Got it</Button></div> : null}
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

/** Shown to a signed-in account that isn't part of the restaurant. */
function NotLinked() {
  const { user, refresh } = useStaff();
  return (
    <div className="mx-auto max-w-md p-4 py-12 text-center">
      <Store className="mx-auto size-7 text-primary" />
      <h1 className="mt-3 text-xl font-bold">This login isn't linked to the restaurant</h1>
      <p className="mt-1 text-sm text-muted-foreground"><strong className="text-foreground">{user?.email}</strong> has no access right now. Sign in as admin and check Settings → Logins.</p>
      <Button variant="outline" className="mt-5" onClick={() => void refresh()}><RefreshCw />Check again</Button>
    </div>
  );
}

/** Wrong app, wrong device, or a login that's switched off. */
function AccessBlocked({ problem, own }: { problem: string; own: AppKind | null }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    await navigate({ to: "/auth", replace: true });
  };
  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="max-w-sm text-center">
        <ShieldCheck className="mx-auto size-8 text-primary" />
        <h1 className="mt-3 text-xl font-bold">Not available here</h1>
        <p className="mt-2 text-sm text-muted-foreground">{problem}</p>
        <div className="mt-5 flex flex-col gap-2">
          {own ? <Button onClick={() => { setAppMode(own); void navigate({ to: APPS[own].home }); }}><ArrowRightLeft />Open {APPS[own].name}</Button> : null}
          <Button variant="outline" onClick={() => void signOut()}><LogOut />Sign in with another login</Button>
        </div>
      </div>
    </div>
  );
}

type Tone = "light" | "dark";
const FrameContext = createContext<((tone: Tone) => void) | null>(null);
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Staff screens that share the persistent frame (sidebar, header, orders bell). */
const FRAMED = ["/", "/dashboard", "/marketing", "/tables", "/menu", "/stock", "/customers", "/reports", "/settings", "/setup"];
export function isFramedPath(pathname: string): boolean {
  return FRAMED.some((p) => (p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)));
}

/**
 * Mounted once in the root around staff pages, so moving between pages swaps
 * only the page: the sidebar, header, sync chip and live orders connection
 * stay put instead of being rebuilt on every tap.
 */
export function PersistentFrame({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [tone, setTone] = useState<Tone>("light");
  const { user, loading } = useStaff();
  const navigate = useNavigate();
  const framed = isFramedPath(pathname);
  const staffApp = framed || pathname === "/waiter" || pathname === "/insights";
  const app = useAppMode(user);
  useEffect(() => { syncAppModeFromUrl(); }, [pathname]);
  const terminal = useTerminalStatus();
  // Check in on start, every 5 minutes and when the connection comes back.
  const rid = user?.restaurantId ?? null;
  useEffect(() => {
    if (!rid) return;
    // Automated regression browsers don't register as terminals.
    if (isTestBrowser()) return;
    const touch = () => { void touchTerminal(rid, app, currentDevice()); };
    touch();
    const timer = window.setInterval(touch, 5 * 60_000);
    window.addEventListener("online", touch);
    return () => { window.clearInterval(timer); window.removeEventListener("online", touch); };
  }, [rid, app]);
  // Internal system: every staff screen needs a signed-in person.
  useEffect(() => {
    if (staffApp && !loading && !user) void navigate({ to: "/auth", replace: true });
  }, [staffApp, loading, user, navigate]);
  if (staffApp && (loading || !user)) {
    return (
      <div className="grid min-h-screen place-items-center bg-background">
        <img src={logo} alt="XTSY POS" width={44} height={44} className="rounded-xl opacity-80" />
      </div>
    );
  }
  // A terminal the admin blocked stops working for staff; the admin can still sign in to fix it.
  if (staffApp && user && terminal === "blocked" && !isAdmin(user)) {
    return <AccessBlocked problem="This terminal is blocked by the admin. Ask the admin to release or unblock it in Settings → Terminals." own={null} />;
  }
  // Each login keeps to its own app and devices, as the admin set them.
  const problem = staffApp && user && (user.login || user.role !== "unknown")
    ? accessProblem({ login: user.login, role: user.role === "unknown" ? null : user.role, row: user.loginRow, app: pathname.startsWith("/waiter") ? "waiter" : app, device: currentDevice() })
    : null;
  if (problem && user) return <AccessBlocked problem={problem} own={appsFor(user.login, user.role)[0] ?? null} />;
  const gates = staffApp ? <><PolicySync /><PinGate /></> : null;
  if (!framed) return <>{gates}{children}</>;
  return <FrameContext.Provider value={setTone}>{gates}<Frame tone={tone}>{children}</Frame></FrameContext.Provider>;
}

/** Pages wrap themselves in AppShell; inside the persistent frame it only sets the page's tone. */
export function AppShell({ children, tone = "light" }: { children: ReactNode; tone?: Tone }) {
  const setTone = useContext(FrameContext);
  useIsoLayoutEffect(() => { setTone?.(tone); }, [setTone, tone]);
  if (setTone) return <>{children}</>;
  return <Frame tone={tone}>{children}</Frame>;
}

const WIDE_KEY = "xtsy-sidebar-wide";

function Frame({ children, tone }: { children: ReactNode; tone: Tone }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // The menu opens with labels or stays a slim icon rail; each device remembers its choice.
  const [wide, setWide] = useState(false);
  useEffect(() => { try { setWide(window.localStorage.getItem(WIDE_KEY) === "1"); } catch { /* storage unavailable */ } }, []);
  const toggleWide = () => setWide((w) => { try { window.localStorage.setItem(WIDE_KEY, w ? "0" : "1"); } catch { /* ignore */ } return !w; });
  const { user } = useStaff();
  const settings = useRestaurantSettings();
  const restaurantName = settings.name || user?.restaurantName || "";
  const needsRestaurant = !!user && !user.restaurantId && pathname !== "/settings";
  const lowStock = useLiveQuery(async () => {
    const [materials, levels] = await Promise.all([getDb().materials.toArray(), getMaterialLevels()]);
    return materials.filter((m) => !m.archived && isLow(m, levels.get(m.id) ?? 0)).length;
  }, [], 0);
  const app = useAppMode(user);
  usePolicy();
  const allowed = screensFor(user?.role, app);
  const nav = allowed.map((to) => NAV.find((n) => n.to === to)!).filter(Boolean);
  const otherApps = (appsFor(user?.login ?? null, user?.role) as AppKind[]).filter((a) => a !== app && a !== "waiter");
  // A bill ("/") belongs to Tables: it only opens from a table or a counter order there.
  const current = pathname === "/" ? NAV.find((n) => n.to === "/tables") : NAV.find((n) => n.to !== "/" && pathname.startsWith(n.to));
  const blocked = !!current && !allowed.includes(current.to);
  const home = nav[0]?.to ?? "/";
  const needsDetails = isAdmin(user) && !settings.updatedAt && pathname !== "/settings" && pathname !== "/setup";

  return (
    <div className={`flex min-h-screen bg-background text-foreground ${tone === "dark" ? "dark" : ""}`}>
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col bg-sidebar py-3 text-sidebar-foreground transition-[width] duration-200 lg:flex ${wide ? "w-60" : "w-[4.75rem]"}`}>
        <div className={`flex items-center gap-2.5 px-3 ${wide ? "" : "flex-col"}`}>
          <img src={logo} alt="XTSY POS" width={36} height={36} className="rounded-[10px]" />
          {wide ? <span className="flex-1 truncate text-[15px] font-semibold tracking-tight">{APPS[app].short}</span> : null}
          <button type="button" onClick={toggleWide} aria-label={wide ? "Collapse menu" : "Expand menu"} aria-expanded={wide}
            className="grid size-8 place-items-center rounded-lg text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground">
            {wide ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </button>
        </div>
        <nav className="no-scrollbar mt-4 flex w-full flex-col gap-0.5 overflow-y-auto px-2" aria-label="Main">
          {nav.map(({ to, label, icon: Icon }) => {
            const active = to === "/tables" ? pathname === "/" || pathname.startsWith(to) : pathname.startsWith(to);
            return (
              <Link key={to} to={to} aria-current={active ? "page" : undefined} title={wide ? undefined : label}
                className={`relative flex items-center rounded-[10px] font-medium transition-colors ${wide ? "gap-3 px-3 py-2.5 text-sm" : "flex-col gap-1 px-1 py-2 text-[10.5px]"} ${active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/65 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"}`}>
                {active ? <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-sidebar-primary" aria-hidden="true" /> : null}
                <Icon className={wide ? "size-[1.15rem] shrink-0" : "size-[1.3rem]"} strokeWidth={active ? 2.2 : 1.8} />
                <span className="truncate">{label}</span>
                {to === "/stock" && lowStock > 0 ? <span className={`min-w-[1.1rem] rounded-full bg-destructive px-1 text-center text-[10px] font-semibold text-destructive-foreground ${wide ? "ml-auto" : "absolute right-1.5 top-1"}`} aria-label={`${lowStock} running low`}>{lowStock}</span> : null}
              </Link>
            );
          })}
        </nav>
        {otherApps.length ? (
          <div className="mt-auto flex flex-col gap-0.5 px-2 pt-2">
            {otherApps.map((a) => (
              <a key={a} href={APP_LINKS[a]} title={wide ? undefined : `Open ${APPS[a].name}`}
                className={`flex items-center rounded-[10px] text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground ${wide ? "gap-3 px-3 py-2 text-xs" : "flex-col gap-1 px-1 py-2 text-[10px]"}`}>
                <ArrowRightLeft className={wide ? "size-4 shrink-0" : "size-[1.1rem]"} /><span className="truncate">{wide ? `Open ${APPS[a].short}` : APPS[a].short.split(" ")[0]}</span>
              </a>
            ))}
          </div>
        ) : null}
        <div className={`${otherApps.length ? "" : "mt-auto "}px-3 pt-2 text-[10px] leading-tight text-sidebar-foreground/40`}>{wide ? `${APPS[app].name} · works offline` : "XTSY"}</div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src={logo} alt="" width={28} height={28} className="rounded-[8px] lg:hidden" />
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold tracking-tight">{restaurantName || "XTSY POS"}</div>
              <div className="text-[11px] text-muted-foreground">{APPS[app].name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2"><GuestOrdersButton /><InstallButton /><SyncChip /></div>
        </header>
        {needsDetails && !needsRestaurant ? (
          <Link to="/setup" className="flex items-center gap-2 border-b border-gold/40 bg-gold/15 px-4 py-2 text-sm font-medium text-gold-foreground lg:px-6">
            <AlertTriangle className="size-4 shrink-0" />Finish setting up: add your GSTIN, menu, tables and staff so bills carry your details.
          </Link>
        ) : null}
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">
          {needsRestaurant ? <NotLinked /> : blocked ? (
            <div className="mx-auto max-w-md p-8 text-center">
              <p className="font-semibold">This screen isn't part of {APPS[app].name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{isAdmin(user) ? "Open it from Business Manager." : "Ask the admin if you need it."}</p>
              <Link to={home} className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Go to {NAV.find((n) => n.to === home)?.label}</Link>
            </div>
          ) : children}
        </main>
      </div>

      <nav className="glass no-scrollbar fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-border/70 pb-[env(safe-area-inset-bottom)] text-foreground lg:hidden" aria-label="Main">
        {nav.map(({ to, label, icon: Icon }) => {
          const active = to === "/tables" ? pathname === "/" || pathname.startsWith(to) : pathname.startsWith(to);
          return (
            <Link key={to} to={to} aria-current={active ? "page" : undefined}
              className={`flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${active ? "text-primary" : "text-muted-foreground"}`}>
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
