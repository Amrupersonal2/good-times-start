import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getPrintConfig, usePrintConfig } from "@/lib/print-config";
import { kotPrintGroups, kotsForDevice, printCss, withCopies, shouldPrintKot } from "@/lib/print-logic";
import { toast } from "sonner";
import { getDb, getSettings } from "@/lib/db";
import type { Kot, Order } from "@/lib/types";
import QRCode from "qrcode";
import { upiLink } from "@/lib/billing";
import { billSlip, escPos, kotSlip, rawbtIntent, KOT_END_FEED_MM } from "@/lib/slip";
import { SlipView } from "./Slip";
import { getChosenApp, useAppMode } from '@/lib/app-mode';
import { useStaff } from '@/lib/auth-context';
import { supabase } from '@/integrations/supabase/client';
import { getDeviceId } from '@/lib/terminal-actions';
import { flushCounterPrints, queueCounterPrint } from '@/lib/counter-print';
import { thermalDestination } from '@/lib/print-routing';

/**
 * One place every screen prints through. Bills and KOTs are thermal slips
 * (see slip.ts). With "browser" printing they render into a hidden #print-root,
 * one per page at this device's paper width, and Chrome prints them (silently when
 * the app runs with --kiosk-printing); with "rawbt" they go straight to the RawBT app. Printing never blocks billing: if it fails, nothing
 * else changes.
 */

let jobs: ReactNode[] = [];
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const snapshot = () => jobs;
const NOTHING: ReactNode[] = [];
// Must return the same value every time, or React re-renders forever.
const serverSnapshot = (): ReactNode[] => NOTHING;

/** KOTs this device printed already, so a ticket that later syncs back isn't printed twice. */
const printedKots = new Set<string>();

export function printDocuments(docs: ReactNode[]): void {
  if (!docs.length || typeof window === "undefined") return;
  jobs = docs;
  emit();
}

/** Send ready-made printer commands to RawBT (Android): it prints at once, with no preview or printer choice. */
function sendToRawbt(chunks: Uint8Array[]): void {
  const size = chunks.reduce((t, c) => t + c.length, 0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.length; }
  try { window.location.href = rawbtIntent(all); } catch { /* RawBT missing: the bill is already saved */ }
}

/** Print bill copies per this device's settings, in the thermal slip layout. */
export async function printBill(order: Order): Promise<void> {
  if (await routeWirelessPrint('bill', order)) return;
  const [config, settings] = await Promise.all([getPrintConfig(), getSettings()]);
  if (config.method === "browser" && !config.silentBrowserReady) { notifyPrinterSetup(); return; }
  const slip = billSlip(order, settings, config.paper, config.endFeedMm);
  const copies = Math.max(1, config.billCopies);
  const due = order.status === "held" ? order.total : order.payments.filter((p) => p.mode === "credit").reduce((s, p) => s + p.amount, 0);
  const link = slip.qr && settings.upiVpa ? upiLink({ vpa: settings.upiVpa, name: settings.name || "Restaurant", amount: due, billNo: order.billNo }) : undefined;
  if (config.method === "rawbt") { sendToRawbt([escPos(slip, { copies, cutter: config.cutter, ...(link ? { upiLink: link } : {}) })]); return; }
  const qr = link ? await QRCode.toDataURL(link, { width: 240, margin: 0 }).catch(() => undefined) : undefined;
  printDocuments(Array.from({ length: copies }, (_, i) => <SlipView key={`${order.billNo}-${i}`} slip={slip} qrDataUrl={qr} />));
}

/**
 * Print KOTs per this device's settings: only its stations, one ticket per
 * station or combined, the configured number of copies.
 * `source` "sent" = this device just sent them; "incoming" = they arrived from another device.
 */
export async function printKots(kots: Kot[], source: "sent" | "incoming" | "reprint"): Promise<void> {
  if (source === 'incoming') return;
  if (await routeWirelessPrint('kot', kots)) return;
  const config = await getPrintConfig();
  if (!shouldPrintKot(source, config)) return;
  if (config.method === "browser" && !config.silentBrowserReady) { notifyPrinterSetup(); return; }
  let mine = source === "reprint" ? kots : kotsForDevice(kots, config);
  if (source !== "reprint") mine = mine.filter((k) => !k.uid || !printedKots.has(k.uid));
  for (const k of mine) if (k.uid) printedKots.add(k.uid);
  if (!mine.length) return;
  const settings = await getSettings();
  const groups = withCopies(kotPrintGroups(mine, settings.kotByStation ?? true), Math.max(1, config.kotCopies));
  const slips = groups.map((g) => kotSlip(g, config.paper, settings.kotHeader ?? "", config.largeKotText, config.endFeedMm));
  if (config.method === "rawbt") { sendToRawbt(slips.map((slip) => escPos(slip, { cutter: config.cutter }))); return; }
  printDocuments(slips.map((slip, i) => <div key={`${groups[i]?.[0]?.uid ?? i}-${i}`} className="kot-print-slip"><SlipView slip={slip} /></div>));
}

