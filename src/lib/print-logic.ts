import type { Kot } from "./types";

/** This device's printer setup. Stored on the device only; each counter or kitchen screen sets its own. */
export interface PrintConfig {
  /** Thermal paper width in mm. */
  paper: 58 | 80;
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
}

export const DEFAULT_PRINT_CONFIG: PrintConfig = {
  paper: 80,
  billCopies: 1,
  kotCopies: 1,
  printKotOnSend: true,
  printIncomingKots: false,
  autoPrintBill: false,
  stations: [],
  largeKotText: true,
};

/** Read a stored config, falling back to defaults for anything missing or invalid. */
export function normalisePrintConfig(raw: unknown): PrintConfig {
  const r = raw && typeof raw === "object" ? (raw as Partial<PrintConfig>) : {};
  const copies = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? Math.min(5, Math.max(0, n)) : 1);
  return {
    paper: r.paper === 58 ? 58 : 80,
    billCopies: r.billCopies === undefined ? DEFAULT_PRINT_CONFIG.billCopies : copies(r.billCopies),
    kotCopies: r.kotCopies === undefined ? DEFAULT_PRINT_CONFIG.kotCopies : copies(r.kotCopies),
    printKotOnSend: typeof r.printKotOnSend === "boolean" ? r.printKotOnSend : DEFAULT_PRINT_CONFIG.printKotOnSend,
    printIncomingKots: typeof r.printIncomingKots === "boolean" ? r.printIncomingKots : DEFAULT_PRINT_CONFIG.printIncomingKots,
    autoPrintBill: typeof r.autoPrintBill === "boolean" ? r.autoPrintBill : DEFAULT_PRINT_CONFIG.autoPrintBill,
    stations: Array.isArray(r.stations) ? r.stations.filter((s): s is string => typeof s === "string") : [],
    largeKotText: typeof r.largeKotText === "boolean" ? r.largeKotText : DEFAULT_PRINT_CONFIG.largeKotText,
  };
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
  if (byStation) return kots.map((k) => [k]);
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
  @page { size: ${paper}mm auto; margin: 3mm; }
  html, body { background: #fff !important; }
  body * { visibility: hidden; }
  #print-root, #print-root * { visibility: visible; }
  #print-root { position: absolute; left: 0; top: 0; width: ${content}mm; }
  #print-root .print-ticket { width: ${content}mm; max-width: none; margin: 0; padding: 0 0 4mm; break-after: page; page-break-after: always; }
  #print-root .print-ticket:last-child { break-after: auto; page-break-after: auto; }
}`;
}
