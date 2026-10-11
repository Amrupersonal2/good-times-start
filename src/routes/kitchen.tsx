import { createFileRoute } from "@tanstack/react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ChefHat, Clock } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { getDb } from "@/lib/db";
import type { KotStatus } from "@/lib/types";

export const Route = createFileRoute("/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen Display — Restro POS by XTSY" },
      { name: "description", content: "Kitchen display with KOTs split by station: New, Preparing and Ready." },
      { property: "og:title", content: "Kitchen Display — Restro POS" },
      { property: "og:description", content: "Station-wise KOTs with live timers for your kitchen." },
    ],
  }),
  component: KitchenPage,
});

const COLS: { s: KotStatus; label: string; next?: KotStatus; action?: string }[] = [
  { s: "new", label: "New", next: "preparing", action: "Start" },
  { s: "preparing", label: "Preparing", next: "ready", action: "Mark ready" },
  { s: "ready", label: "Ready" },
];

function KitchenPage() {
  const kots = useLiveQuery(() => getDb().kots.orderBy("createdAt").reverse().limit(60).toArray(), [], []);
  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <h1 className="mb-5 text-2xl font-bold">Kitchen display</h1>
        <div className="grid gap-4 md:grid-cols-3">
          {COLS.map((c) => {
            const list = kots.filter((k) => k.status === c.s);
            return (
              <div key={c.s} className="rounded-2xl bg-secondary/60 p-3">
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="font-semibold">{c.label}</h2>
                  <span className="rounded-full bg-card px-2 text-xs font-bold">{list.length}</span>
                </div>
                <div className="space-y-3">
                  {list.length === 0 && (
                    <div className="flex flex-col items-center py-8 text-muted-foreground"><ChefHat className="mb-2 size-7 opacity-40" /><span className="text-xs">Nothing here</span></div>
                  )}
                  {list.map((k) => (
                    <div key={k.id} className="card-elevated p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="rounded-md bg-primary-tint px-2 py-0.5 font-semibold text-primary">{k.station}</span>
                        <span className="flex items-center gap-1 text-muted-foreground"><Clock className="size-3" />{Math.max(0, Math.round((Date.now() - k.createdAt) / 60000))}m</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">{k.billNo}</div>
                      <ul className="mt-2 space-y-1 text-sm">
                        {k.lines.map((l, i) => (
                          <li key={i}><span className="font-bold">{l.qty}×</span> {l.name}{l.note && <span className="block text-xs text-warning">↳ {l.note}</span>}</li>
                        ))}
                      </ul>
                      {c.next ? (
                        <button onClick={() => getDb().kots.update(k.id!, { status: c.next! })}
                          className="mt-3 w-full rounded-lg bg-primary py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-hover">{c.action}</button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
