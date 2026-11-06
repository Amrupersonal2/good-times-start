import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "./db";
import { DEFAULT_PRINT_CONFIG, normalisePrintConfig, type PrintConfig } from "./print-logic";

const KEY = "printConfig";

export async function getPrintConfig(): Promise<PrintConfig> {
  const raw = (await getDb().meta.get(KEY))?.value;
  if (typeof raw !== "string") return DEFAULT_PRINT_CONFIG;
  try { return normalisePrintConfig(JSON.parse(raw)); } catch { return DEFAULT_PRINT_CONFIG; }
}

/** Printer setup belongs to this device only, so it isn't synced. */
export async function savePrintConfig(config: PrintConfig): Promise<void> {
  await getDb().meta.put({ key: KEY, value: JSON.stringify(normalisePrintConfig(config)) });
}

export function usePrintConfig(): PrintConfig {
  return useLiveQuery(async () => {
    await getDb().meta.get(KEY);
    return getPrintConfig();
  }, [], DEFAULT_PRINT_CONFIG);
}
