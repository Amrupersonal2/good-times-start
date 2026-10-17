import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogTitle } from "@/components/ui/dialog";
import { computeTotals, formatINR, upiLink, type TaxOptions } from "@/lib/billing";
import { splitLines } from "@/lib/bill-splitting";
import { PAYMENT_MODES, paymentSummary, type Payment } from "@/lib/payment-logic";
import type { CartLine, PaymentMode } from "@/lib/types";

/** Shows a UPI QR for the exact amount so the guest can pay from their phone. */
export function UpiPay({ vpa, payee, amount, billNo, onPaid }: { vpa: string; payee: string; amount: number; billNo: string; onPaid: () => void }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(upiLink({ vpa, name: payee, amount, billNo }), { width: 240, margin: 1 }).then(setQr).catch(() => setQr(""));
  }, [vpa, payee, amount, billNo]);
  return (
    <div className="text-center">
      <DialogTitle>Scan to pay {formatINR(amount, 0)}</DialogTitle>
      {qr ? <img src={qr} alt={`UPI QR for ${formatINR(amount, 0)} to ${vpa}`} width={240} height={240} className="mx-auto mt-4 rounded-lg border border-border bg-white p-2" />
        : <div className="mx-auto mt-4 size-60 rounded-lg bg-secondary" />}
      <p className="mt-2 text-sm text-muted-foreground">Paying {payee} at {vpa}</p>
      <Button className="mt-5 w-full" onClick={onPaid}>Payment received</Button>
      <p className="mt-2 text-xs text-muted-foreground">Check the payment on your UPI app before confirming.</p>
    </div>
  );
}

/** Extra rules on top of the totals: points can't exceed the balance, and dues need a known guest. */
function paymentRuleError(entries: Payment[], pointsAvailable: number, hasCustomer: boolean): string {
  const points = entries.filter((e) => e.mode === "points").reduce((s, e) => s + Math.max(0, e.amount), 0);
  if (points > pointsAvailable) return `The guest has ${pointsAvailable} points to spend.`;
  if (!hasCustomer && entries.some((e) => e.mode === "credit" && e.amount > 0)) return "Add the guest's phone number on the bill to record a due.";
  return "";
}

function PaymentRows({ total, entries, setEntries, pointsAvailable, hasCustomer, allowedModes }: {
  total: number; entries: Payment[]; setEntries: (next: Payment[]) => void; pointsAvailable: number; hasCustomer: boolean; allowedModes?: PaymentMode[];
}) {
  const summary = paymentSummary(entries, total);
  const ruleError = paymentRuleError(entries, pointsAvailable, hasCustomer);
  const modes = PAYMENT_MODES.filter((m) => (!allowedModes || allowedModes.includes(m.v) || entries.some((e) => e.mode === m.v))
    && (m.v !== "points" || pointsAvailable > 0 || entries.some((e) => e.mode === "points")));
  const update = (index: number, change: Partial<Payment>) => setEntries(entries.map((p, i) => (i === index ? { ...p, ...change } : p)));
  return (
    <div>
      <div className="space-y-2">
        {entries.map((p, index) => (
          <div key={index} className="flex gap-2">
            <select aria-label="Payment mode" value={p.mode} onChange={(e) => update(index, { mode: e.target.value as PaymentMode })} className="rounded-lg border border-input bg-card px-2 py-2 text-sm">
              {modes.map((m) => <option key={m.v} value={m.v}>{m.v === "points" ? `${m.l} (${pointsAvailable})` : m.l}</option>)}
            </select>
            <input aria-label="Amount" inputMode="decimal" value={Number.isFinite(p.amount) && p.amount !== 0 ? String(p.amount) : ""}
              onChange={(e) => update(index, { amount: Number(e.target.value) || 0 })} placeholder="0"
              className="min-w-0 flex-1 rounded-lg border border-input bg-card px-3 py-2 text-right text-sm" />
            {entries.length > 1 ? <Button type="button" size="icon" variant="ghost" aria-label="Remove payment" onClick={() => setEntries(entries.filter((_, i) => i !== index))}><X /></Button> : null}
          </div>
        ))}
      </div>
      {summary.remaining > 0 ? (
        <Button type="button" size="sm" variant="ghost" className="mt-1" onClick={() => setEntries([...entries, { mode: entries.some((e) => e.mode === "cash") ? "upi" : "cash", amount: summary.remaining }])}>
          <Plus />Add {formatINR(summary.remaining)} by another mode
        </Button>
      ) : null}
      <div className="mt-3 space-y-1 rounded-lg bg-secondary p-3 text-sm">
        <div className="flex justify-between"><span>Bill</span><span className="font-semibold">{formatINR(total)}</span></div>
        <div className="flex justify-between"><span>Received</span><span>{formatINR(summary.tendered)}</span></div>
        {summary.remaining > 0 ? <div className="flex justify-between font-semibold text-destructive"><span>Still due</span><span>{formatINR(summary.remaining)}</span></div> : null}
        {summary.change > 0 ? <div className="flex justify-between text-base font-bold"><span>Change to return</span><span>{formatINR(summary.change)}</span></div> : null}
        {summary.error || ruleError ? <p role="alert" className="text-destructive">{summary.error || ruleError}</p> : null}
      </div>
    </div>
  );
}

