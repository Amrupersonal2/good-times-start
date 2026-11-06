import type { Kot } from "./types";

/** This device's printer setup. Stored on the device only; each counter or kitchen screen sets its own. */
/**
 * How this device reaches its printer without a print box:
 * "browser" — Chrome prints the slip; silent when the app is started with --kiosk-printing (computers);
 * "rawbt" — the slip goes as printer commands to the RawBT app, which prints straight away (Android, Bluetooth/Wi-Fi/USB).
 */
export type PrintMethod = "browser" | "rawbt";

export interface PrintConfig {
  /** Thermal paper width in mm. */
  paper: 58 | 80;
  method: PrintMethod;
  /** Explicit local confirmation that Chrome was launched with kiosk printing. */
  silentBrowserReady: boolean;
  billCopies: number;
  kotCopies: number;
  /** Print KOTs when this device sends them. */
  printKotOnSend: boolean;
  /** Print KOTs that arrive from other devices (for a kitchen station with its own printer). */
  printIncomingKots: boolean;
  /** Print the bill straight away when it's settled. */
  autoPrintBill: boolean;
  /** Kitchen stations this device prints; empty means every station. */
  stations: string[];
  /** Bigger item text on KOTs for the kitchen. */
  largeKotText: boolean;
  /** Tear-off feed in millimetres; outlet preference, not a printer standard. */
  endFeedMm: number;
  /** Cutter is opt-in because ESC/POS does not provide reliable universal capability discovery. */
  cutter: "none" | "full" | "partial";
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  paper: 58,
  method: "browser",
  silentBrowserReady: false,
  billCopies: 1,
  kotCopies: 1,
  printKotOnSend: true,
  printIncomingKots: false,
  autoPrintBill: false,
  stations: [],
  largeKotText: true,
  endFeedMm: 5,
  cutter: "none",
};

/** Read a stored config, falling back to defaults for anything missing or invalid. */
export function normalisePrintConfig(raw: unknown): PrintConfig {
  const r = raw && typeof raw === "object" ? (raw as Partial<PrintConfig>) : {};
  const copies = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.min(5, Math.max(0, n)) : 1);
  return {
    paper: r.paper === 80 ? 80 : 58,
    method: r.method === "rawbt" ? "rawbt" : "browser",
    silentBrowserReady: r.silentBrowserReady === true,
    billCopies: r.billCopies === undefined ? DEFAULT_PRINT_CONFIG.billCopies : copies(r.billCopies),
    kotCopies: r.kotCopies === undefined ? DEFAULT_PRINT_CONFIG.kotCopies : copies(r.kotCopies),
    printKotOnSend: typeof r.printKotOnSend === "boolean" ? r.printKotOnSend : DEFAULT_PRINT_CONFIG.printKotOnSend,
    printIncomingKots: false,
    autoPrintBill: typeof r.autoPrintBill === "boolean" ? r.autoPrintBill : DEFAULT_PRINT_CONFIG.autoPrintBill,
    stations: Array.isArray(r.stations) ? r.stations.filter((s): s is string => typeof s === "string") : [],
    largeKotText: typeof r.largeKotText === "boolean" ? r.largeKotText : DEFAULT_PRINT_CONFIG.largeKotText,
    endFeedMm: typeof r.endFeedMm === "number" && Number.isFinite(r.endFeedMm) ? Math.min(100, Math.max(0, r.endFeedMm)) : DEFAULT_PRINT_CONFIG.endFeedMm,
    cutter: r.cutter === "full" || r.cutter === "partial" ? r.cutter : "none",
  };
}

/** Incoming cloud mirrors are never print commands, even with legacy settings. */
export function shouldPrintKot(source: "sent" | "incoming" | "reprint", config: PrintConfig): boolean {
  return source !== "incoming" && (source === "reprint" || config.printKotOnSend);
}

/** KOTs this device should print. */
export function kotsForDevice(kots: Kot[], config: PrintConfig): Kot[] {
  return config.stations.length ? kots.filter((k) => config.stations.includes(k.station)) : kots;
}

/**
 * Group KOTs into printed tickets: one per station, or one combined ticket
 * (per kind, so a cancellation never prints on the same slip as new items).
 */
export function kotPrintGroups(kots: Kot[], byStation: boolean): Kot[][] {
  if (byStation) {
    const groups = new Map<string, Kot[]>();
    for (const kot of kots) {
      const key = `${kot.kind === "cancel" ? "cancel" : "new"}:${kot.station || "Kitchen"}`;
      const group = groups.get(key);
      if (group) group.push(kot);
      else groups.set(key, [kot]);
    }
    return [...groups.values()];
  }
  const orders = kots.filter((k) => k.kind !== "cancel");
  const cancels = kots.filter((k) => k.kind === "cancel");
  return [orders, cancels].filter((g) => g.length);
}

/** Repeat each printed document for the number of copies. */
export function withCopies<T>(docs: T[], copies: number): T[] {
  const n = Math.max(0, Math.min(5, Math.floor(copies)));
  return docs.flatMap((d) => Array.from({ length: n }, () => d));
}

/** CSS for thermal printing at the configured paper width. */
export function printCss(paper: 58 | 80): string {
  const content = paper === 58 ? 48 : 72;
  return `@media print {
  @page { size: ${paper}mm auto; margin: 0; }
  html, body { background: #fff !important; margin: 0 !important; min-height: 0 !important; height: auto !important; }
  body *:not(:has(#print-root)):not(#print-root):not(#print-root *) { display: none !important; }
  body *:has(#print-root) { display: contents !important; }
  #print-root, #print-root * { visibility: visible; }
  #print-root { position: absolute; left: 0; top: 0; width: ${content}mm; }
  #print-root .print-ticket { width: ${content}mm; max-width: none; margin: 0; padding: 0; break-inside: avoid; page-break-inside: avoid; break-after: auto; page-break-after: auto; }
  #print-root .print-ticket:last-child { break-after: auto; page-break-after: auto; }
  #print-root .print-ticket:has(.kot-print-slip) { padding-bottom: 0; }
  #print-root .kot-print-slip::after { content: ""; display: block; height: 0; }
}`;
}
