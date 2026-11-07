export interface OfflineClaim { series: "POS" | "KOT"; requestId: string; number: number }

export function parseSequence(number: string): number {
  const m = /\/(\d+)$/.exec(number);
  return m ? Number(m[1]) : NaN;
}

/** Next number continuing the last synced series, formatted like the cloud allocator. */
export function nextOfflineNumber(series: "POS" | "KOT", lastKnown: number): { number: string; value: number } {
  const value = lastKnown + 1;
  return { value, number: `${series}/${String(value).padStart(4, "0")}` };
}

export function readClaims(value: unknown): OfflineClaim[] {
  if (typeof value !== "string") return [];
  try { const v = JSON.parse(value); return Array.isArray(v) ? v : []; } catch { return []; }
}
