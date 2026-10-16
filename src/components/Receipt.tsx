import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Kot, Order } from "@/lib/types";
import { formatINR, upiLink } from "@/lib/billing";
import { useRestaurantSettings } from "@/components/AppShell";

const ORDER_TYPE_LABEL: Record<Order["orderType"], string> = {
  "dine-in": "Dine-in",
  takeaway: "Takeaway",
  delivery: "Delivery",
  swiggy: "Swiggy",
  zomato: "Zomato",
};

function Rule() {
  return <div className="my-2 border-t border-dashed border-foreground/40" />;
}

export function Receipt({ order, mode = "bill", kot }: { order: Order; mode?: "kot" | "bill"; kot?: Kot }) {
  const settings = useRestaurantSettings();
  const [qr, setQr] = useState("");
  const showQr = mode === "bill" && !!settings.upiVpa && order.status !== "void";

  useEffect(() => {
    if (!showQr || !settings.upiVpa) { setQr(""); return; }
    QRCode.toDataURL(
      upiLink({ vpa: settings.upiVpa, name: settings.name || "Restaurant", amount: order.total, billNo: order.billNo }),
      { width: 160, margin: 0 },
    ).then(setQr).catch(() => setQr(""));
  }, [order.total, order.billNo, showQr, settings.upiVpa, settings.name]);

  const priceOf = (itemId: string | undefined) => order.lines.find((line) => line.itemId === itemId)?.price ?? 0;
  const table = kot?.tableLabel ?? kot?.tableId ?? order.tableLabel ?? order.tableId;

  if (mode === "kot") {
    return (
      <div id="kot-print" className="mx-auto w-full max-w-xs bg-white p-4 font-sans text-sm text-black">
        <div className="text-center">
          <div className="text-xs">Kitchen order ticket</div>
          <div className="text-2xl font-extrabold">{table ? `Table ${table}` : ORDER_TYPE_LABEL[kot?.orderType ?? order.orderType]}</div>
          {kot ? <div className="text-base font-bold">{kot.station}</div> : null}
        </div>
        <Rule />
        <div className="flex justify-between text-xs"><span>{order.billNo}</span><span>{new Date(kot?.createdAt ?? order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <Rule />
        <ul className="space-y-1">
          {(kot ? kot.lines : order.lines).map((l, i) => (
            <li key={i}>
              <span className="text-base font-bold">{l.qty} × {l.name}</span>
              {l.note ? <span className="block pl-5 text-xs">Note: {l.note}</span> : null}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div id="receipt-print" className="mx-auto w-full max-w-xs bg-white p-4 font-sans text-xs text-black">
      <div className="text-center">
        <div className="text-base font-extrabold">{settings.name || "Restaurant"}</div>
        {settings.legalName && settings.legalName !== settings.name ? <div>{settings.legalName}</div> : null}
        {settings.address ? <div className="whitespace-pre-line">{settings.address}</div> : null}
        {settings.phone ? <div>Phone {settings.phone}</div> : null}
        {settings.gstin ? <div>GSTIN {settings.gstin}</div> : null}
        {settings.fssai ? <div>FSSAI Lic. {settings.fssai}</div> : null}
        <div className="mt-1 font-bold">{order.status === "void" ? "Void bill" : settings.gstin ? "Tax invoice" : "Bill"}</div>
        {order.status === "void" && order.voidReason ? <div>{order.voidReason}</div> : null}
      </div>
      <Rule />
      <div className="flex justify-between"><span>Bill {order.billNo}</span><span>{new Date(order.createdAt).toLocaleDateString("en-IN")}</span></div>
      <div className="flex justify-between">
        <span>{ORDER_TYPE_LABEL[order.orderType]}{table ? `, table ${table}` : ""}</span>
        <span>{new Date(order.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
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
              <td className="text-right">{formatINR(priceOf(l.itemId) * l.qty)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Rule />
      <div className="space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatINR(order.subtotal)}</span></div>
        {order.discountAmt > 0 ? <div className="flex justify-between"><span>Discount ({order.discountPct}%)</span><span>-{formatINR(order.discountAmt)}</span></div> : null}
        <div className="flex justify-between"><span>CGST</span><span>{formatINR(order.cgst)}</span></div>
        <div className="flex justify-between"><span>SGST</span><span>{formatINR(order.sgst)}</span></div>
        <div className="flex justify-between"><span>Round off</span><span>{formatINR(order.roundOff)}</span></div>
        <div className="flex justify-between pt-1 text-sm font-extrabold"><span>Total</span><span>{formatINR(order.total, 0)}</span></div>
      </div>
      {order.payments.length ? <>
        <Rule />
        <div className="flex justify-between"><span>Paid by</span><span>{order.payments.map((p) => p.mode.toUpperCase()).join(" + ")}</span></div>
      </> : null}
      {showQr && qr ? (
        <div className="mt-3 text-center">
          <img src={qr} alt={`UPI QR to pay ${formatINR(order.total, 0)}`} width={120} height={120} className="mx-auto" />
          <div className="mt-1">Scan to pay {formatINR(order.total, 0)} by UPI</div>
        </div>
      ) : null}
      <div className="mt-3 text-center">
        <div>{settings.billFooter || "Thank you! Visit again."}</div>
        <div className="mt-1 text-[10px] text-black/60">Billed with XTSY POS</div>
      </div>
    </div>
  );
}
