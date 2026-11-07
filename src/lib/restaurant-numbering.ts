import { supabase } from "@/integrations/supabase/client";
import { getDb } from "./db";
import { consumeReservedNumber, NUMBER_RESERVE_TARGET, readNumberCache, type ReservedNumber } from "./offline-numbering";

export type RestaurantNumberSeries = "POS" | "KOT";

const online = () => typeof navigator === "undefined" || navigator.onLine;
const cacheKey = (restaurantId: string, series: RestaurantNumberSeries) => `reservedNumbers:${restaurantId}:${series}`;

async function boundRestaurant(): Promise<string> {
  const restaurantId = (await getDb().meta.get("restaurantId"))?.value;
  if (typeof restaurantId !== "string" || !restaurantId) {
    throw new Error("This POS device has not finished connecting to the restaurant. Wait for Live sync and try again.");
  }
  return restaurantId;
}

async function cloudNumber(restaurantId: string, series: RestaurantNumberSeries, requestId: string): Promise<string> {
  // RPC reads the client's REST transport through `this`; keep its receiver
  // when narrowing the signature for a function absent from generated types.
  const rpc = supabase.rpc.bind(supabase) as unknown as (
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

/** Official numbers are reserved by the existing authenticated allocator, never invented locally. */
export async function allocateRestaurantNumber(series: RestaurantNumberSeries, requestId: string): Promise<string> {
  const restaurantId = await boundRestaurant();
  const db = getDb();
  const key = cacheKey(restaurantId, series);
  const reserved = await db.transaction("rw", db.meta, async () => {
    const cache = readNumberCache((await db.meta.get(key))?.value);
    const next = consumeReservedNumber(cache, requestId);
    if (next) await db.meta.put({ key, value: JSON.stringify(cache) });
    return next;
  });
  if (reserved) return reserved.number;
  if (!online()) throw new Error("This device has used all its reserved offline numbers. Your items are saved; reconnect once to refill numbers, then send again.");
  const number = await cloudNumber(restaurantId, series, requestId);
  // Persist even online results: retrying after a lost response/reload must reuse the same number.
  await db.transaction("rw", db.meta, async () => {
    const cache = readNumberCache((await db.meta.get(key))?.value);
    cache.assigned[requestId] = { requestId, number };
    await db.meta.put({ key, value: JSON.stringify(cache) });
  });
  return number;
}

/** The guard validates the original cloud reservation identity, not the local bill/submission UID. */
export async function allocatedNumberRequestId(series: RestaurantNumberSeries, requestId: string): Promise<string> {
  const restaurantId = await boundRestaurant();
  const cache = readNumberCache((await getDb().meta.get(cacheKey(restaurantId, series)))?.value);
  return cache.assigned[requestId]?.requestId ?? requestId;
}

/** Serialize refill across tabs; interrupted reservations retain their idempotency IDs. */
export async function prepareOfflineNumbers(): Promise<void> {
  if (!online()) return;
  const restaurantId = await boundRestaurant();
  const refill = async () => {
    const db = getDb();
    for (const series of ["POS", "KOT"] as const) {
      const key = cacheKey(restaurantId, series);
      for (;;) {
        if (!online()) return;
        const requestId = await db.transaction("rw", db.meta, async () => {
          const cache = readNumberCache((await db.meta.get(key))?.value);
          if (cache.available.length >= NUMBER_RESERVE_TARGET) return undefined;
          const id = cache.pending[0] ?? crypto.randomUUID();
          if (!cache.pending.includes(id)) cache.pending.push(id);
          await db.meta.put({ key, value: JSON.stringify(cache) });
          return id;
        });
        if (!requestId) break;
        const number = await cloudNumber(restaurantId, series, requestId);
        await db.transaction("rw", db.meta, async () => {
          const cache = readNumberCache((await db.meta.get(key))?.value);
          const reservation: ReservedNumber = { requestId, number };
          if (!cache.available.some((n) => n.requestId === requestId) && !Object.values(cache.assigned).some((n) => n.requestId === requestId)) cache.available.push(reservation);
          cache.pending = cache.pending.filter((id) => id !== requestId);
          await db.meta.put({ key, value: JSON.stringify(cache) });
        });
      }
    }
  };
  if (typeof navigator !== "undefined" && navigator.locks) {
    await navigator.locks.request(`offline-number-refill:${restaurantId}`, refill);
  } else {
    await refill();
  }
}
