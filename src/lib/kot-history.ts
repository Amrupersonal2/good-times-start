import type { Kot } from "./types";

export interface KotSubmission { id: string; first: Kot; tickets: Kot[] }

/** Older station rows share the exact send timestamp and order identity. Never group merely by bill. */
export function kotSubmissions(kots: Kot[]): KotSubmission[] {
  const groups = new Map<string, KotSubmission>();
  for (const kot of kots) {
    const key = kot.submissionId ?? `legacy:${kot.orderUid ?? kot.billNo}:${kot.createdAt}`;
    const group = groups.get(key);
    // Duplicate station/kind rows without a submission ID are ambiguous: preserve them separately.
    if (group && (!kot.submissionId && group.tickets.some((k) => k.station === kot.station && k.kind === kot.kind))) {
      const id = `${key}:${kot.uid ?? kot.id}`;
      groups.set(id, { id, first: kot, tickets: [kot] });
    } else if (group) group.tickets.push(kot);
    else groups.set(key, { id: key, first: kot, tickets: [kot] });
  }
  return [...groups.values()].sort((a, b) => b.first.createdAt - a.first.createdAt);
}

/** Restaurant-wide display format. The sequence is allocated by the local POS counter. */
export function kotNumber(_deviceId: string, _day: string, seq: number): string {
  return `KOT/${String(seq).padStart(4, "0")}`;
}