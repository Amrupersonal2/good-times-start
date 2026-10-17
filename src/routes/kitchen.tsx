import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, BellOff, ChefHat, Clock, Printer, Undo2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { markKotsSeen, printKots } from "@/components/PrintHost";
import { getDb, markDirty } from "@/lib/db";
import type { Kot, KotStatus } from "@/lib/types";

export const Route = createFileRoute("/kitchen")({
  head: () => ({
    meta: [
      { title: "Kitchen display — XTSY POS" },
      { name: "description", content: "Kitchen tickets by station with ageing timers, live from every billing device." },
    ],
  }),
  component: KitchenPage,
});

const COLS: { s: KotStatus; label: string; next?: KotStatus; action?: string }[] = [
  { s: "new", label: "New", next: "preparing", action: "Start" },
  { s: "preparing", label: "Cooking", next: "ready", action: "Ready" },
  { s: "ready", label: "Ready to serve", next: "served", action: "Served" },
];
const WINDOW_MS = 12 * 60 * 60 * 1000;
const STATION_KEY = "xtsy-pos-kitchen-station";
const SOUND_KEY = "xtsy-pos-kitchen-sound";

function readPref(key: string, fallback: string) {
  try { return window.localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function writePref(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

/** A short two-tone chime, made in the browser so it works offline. */
function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.3);
  });
}

function age(kot: Kot, now: number) {
  const minutes = Math.max(0, Math.floor((now - kot.createdAt) / 60000));
  const tone = kot.kind === "cancel" ? "border-destructive"
    : kot.status === "ready" ? "border-success"
    : minutes >= 25 ? "border-destructive" : minutes >= 15 ? "border-gold" : "border-border";
  return { minutes, tone };
}

function KitchenPage() {
  const since = Date.now() - WINDOW_MS;
  const kots = useLiveQuery(() => getDb().kots.where("createdAt").aboveOrEqual(since).toArray(), [Math.floor(since / 60000)], []);
  const [station, setStation] = useState("All");
  const [sound, setSound] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    setStation(readPref(STATION_KEY, "All"));
    setSound(readPref(SOUND_KEY, "off") === "on");
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const stations = useMemo(() => ["All", ...[...new Set(kots.map((k) => k.station))].sort()], [kots]);
  const visible = kots.filter((k) => k.status !== "served" && (station === "All" || k.station === station));

  // Chime (and print, if this device prints incoming tickets) for tickets that arrive while the screen is open.
  useEffect(() => {
    const ids = new Set(kots.map((k) => k.uid ?? String(k.id)));
    if (seen.current) {
      const fresh = kots.filter((k) => k.status === "new" && !seen.current?.has(k.uid ?? String(k.id)));
      if (fresh.some((k) => station === "All" || k.station === station) && sound && audio.current) chime(audio.current);
      if (fresh.length) void printKots(fresh, "incoming");
    } else {
      markKotsSeen(kots);
    }
    seen.current = ids;
  }, [kots, sound, station]);

  const toggleSound = () => {
    const next = !sound;
    if (next && !audio.current) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audio.current = new Ctx();
    }
    if (next && audio.current) { void audio.current.resume(); chime(audio.current); }
    setSound(next);
    writePref(SOUND_KEY, next ? "on" : "off");
  };
  const chooseStation = (value: string) => { setStation(value); writePref(STATION_KEY, value); };

  const move = async (kot: Kot, status: KotStatus) => {
    if (kot.id === undefined) return;
    await getDb().kots.update(kot.id, { status });
    if (kot.uid) await markDirty(["kot", kot.uid]);
  };

  return (
    <AppShell tone="dark">
      <div className="p-4 lg:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">Kitchen</h1>
          <div className="flex flex-wrap items-center gap-2">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto" role="tablist" aria-label="Station">
              {stations.map((s) => (
                <button key={s} role="tab" aria-selected={station === s} onClick={() => chooseStation(s)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-semibold ${station === s ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>{s}</button>
              ))}
            </div>
            <button onClick={toggleSound} className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold" aria-pressed={sound}>
              {sound ? <Bell className="size-4" /> : <BellOff className="size-4" />}{sound ? "Sound on" : "Turn on sound"}
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {COLS.map((c) => {
            const list = visible.filter((k) => k.status === c.s).sort((a, b) => a.createdAt - b.createdAt);
            return (
              <section key={c.s} className="rounded-xl bg-secondary/60 p-3" aria-label={c.label}>
                <div className="mb-3 flex items-center justify-between px-1">
                  <h2 className="text-lg font-bold">{c.label}</h2>
                  <span className="rounded-full bg-card px-2.5 text-sm font-bold">{list.length}</span>
                </div>
                <div className="space-y-3">
                  {list.length === 0 && (
                    <div className="flex flex-col items-center py-10 text-muted-foreground"><ChefHat className="mb-2 size-7 opacity-40" /><span className="text-sm">Nothing here</span></div>
                  )}
                  {list.map((k) => {
                    const { minutes, tone } = age(k, now);
                    const cancel = k.kind === "cancel";
                    return (
                      <article key={k.uid ?? k.id} className={`rounded-xl border-2 bg-card p-3 ${tone} ${cancel ? "bg-destructive/15" : ""}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="text-xl font-extrabold leading-tight">{k.tableId ? `Table ${k.tableLabel ?? k.tableId}` : k.orderType ?? "Order"}</div>
                            <div className="text-xs text-muted-foreground">{k.station}, {k.billNo}</div>
                          </div>
                          <span className={`flex items-center gap-1 text-sm font-bold ${minutes >= 25 ? "text-destructive" : minutes >= 15 ? "text-gold" : "text-muted-foreground"}`}><Clock className="size-3.5" />{minutes}m</span>
                        </div>
                        {cancel ? <div className="mt-2 rounded-md bg-destructive px-2 py-1 text-sm font-extrabold text-destructive-foreground">Cancel: stop making these</div> : null}
                        <ul className="mt-2 space-y-1">
                          {k.lines.map((l, i) => (
                            <li key={i} className={`text-base ${cancel ? "line-through decoration-2" : ""}`}>
                              <span className="font-extrabold">{l.qty} ×</span> {l.name}
                              {l.note ? <span className="block text-sm font-semibold text-gold">Note: {l.note}</span> : null}
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex gap-2">
                          {cancel ? (
                            <button onClick={() => void move(k, "served")} className="flex-1 rounded-lg bg-destructive py-2.5 text-sm font-bold text-destructive-foreground">Got it</button>
                          ) : c.next ? (
                            <button onClick={() => void move(k, c.next!)} className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary-hover">{c.action}</button>
                          ) : null}
                          {c.s !== "new" && !cancel ? (
                            <button aria-label="Move back" title="Move back" onClick={() => void move(k, c.s === "ready" ? "preparing" : "new")} className="rounded-lg bg-secondary px-3"><Undo2 className="size-4" /></button>
                          ) : null}
                          <button aria-label="Reprint ticket" title="Reprint ticket" onClick={() => void printKots([k], "reprint")} className="rounded-lg bg-secondary px-3"><Printer className="size-4" /></button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </AppShell>
  );
}
