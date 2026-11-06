import { supabase } from "@/integrations/supabase/client";
import { getDb } from "./db";

export type RestaurantNumberSeries = "POS" | "KOT";

/**
 * Allocate a restaurant-wide number. Official invoice/KOT numbers are never
 * fabricated offline: callers must keep the action pending until the cloud is
 * reachable. Reuse requestId when retrying an uncertain network response.
 */
export async function allocateRestaurantNumber(
  series: RestaurantNumberSeries,
  requestId: string,
): Promise<string> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error("An internet connection is required to allocate the next bill or KOT number. Your current order has not been submitted.");
  }

  const restaurantId = (await getDb().meta.get("restaurantId"))?.value;
  if (typeof restaurantId !== "string" || !restaurantId) {
    throw new Error("This POS device has not finished connecting to the restaurant. Wait for Live sync and try again.");
  }

  const rpc = supabase.rpc as unknown as (
    functionName: string,
    args: Record<string, string>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("allocate_restaurant_number", {
    _restaurant_id: restaurantId,
    _series: series,
    _request_id: requestId,
  });

  if (error) throw new Error(`Couldn't allocate a ${series} number: ${error.message}`);
  if (typeof data !== "string" || !new RegExp(`^${series}/\\d{4,}$`).test(data)) {
    throw new Error(`The server returned an invalid ${series} number. Nothing was submitted.`);
  }
  return data;
}
