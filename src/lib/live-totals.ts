import type { Order } from "./types";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Totals for the day by payment time: settled bills count once, whatever device or day they were opened on. */
export function liveTotals(today: Order[], running: Order[], from: number, to: number) {
  const seen = new Set<string>();
  let settled = 0, cash = 0, upi = 0, other = 0, bills = 0;
  for (const o of today) {
    const key = o.uid ?? String(o.id ?? o.billNo);
    if (seen.has(key) || o.status !== "settled") continue;
    const at = o.settledAt ?? o.createdAt;
    if (at < from || at >= to) continue;
    seen.add(key);
    bills++;
    settled += o.total;
    for (const p of o.payments ?? []) {
      if (p.mode === "cash") cash += p.amount;
      else if (p.mode === "upi") upi += p.amount;
      else other += p.amount;
    }
  }
  const open = running.filter((o) => o.status === "held");
  return {
    settled: r2(settled), cash: r2(cash), upi: r2(upi), other: r2(other), bills,
    running: r2(open.reduce((s, o) => s + (o.total || 0), 0)), runningCount: open.length,
  };
}
