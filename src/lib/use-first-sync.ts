import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "./db";

/**
 * Has this device finished loading the restaurant at least once? Until it
 * has, an empty menu or floor here means "still loading", never "empty".
 */
export function useFirstSyncDone(): boolean | undefined {
  return useLiveQuery(async () => typeof (await getDb().meta.get("lastSyncAt"))?.value === "number", [], undefined);
}
