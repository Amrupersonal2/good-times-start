import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Kot, Order } from "@/lib/types";
import { formatINR, upiLink } from "@/lib/billing";
import { exemptionNote, gstModeOf } from "@/lib/billing-config";
import { useRestaurantSettings } from "@/lib/use-settings";

export const ORDER_TYPE_LABEL: Record<Order["orderType"], string> = {
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
  swiggy: "Swiggy",
  zomato: "Zomato",
};

const PAY_LABEL: Record<string, string> = { cash: "Cash", upi: "UPI", card: "Card", wallet: "Wallet", credit: "Due", points: "Points" };

function Rule() {
  return <div className="my-2 border-t border-dashed border-black/50" />;
}

const time = (at: number) => new Date(at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Customer bill: tax invoice, bill of supply, pre-bill (running) or void copy. */
export function Receipt({ order }: { order: Order }) {
  const settings = useRestaurantSettings();
  const [qr, setQr] = useState("");
  const due = order.status === "held" ? order.total : order.payments.filter((p) => p.mode === "credit").reduce((s, p) => s + p.amount, 0);
  const showQr = !!settings.upiVpa && order.status !== "void" && due > 0;

  useEffect(() => {
    if (!showQr || !settings.upiVpa) { setQr(""); return; }
    QRCode.toDataURL(upiLink({ vpa: settings.upiVpa, name: settings.name || "Restaurant", amount: due, billNo: order.billNo }), { width: 160, margin: 0 })
      .then(setQr).catch(() => setQr(""));
  }, [due, order.billNo, showQr, settings.upiVpa, settings.name]);

  const table = order.tableLabel ?? order.tableId;
  const exempt = Boolean(order.tax?.exempt);
  const composition = gstModeOf(settings) === "composition";
  const docTitle = order.status === "void" ? "Void bill"
    : order.status === "held" ? "Bill (not paid yet)"
    : exempt && composition ? "Bill of supply"
    : settings.gstin && !exempt ? "Tax invoice" : "Bill";
  const note = exempt ? exemptionNote(settings, order.orderType) : "";
  const taxable = order.taxable ?? order.subtotal - order.discountAmt;

  return (
    <div className="mx-auto w-full max-w-xs bg-white p-4 font-sans text-xs leading-snug text-black">
      <div className="text-center">
        <div className="text-base font-extrabold">{settings.name || "Restaurant"}</div>
        {settings.legalName && settings.legalName !== settings.name ? <div>{settings.legalName}</div> : null}
        {settings.address ? <div className="whitespace-pre-line">{settings.address}</div> : null}
        {settings.phone ? <div>Phone {settings.phone}</div> : null}
        {settings.gstin ? <div>GSTIN {settings.gstin}</div> : null}
        {settings.fssai ? <div>FSSAI Lic. {settings.fssai}</div> : null}
        <div className="mt-1 text-sm font-bold">{docTitle}</div>
        {order.status === "void" && order.voidReason ? <div>{order.voidReason}</div> : null}
      </div>
      <Rule />
      <div className="flex justify-between"><span>Bill {order.billNo}</span><span>{new Date(order.createdAt).toLocaleDateString("en-IN")}</span></div>
      <div className="flex justify-between"><span>{ORDER_TYPE_LABEL[order.orderType]}{table ? `, table ${table}` : ""}</span><span>{time(order.createdAt)}</span></div>
      {order.customer?.name || order.customer?.phone ? <div>Guest: {[order.customer.name, order.customer.phone].filter(Boolean).join(", ")}</div> : null}
      {order.customer?.gstin ? <div>Guest GSTIN: {order.customer.gstin}</div> : null}
      <Rule />
      <table className="w-full">
        <thead>
          <tr className="text-left"><th className="font-semibold">Item</th><th className="text-right font-semibold">Qty</th><th className="text-right font-semibold">Amount</th></tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i} className="align-top">
              <td className="pr-1">{l.name}{l.note ? ` (${l.note})` : ""}</td>
              <td className="text-right">{l.qty}</td>
              <td className="text-right">{formatINR(l.price * l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Rule />
      <div className="space-y-0.5">
        <div className="flex justify-between"><span>{order.tax?.inclusive && !exempt ? "Total (GST included)" : "Subtotal"}</span><span>{formatINR(order.subtotal)}</span></div>
        {order.discountAmt > 0 ? <div className="flex justify-between"><span>Discount ({order.discountPct}%)</span><span>-{formatINR(order.discountAmt)}</span></div> : null}
        {order.tax?.inclusive && !exempt ? <div className="flex justify-between"><span>Taxable value</span><span>{formatINR(taxable)}</span></div> : null}
        {(order.serviceCharge ?? 0) > 0 ? <div className="flex justify-between"><span>Service charge ({order.serviceChargePct}%)</span><span>{formatINR(order.serviceCharge ?? 0)}</span></div> : null}
        {!exempt ? <>
          <div className="flex justify-between"><span>CGST</span><span>{formatINR(order.cgst)}</span></div>
          <div className="flex justify-between"><span>SGST</span><span>{formatINR(order.sgst)}</span></div>
        </> : null}
        {order.roundOff ? <div className="flex justify-between"><span>Round off</span><span>{formatINR(order.roundOff)}</span></div> : null}
        <div className="flex justify-between pt-1 text-sm font-extrabold"><span>Total</span><span>{formatINR(order.total, order.roundOff || Number.isInteger(order.total) ? 0 : 2)}</span></div>
      </div>
      {note ? <div className="mt-1 text-[10px]">{note}</div> : null}
      {order.payments.length ? <>
        <Rule />
        {order.payments.map((p, i) => <div key={i} className="flex justify-between"><span>{p.mode === "credit" ? "Due" : `Paid by ${PAY_LABEL[p.mode] ?? p.mode}`}</span><span>{formatINR(p.amount)}</span></div>)}
      </> : null}
      {showQr && qr ? (
        <div className="mt-3 text-center">
          <img src={qr} alt={`UPI QR to pay ${formatINR(due, 0)}`} width={120} height={120} className="mx-auto" />
          <div className="mt-1">Scan to pay {formatINR(due, 0)} by UPI</div>
        </div>
      ) : null}
      <div className="mt-3 text-center">
        <div>{settings.billFooter || "Thank you! Visit again."}</div>
        <div className="mt-1 text-[10px] text-black/60">Billed with XTSY POS</div>
      </div>
    </div>
  );
}

/** Kitchen order ticket. Several KOTs print as one combined slip, grouped by station. */
export function KotTicket({ kots, large = true }: { kots: Kot[]; large?: boolean }) {
  const settings = useRestaurantSettings();
  const first = kots[0];
  if (!first) return null;
  const cancel = first.kind === "cancel";
  const table = first.tableLabel ?? first.tableId;
  const combined = kots.length > 1;
  const item = large ? "text-base" : "text-sm";
  return (
    <div className="mx-auto w-full max-w-xs bg-white p-4 font-sans text-sm text-black">
      <div className="text-center">
        {settings.kotHeader ? <div className="text-xs">{settings.kotHeader}</div> : null}
        <div className={cancel ? "text-xl font-extrabold" : "text-xs"}>{cancel ? "CANCEL these items" : "Kitchen order ticket"}</div>
        <div className="text-2xl font-extrabold">{table ? `Table ${table}` : ORDER_TYPE_LABEL[first.orderType ?? "dine-in"]}</div>
        {!combined ? <div className="text-base font-bold">{first.station}</div> : null}
      </div>
      <Rule />
      <div className="flex justify-between text-xs"><span>{first.billNo}</span><span>{time(first.createdAt)}</span></div>
      {kots.map((k, gi) => (
        <div key={k.uid ?? gi}>
          <Rule />
          {combined ? <div className="mb-1 text-xs font-bold uppercase">{k.station}</div> : null}
          <ul className="space-y-1">
            {k.lines.map((l, i) => (
              <li key={i}>
                <span className={`${item} font-bold ${cancel ? "line-through" : ""}`}>{l.qty} × {l.name}</span>
                {l.note ? <span className="block pl-5 text-xs font-semibold">Note: {l.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
