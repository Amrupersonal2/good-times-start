export interface ReservedNumber { requestId: string; number: string }
export interface NumberCache {
  available: ReservedNumber[];
  assigned: Record<string, ReservedNumber>;
  pending: string[];
}

/**
 * Spare numbers each device reserves for internet outages. Zero: spares come from the same
 * counter as real bills, so holding any would make POS and KOT numbers skip. Numbers are
 * given online only, keeping the sequence strict.
 */
export const NUMBER_RESERVE_TARGET = 0;

export function readNumberCache(value: unknown): NumberCache {
  if (typeof value !== "string") return { available: [], assigned: {}, pending: [] };
  try {
    const parsed = JSON.parse(value) as NumberCache;
    if (Array.isArray(parsed.available) && parsed.assigned && Array.isArray(parsed.pending)) return parsed;
  } catch { /* An empty cache is safer than reusing an uncertain number. */ }
  return { available: [], assigned: {}, pending: [] };
}

/** Pure transition; caller persists it inside a single IndexedDB write transaction. */
export function consumeReservedNumber(cache: NumberCache, requestId: string): ReservedNumber | undefined {
  if (cache.assigned[requestId]) return cache.assigned[requestId];
  const next = cache.available.shift();
  if (next) cache.assigned[requestId] = next;
  return next;
}