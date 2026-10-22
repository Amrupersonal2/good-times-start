import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb, getDeviceCode } from "./db";

/**
 * This device's bill series code, kept live. Live queries are read-only, so a
 * fresh device's code is created here, outside the query, never inside it.
 */
export function useDeviceCode(): string {
  const stored = useLiveQuery(async () => {
    const value = (await getDb().meta.get("deviceCode"))?.value;
    return typeof value === "string" ? value : "";
  }, [], null);
  useEffect(() => {
    if (stored === "") void getDeviceCode().catch(() => { /* storage unavailable; retried on next visit */ });
  }, [stored]);
  return stored ?? "";
}
