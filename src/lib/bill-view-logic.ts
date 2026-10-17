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
  /** 1 for the bill's first ticket, 2 for the next… */
  number: number;
  at: number;
  cancel: boolean;
  station: string;
  kots: Kot[];
  lines: { itemId?: string | undefined; name: string; qty: number; note?: string | undefined }[];
}

/**
 * The bill's tickets in the order they went to the kitchen. Tickets sent in the
 * same moment (one per station) count as one KOT number, as the cashier sees it.
 */
export function sentGroups(kots: Kot[]): SentGroup[] {
  const sorted = [...kots].sort((a, b) => a.createdAt - b.createdAt);
  const groups: SentGroup[] = [];
  for (const k of sorted) {
    const cancel = k.kind === "cancel";
    const last = groups[groups.length - 1];
    if (last && last.at === k.createdAt && last.cancel === cancel) {
      last.kots.push(k);
      last.lines.push(...k.lines.map((l) => ({ ...l })));
      last.station = `${last.station}, ${k.station}`;
      continue;
    }
    groups.push({ key: k.uid ?? `${k.createdAt}-${k.station}`, number: groups.filter((g) => !g.cancel).length + (cancel ? 0 : 1), at: k.createdAt, cancel, station: k.station, kots: [k], lines: k.lines.map((l) => ({ ...l })) });
  }
  return groups;
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
