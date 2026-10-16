import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardList, LayoutGrid, ChefHat, BarChart3, UtensilsCrossed, Wifi, WifiOff, RefreshCw, AlertTriangle, X, Sparkles, LogIn, LogOut, UserRound } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useStaff } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { syncCloudData, getSyncSnapshot, saveSyncError } from "@/lib/cloud-sync";
import { diagnoseCloudSync } from "@/lib/sync-diagnosis.functions";
import logo from "@/assets/logo.png";
import { getDb } from "@/lib/db";

const NAV = [
  { to: "/", label: "Billing", icon: ClipboardList },
  { to: "/tables", label: "Tables", icon: LayoutGrid },
  { to: "/kitchen", label: "Kitchen", icon: ChefHat },
  { to: "/menu", label: "Menu", icon: UtensilsCrossed },
  { to: "/reports", label: "Reports", icon: BarChart3 },
] as const;

function SyncChip() {
  const [online, setOnline] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [description, setDescription] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [diagnosing, setDiagnosing] = useState(false);
  const staff = useStaff().user;
  const navigate = useNavigate();
  const snapshot = useLiveQuery(async () => {
    const current = await getSyncSnapshot();
    await getDb().orders.count();
    await getDb().inventory.count();
    return current;
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
  const retry = async () => {
    if (!staff) { await navigate({ to: "/auth" }); return; }
    if (!online) { await saveSyncError(new Error("No internet connection. Orders remain safely stored on this device.")); return; }
    setBusy(true);
    try {
      await syncCloudData(staff.id);
    } catch (error) {
      await saveSyncError(error);
    } finally {
      setBusy(false);
    }
  };
  const runDiagnosis = async () => {
    if (!description.trim() || staff?.role !== "owner") return;
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
    await supabase.auth.signOut();
    await navigate({ to: "/" });
  };
  const cls = online
    ? "bg-success/10 text-success"
    : "bg-warning/10 text-warning";
  return <>
    <div className="flex items-center gap-2">
      {staff ? <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex"><UserRound className="size-3.5" />{staff.displayName}</span> : null}
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} className={`gap-1.5 ${cls}`} aria-label="Open sync status">
        {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {online ? (pending ? `${pending} pending` : "Online") : "Offline"}
        {busy ? <RefreshCw className="size-3 animate-spin" /> : null}
        {snapshot.error ? <AlertTriangle className="size-3.5" /> : null}
      </Button>
      {staff ? <Button size="icon" variant="ghost" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut /></Button> : <Button size="icon" variant="ghost" aria-label="Sign in" title="Sign in" onClick={() => void navigate({ to: "/auth" })}><LogIn /></Button>}
    </div>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div><DialogTitle>Cloud sync</DialogTitle><p className="mt-1 text-sm text-muted-foreground">Offline sales stay saved on this device.</p></div>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={() => setOpen(false)}><X /></Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Pending orders</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingOrders}</div></div>
          <div className="rounded-md border border-border p-3"><div className="text-xs text-muted-foreground">Pending stock</div><div className="mt-1 text-2xl font-bold">{snapshot.pendingStock}</div></div>
        </div>
        <p className="text-sm text-muted-foreground">Last successful sync: {snapshot.lastSyncAt ? format(new Date(snapshot.lastSyncAt), "dd MMM yyyy, h:mm a") : "Not yet synced"}</p>
        {snapshot.error ? <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"><strong className="flex items-center gap-2"><AlertTriangle className="size-4" />Sync needs attention</strong><p className="mt-1 break-words">{snapshot.error}</p></div> : null}
        {!staff ? <p className="text-sm text-muted-foreground">Sign in to mirror orders and stock to the cloud.</p> : null}
        <Button onClick={() => void retry()} disabled={busy || !online} className="w-full"><RefreshCw className={`size-4 ${busy ? "animate-spin" : ""}`} />{busy ? "Syncing…" : staff ? "Sync now" : "Sign in to sync"}</Button>
        {staff?.role === "owner" ? <section className="border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="size-4 text-primary" />Ask AI about this sync problem</h3>
          <label className="mt-3 block text-sm">What happened?
            <textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 1200))} maxLength={1200} rows={3} placeholder="For example: orders have stayed pending since reconnecting the Wi-Fi." className="mt-1 w-full resize-y rounded-md border border-input bg-card p-3" />
          </label>
          <Button variant="secondary" className="mt-2 w-full" disabled={diagnosing || description.trim().length < 5} onClick={() => void runDiagnosis()}>{diagnosing ? "Checking…" : "Suggest a fix"}</Button>
          {diagnosis ? <div role="status" className="mt-3 whitespace-pre-wrap rounded-md bg-secondary p-3 text-sm">{diagnosis}</div> : null}
        </section> : null}
      </DialogContent>
    </Dialog>
  </>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-col bg-sidebar text-sidebar-foreground lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <img src={logo} alt="Restro POS logo" width={36} height={36} className="rounded-lg" />
          <div>
            <div className="text-base font-bold leading-tight">Restro POS</div>
            <div className="text-[11px] font-medium tracking-wide text-gold">by XTSY</div>
          </div>
        </div>
        <nav className="mt-2 flex flex-col gap-1 px-3">
          {NAV.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "bg-sidebar-accent text-gold" : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
                }`}
              >
                <Icon className="size-4.5" />
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto px-5 py-4 text-[11px] text-sidebar-foreground/50">
          Powered by Restro POS by XTSY
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <img src={logo} alt="Restro POS logo" width={28} height={28} className="rounded-md" />
            <span className="text-sm font-bold">Restro POS</span>
          </div>
          <div className="hidden text-sm font-semibold text-muted-foreground lg:block">
            Spice Route Kitchen · Koramangala
          </div>
          <SyncChip />
        </header>
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {NAV.map(({ to, label, icon: Icon }) => {
          const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="size-5" />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
