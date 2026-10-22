import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getPrintConfig, usePrintConfig } from "@/lib/print-config";
import { kotPrintGroups, kotsForDevice, printCss, withCopies } from "@/lib/print-logic";
import { getDb, getSettings } from "@/lib/db";
import type { Kot, Order } from "@/lib/types";
import { KotTicket, Receipt } from "./Receipt";

/**
 * One place every screen prints through. Documents render into a hidden
 * #print-root, one per page at this device's paper width, then the browser
 * print dialog opens. Printing never blocks billing: if it fails, nothing
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

/** Print bill copies per this device's settings. */
export async function printBill(order: Order): Promise<void> {
  const config = await getPrintConfig();
  printDocuments(withCopies([order], Math.max(1, config.billCopies)).map((o, i) => <Receipt key={`${o.billNo}-${i}`} order={o} />));
}

/**
 * Print KOTs per this device's settings: only its stations, one ticket per
 * station or combined, the configured number of copies.
 * `source` "sent" = this device just sent them; "incoming" = they arrived from another device.
 */
export async function printKots(kots: Kot[], source: "sent" | "incoming" | "reprint"): Promise<void> {
  const config = await getPrintConfig();
  if (source === "sent" && !config.printKotOnSend) { for (const k of kots) if (k.uid) printedKots.add(k.uid); return; }
  if (source === "incoming" && !config.printIncomingKots) return;
  let mine = source === "reprint" ? kots : kotsForDevice(kots, config);
  if (source !== "reprint") mine = mine.filter((k) => !k.uid || !printedKots.has(k.uid));
  for (const k of mine) if (k.uid) printedKots.add(k.uid);
  if (!mine.length) return;
  const settings = await getSettings();
  const groups = withCopies(kotPrintGroups(mine, settings.kotByStation ?? true), Math.max(1, config.kotCopies));
  printDocuments(groups.map((g, i) => <KotTicket key={`${g[0]?.uid ?? i}-${i}`} kots={g} large={config.largeKotText} />));
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
      try { window.print(); } catch { /* printing unavailable; bill is already saved */ }
    }, 450);
    const clear = () => { jobs = []; emit(); };
    window.addEventListener("afterprint", clear, { once: true });
    return () => { window.clearTimeout(timer); window.removeEventListener("afterprint", clear); };
  }, [docs]);

  return (
    <>
      <style>{`#print-root { position: fixed; left: -10000px; top: 0; width: 80mm; }\n${printCss(config.paper)}`}</style>
      <div id="print-root" aria-hidden="true">
        {docs.map((d, i) => <div key={i} className="print-ticket">{d}</div>)}
      </div>
    </>
  );
}
