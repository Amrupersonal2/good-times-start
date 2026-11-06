import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb, getDeviceCode } from "./db";
import { financialYear } from "./billing";

/**
 * This device's bill series code, kept live. Live queries are read-only, so a
 * fresh device's code is created here, outside the query, never inside it.
 */
export function useDeviceCode(): string {
  const stored = useLiveQuery(async () => {
    const value = (await getDb().meta.get("deviceCode"))?.value;
    if (typeof value !== "string") return "";
    const mapping = (await getDb().meta.get(`billSeries:${value}:${financialYear(new Date())}`))?.value;
    return typeof mapping === "string" ? mapping : value;
  }, [], null);
  useEffect(() => {
    if (stored === "") void getDeviceCode().catch(() => { /* storage unavailable; retried on next visit */ });
  }, [stored]);
  return stored ?? "";
}
