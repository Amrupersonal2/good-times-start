import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Users } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { ensureSeed, getDb } from "@/lib/db";
import type { TableStatus } from "@/lib/types";

export const Route = createFileRoute("/tables")({
  head: () => ({
    meta: [
      { title: "Tables — Restro POS by XTSY" },
      { name: "description", content: "Live floor plan with table status across AC, Non-AC and Rooftop sections." },
      { property: "og:title", content: "Table Management — Restro POS" },
      { property: "og:description", content: "See free, occupied and reserved tables at a glance." },
    ],
  }),
  component: TablesPage,
});

const STATUS: Record<TableStatus, { label: string; cls: string }> = {
  free: { label: "Free", cls: "border-success/40 bg-success/5" },
  occupied: { label: "Occupied", cls: "border-primary/50 bg-primary-tint" },
  billed: { label: "Bill printed", cls: "border-gold/60 bg-gold/10" },
  reserved: { label: "Reserved", cls: "border-warning/50 bg-warning/10" },
};
const ORDER: TableStatus[] = ["free", "occupied", "billed", "reserved"];

function TablesPage() {
  useEffect(() => { void ensureSeed(); }, []);
  const tables = useLiveQuery(() => getDb().restTables.toArray(), [], []);
  const navigate = useNavigate();
  const cycle = (id: string, s: TableStatus) => {
    const next = ORDER[(ORDER.indexOf(s) + 1) % ORDER.length]!;
    void getDb().restTables.update(id, { status: next, since: next === "free" ? undefined : Date.now() });
  };

  return (
    <AppShell>
      <div className="p-4 lg:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Floor plan</h1>
          <div className="flex flex-wrap gap-3 text-xs">
            {ORDER.map((s) => (
              <span key={s} className={`rounded-full border px-2.5 py-1 font-medium ${STATUS[s].cls}`}>{STATUS[s].label}</span>
            ))}
          </div>
        </div>
        {(["AC", "Non-AC", "Rooftop"] as const).map((sec) => (
          <section key={sec} className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">{sec}</h2>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              {tables.filter((t) => t.section === sec).map((t) => (
                <div key={t.id} className={`flex aspect-square flex-col items-center justify-center rounded-2xl border-2 p-2 ${STATUS[t.status].cls}`}>
                  <button onClick={() => navigate({ to: "/" })} className="text-xl font-bold">{t.label}</button>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3" />{t.seats}</span>
                  <button onClick={() => cycle(t.id, t.status)} className="mt-1 rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold">{STATUS[t.status].label}</button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </AppShell>
  );
}
