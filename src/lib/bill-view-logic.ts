/** How the counter shows a bill: grouped by kitchen ticket, newest work on top. Pure helpers. */
import type { CartLine, Kot } from "./types";

/** Two- or three-letter code for a dish tile, e.g. "Aloo Paratha" → "AP", "Cappuccino" → "CAP". */
export function shortCode(name: string): string {
  const words = name.replace(/\(.*?\)|\[.*?\]/g, " ").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => (/^\d/.test(w) ? w : w[0])).join("").toUpperCase().slice(0, 6);
}

export interface SentGroup {
  key: string;
  /** Stable, official restaurant-wide number printed on the ticket when available. */
  kotNo?: string;
  /** Fallback ordinal for legacy tickets without an allocated KOT number. */
  number: number;
  at: number;
  cancel: boolean;
  station: string;
  kots: Kot[];
  lines: { itemId?: string | undefined; name: string; qty: number; note?: string | undefined }[];
}

/**
 * The bill's tickets in the order they went to the kitchen. Tickets sent in the
 * same logical submission count as one KOT. Prefer the allocated restaurant-wide
 * KOT number; timestamps are only a compatibility fallback for legacy records.
 * Explicit submission IDs prevent unrelated sends with matching timestamps from
 * being merged, and station rows for one submission remain grouped together.
 */
export function sentGroups(kots: Kot[]): SentGroup[] {
  const sorted = [...kots].sort((a, b) => a.createdAt - b.createdAt);
  const groups = new Map<string, SentGroup>();
  let legacyNumber = 0;

  for (const k of sorted) {
    const cancel = k.kind === "cancel";
    const submissionKey = k.submissionId
      ? `submission:${k.submissionId}:${cancel ? "cancel" : "order"}`
      : k.kotNo
        ? `number:${k.kotNo}:${cancel ? "cancel" : "order"}`
        : `legacy:${k.orderUid ?? k.billNo}:${k.createdAt}:${cancel ? "cancel" : "order"}`;
    const group = groups.get(submissionKey);

    if (group) {
      group.kots.push(k);
      group.lines.push(...k.lines.map((l) => ({ ...l })));
      if (!group.station.split(", ").includes(k.station)) group.station = `${group.station}, ${k.station}`;
      group.kotNo ??= k.kotNo;
      continue;
    }

    if (!cancel) legacyNumber += 1;
    groups.set(submissionKey, {
      key: submissionKey,
      ...(k.kotNo ? { kotNo: k.kotNo } : {}),
      number: legacyNumber,
      at: k.createdAt,
      cancel,
      station: k.station,
      kots: [k],
      lines: k.lines.map((l) => ({ ...l })),
    });
  }

  return [...groups.values()];
}

/** Minutes since a moment, as "just now", "12 min" or "1 h 5 min". */
export function since(at: number, now = Date.now()): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** The bill line a sent item belongs to, so the cashier can reduce it from its KOT row. */
export function lineFor(lines: CartLine[], itemId: string | undefined, name: string): CartLine | undefined {
  return (itemId ? lines.find((l) => l.itemId === itemId) : undefined) ?? lines.find((l) => l.name === name);
}
