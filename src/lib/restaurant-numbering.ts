import { supabase } from "@/integrations/supabase/client";
import { getDb } from "./db";
import { consumeReservedNumber, NUMBER_RESERVE_TARGET, readNumberCache, type ReservedNumber } from "./offline-numbering";

export type RestaurantNumberSeries = "POS" | "KOT";

const online = () => typeof navigator === "undefined" || navigator.onLine;
// v2: spare numbers reserved before Nov 2026's numbering reset are abandoned, so an
// old 20-number reserve can never collide with the restarted sequence.
const cacheKey = (restaurantId: string, series: RestaurantNumberSeries) => `reservedNumbers:v2:${restaurantId}:${series}`;

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

/** How long a bill waits for the cloud number before using a spare offline number. */
const CLOUD_NUMBER_WAIT_MS = 5000;

function withinWait<T>(work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The cloud took too long to give a number.")), CLOUD_NUMBER_WAIT_MS);
    work.then((value) => { clearTimeout(timer); resolve(value); }, (error: unknown) => { clearTimeout(timer); reject(error); });
  });
}

/**
 * Official numbers are reserved by the existing authenticated allocator, never invented locally.
 * Online bills take the next cloud number directly, so numbers run in order; the device's few
 * spare reserved numbers are used only when the cloud can't be reached.
 */
export async function allocateRestaurantNumber(series: RestaurantNumberSeries, requestId: string): Promise<string> {
  const restaurantId = await boundRestaurant();
  const db = getDb();
  const key = cacheKey(restaurantId, series);
  // A retry of the same bill or ticket always gets the number it was first given.
  const prior = readNumberCache((await db.meta.get(key))?.value).assigned[requestId];
  if (prior) return prior.number;

  let cloudFailure: unknown;
  if (online()) {
    try {
      const number = await withinWait(cloudNumber(restaurantId, series, requestId));
      // Persist even online results: retrying after a lost response/reload must reuse the same number.
      return await db.transaction("rw", db.meta, async () => {
        const cache = readNumberCache((await db.meta.get(key))?.value);
        const raced = cache.assigned[requestId];
        if (raced) return raced.number;
        cache.assigned[requestId] = { requestId, number };
        await db.meta.put({ key, value: JSON.stringify(cache) });
        return number;
      });
    } catch (failure) {
      cloudFailure = failure;
    }
  }

  const reserved = await db.transaction("rw", db.meta, async () => {
    const cache = readNumberCache((await db.meta.get(key))?.value);
    const next = consumeReservedNumber(cache, requestId);
    if (next) await db.meta.put({ key, value: JSON.stringify(cache) });
    return next;
  });
  if (reserved) return reserved.number;
  if (cloudFailure) throw cloudFailure;
  throw new Error("This device has used all its reserved offline numbers. Your items are saved; reconnect once to refill numbers, then send again.");
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

/**
 * A fresh cloud number for a record the cloud refused because its number is no
 * longer allocated (for example a spare used offline after a numbering reset).
 * A new request identity is used, so no locally cached number can be reused.
 */
export async function freshRestaurantNumber(series: RestaurantNumberSeries): Promise<{ number: string; requestId: string }> {
  const requestId = crypto.randomUUID();
  const number = await allocateRestaurantNumber(series, requestId);
  return { number, requestId: await allocatedNumberRequestId(series, requestId) };
}
