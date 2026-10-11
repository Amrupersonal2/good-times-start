import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { ClipboardList, LayoutGrid, ChefHat, BarChart3, UtensilsCrossed, Wifi, WifiOff, RefreshCw } from "lucide-react";
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
  const pending = useLiveQuery(() => getDb().orders.filter((o) => !o.synced).count().catch(() => 0), [], 0);
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
  const cls = online
    ? "bg-success/10 text-success"
    : "bg-warning/10 text-warning";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${cls}`}>
      {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
      {online ? (pending ? `Syncing (${pending})` : "Online") : "Offline"}
      {online && pending ? <RefreshCw className="size-3 animate-spin" /> : null}
    </span>
  );
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