/**
 * Settle with several payment modes (cash and UPI, say), or split the bill so
 * some guests pay for their items now and the rest stays on the table.
 */
export function PaymentPanel({ lines, discountPct, serviceChargePct, tax = {}, canSplitBill, pointsAvailable = 0, hasCustomer = false, allowedModes, onSettle, onSettlePart }: {
  lines: CartLine[];
  discountPct: number;
  serviceChargePct: number;
  tax?: TaxOptions;
  canSplitBill: boolean;
  /** Payment modes this restaurant accepts; all when left out. */
  allowedModes?: PaymentMode[];
  pointsAvailable?: number;
  hasCustomer?: boolean;
  onSettle: (payments: Payment[]) => void;
  onSettlePart: (quantities: Record<string, number>, payments: Payment[]) => void;
}) {
  const [tab, setTab] = useState<"pay" | "split">("pay");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const splitTotal = useMemo(() => {
    const { split } = splitLines(lines, quantities);
    return { count: split.reduce((s, l) => s + l.qty, 0), total: computeTotals(split, discountPct, serviceChargePct, tax).total };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tax rules are fixed for an open bill
  }, [discountPct, lines, quantities, serviceChargePct]);
  const total = tab === "pay" ? computeTotals(lines, discountPct, serviceChargePct, tax).total : splitTotal.total;
  const [entries, setEntries] = useState<Payment[]>([{ mode: "cash", amount: total }]);
  useEffect(() => { setEntries([{ mode: "cash", amount: total }]); }, [total]);
  const summary = paymentSummary(entries, total);

  return (
    <div>
      <DialogTitle>Take payment</DialogTitle>
      {canSplitBill ? (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1 text-sm font-semibold" role="tablist">
          {([["pay", "Whole bill"], ["split", "Split the bill"]] as const).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)}
              className={`rounded-md py-2 ${tab === v ? "bg-card shadow-sm" : "text-muted-foreground"}`}>{l}</button>
          ))}
        </div>
      ) : null}

      {tab === "split" ? (
        <div className="mt-4">
          <p className="text-sm text-muted-foreground">Choose what this guest is paying for. Everything else stays on the table.</p>
          <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
            {lines.map((l) => {
              const q = quantities[l.itemId] ?? 0;
              const set = (n: number) => setQuantities({ ...quantities, [l.itemId]: Math.max(0, Math.min(l.qty, n)) });
              return (
                <li key={l.itemId} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{l.name} <span className="text-muted-foreground">of {l.qty}</span></span>
                  <button type="button" aria-label={`Fewer ${l.name}`} onClick={() => set(q - 1)} className="rounded-md border border-input p-1"><Minus className="size-3.5" /></button>
                  <span className="w-6 text-center font-semibold">{q}</span>
                  <button type="button" aria-label={`More ${l.name}`} onClick={() => set(q + 1)} className="rounded-md border border-input p-1"><Plus className="size-3.5" /></button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="mt-4">
        {tab === "split" && splitTotal.count === 0
          ? <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">Pick items above to see this guest's share.</p>
          : <PaymentRows total={total} entries={entries} setEntries={setEntries} pointsAvailable={pointsAvailable} hasCustomer={hasCustomer} {...(allowedModes ? { allowedModes } : {})} />}
      </div>

      <Button className="mt-4 w-full" disabled={!summary.complete || !!paymentRuleError(entries, pointsAvailable, hasCustomer) || (tab === "split" && splitTotal.count === 0)}
        onClick={() => (tab === "pay" ? onSettle(entries) : onSettlePart(quantities, entries))}>
        {tab === "pay" ? `Settle ${formatINR(total, 0)}` : `Settle ${splitTotal.count} item${splitTotal.count === 1 ? "" : "s"}, ${formatINR(total, 0)}`}
      </Button>
    </div>
  );
}

const CANCEL_REASONS = ["Guest left before food", "Order entered by mistake", "Kitchen couldn't make it", "Duplicate order"];

/** Ask why a bill is being cancelled or voided; the reason stays with the bill. */
export function ReasonPrompt({ title, description, confirmLabel, onConfirm }: { title: string; description: string; confirmLabel: string; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div>
      <DialogTitle>{title}</DialogTitle>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {CANCEL_REASONS.map((r) => (
          <button key={r} type="button" onClick={() => setReason(r)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${reason === r ? "border-primary bg-primary-tint" : "border-border"}`}>{r}</button>
        ))}
      </div>
      <label className="mt-3 block text-sm font-medium">Reason
        <input value={reason} maxLength={140} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2.5 text-sm" />
      </label>
      <Button variant="destructive" className="mt-4 w-full" disabled={reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>{confirmLabel}</Button>
    </div>
  );
}
