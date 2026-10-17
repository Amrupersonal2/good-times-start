import { useLiveQuery } from "dexie-react-hooks";
import { EMPTY_SETTINGS, getDb, getSettings } from "./db";
import type { RestaurantSettings } from "./types";

/** Restaurant details and billing rules as this device currently knows them (updates live as sync lands). */
export function useRestaurantSettings(): RestaurantSettings {
  return useLiveQuery(async () => {
    await getDb().meta.get("restaurantSettings");
    return getSettings();
  }, [], EMPTY_SETTINGS);
}