/** Mark KOTs as already handled on this device (e.g. ones present when a screen opens). */
export function markKotsSeen(kots: Kot[]): void {
  for (const k of kots) if (k.uid) printedKots.add(k.uid);
}

/**
 * Prints tickets that arrive from other billing devices while this app is open,
 * when "Print KOTs sent from other devices" is on. This used to live on the
 * Kitchen display; it now runs app-wide so station printers work without a
 * kitchen screen.
 */
export function IncomingKotWatcher() {
  const since = Date.now() - 12 * 60 * 60 * 1000;
  const kots = useLiveQuery(() => getDb().kots.where("createdAt").aboveOrEqual(since).toArray(), [Math.floor(since / 60000)], []);
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    const ids = new Set(kots.map((k) => k.uid ?? String(k.id)));
    if (seen.current) {
      const fresh = kots.filter((k) => k.status === "new" && !seen.current?.has(k.uid ?? String(k.id)));
      if (fresh.length) void printKots(fresh, "incoming");
    } else {
      markKotsSeen(kots);
    }
    seen.current = ids;
  }, [kots]);

  return null;
}

export function PrintHost() {
  const docs = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const config = usePrintConfig();

  useEffect(() => {
    if (!docs.length) return;
    // Give QR codes and fonts a moment to render before the print dialog takes over.
    const timer = window.setTimeout(() => {
      if (!config.silentBrowserReady) { notifyPrinterSetup(); jobs = []; emit(); return; }
      try { window.print(); } catch { /* printing unavailable; bill is already saved */ }
    }, 450);
    const clear = () => { jobs = []; emit(); };
    window.addEventListener("afterprint", clear, { once: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", clear); };
  }, [docs, config.silentBrowserReady]);

  return (
    <>
      <style>{`#print-root { position: fixed; left: -10000px; top: 0; width: 80mm; --kot-end-feed: ${KOT_END_FEED_MM}mm; }\n${printCss(config.paper)}`}</style>
      <div id="print-root" aria-hidden="true">
        {docs.map((d, i) => <div key={i} className="print-ticket">{d}</div>)}
      </div>
    </>
  );
}

function notifyPrinterSetup(): void {
  toast.error("Set up silent printing on this device in Settings → Printing & KOT. No print window was opened.", { id: "printer-setup" });
}

async function routeWirelessPrint(kind: 'bill' | 'kot', payload: Order | Kot[]): Promise<boolean> {
  const destination = thermalDestination(getChosenApp() ?? 'pos');
  if (destination === 'blocked') return true;
  if (destination === 'local') return false;
  const { data } = await supabase.auth.getSession();
  const id = data.session?.user.id;
  if (!id) { toast.error('Sign in to send printing to the counter'); return true; }
  // Cached membership enables the durable local queue during outages.
  const cached = window.localStorage.getItem('xtsy-pos-staff');
  const staff = cached ? JSON.parse(cached) as { id: string; restaurantId: string | null } : null;
  if (!staff?.restaurantId || staff.id !== id) { toast.error('Restaurant access is unavailable'); return true; }
  await queueCounterPrint(staff.restaurantId, kind, payload);
  toast.success('Print request saved for the counter');
  return true;
}

/** Only the designated POS consumes explicit commands. Claimed jobs never replay automatically. */
export function CounterPrintWatcher() {
  const { user } = useStaff();
  const app = useAppMode(user);
  const config = usePrintConfig();
  useEffect(() => {
    const restaurant = user?.restaurantId;
    if (!restaurant || app === 'manager') return;
    let stopped = false;
    let busy = false;
    const run = async () => {
      if (busy || stopped || !navigator.onLine) return;
      busy = true;
      try {
        await flushCounterPrints(restaurant);
        if (app !== 'pos' || jobs.length || (config.method === 'browser' && !config.silentBrowserReady)) return;
        const device = await getDeviceId();
        const { data, error } = await supabase.rpc('claim_counter_print', { _restaurant: restaurant, _device: device });
        if (error || !data || stopped) return;
        const job = data as unknown as { id: string; kind: 'bill' | 'kot'; payload: Order | Kot[] };
        if (job.kind === 'kot' && Array.isArray(job.payload)) await printKots(job.payload, 'reprint');
        else if (job.kind === 'bill' && !Array.isArray(job.payload)) await printBill(job.payload);
        await supabase.rpc('finish_counter_print', { _id: job.id, _device: device });
      } catch { /* queue remains durable; dispatch is not physical print confirmation */ }
      finally { busy = false; }
    };
    void run();
    const timer = window.setInterval(() => void run(), 2500);
    window.addEventListener('online', run);
    return () => { stopped = true; window.clearInterval(timer); window.removeEventListener('online', run); };
  }, [user?.restaurantId, app, config.method, config.silentBrowserReady]);
  return null;
}
