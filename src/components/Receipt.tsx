import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Kot, Order } from "@/lib/types";
import { formatINR, upiLink } from "@/lib/billing";
import { RESTAURANT } from "@/lib/seed";
import logo from "@/assets/logo.png";

export function Receipt({ order, mode = "bill", kot }: { order: Order; mode?: "kot" | "bill"; kot?: Kot }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    if (mode === "kot") return;
    QRCode.toDataURL(
      upiLink({ vpa: RESTAURANT.upiVpa, name: RESTAURANT.name, amount: order.total, billNo: order.billNo }),
      { width: 160, margin: 0 },
    ).then(setQr).catch(() => {});
  }, [order, mode]);

  return (
    <div id={mode === "kot" ? "kot-print" : "receipt-print"} className="mx-auto w-full max-w-xs bg-card p-4 font-mono text-xs text-foreground">
      <div className="text-center">
        <img src={logo} alt="Restro POS logo" width={40} height={40} className="mx-auto mb-1" />
        <div className="text-sm font-bold uppercase">{RESTAURANT.name}</div>
        <div>{mode === "kot" ? "KITCHEN ORDER TICKET" : RESTAURANT.address}</div>
        {mode === "kot" ? <div className="mt-1 text-sm font-bold">{order.tableId ? `TABLE ${order.tableId}` : order.orderType.toUpperCase()} · {order.billNo}</div> : null}
        {mode === "kot" && kot ? <div className="mt-1 text-sm font-bold">{kot.station}</div> : null}
        <div>Ph: {RESTAURANT.phone}</div>
        <div>GSTIN: {RESTAURANT.gstin} · FSSAI: {RESTAURANT.fssai}</div>
      </div>
      {mode === "bill" ? <div className="my-2 border-t border-dashed border-border" /> : null}
      {mode === "kot" ? <div className="my-2 border-t border-dashed border-border" /> : null}
      <div className="flex justify-between">
        <span>{order.billNo}</span>
        <span>{new Date(order.createdAt).toLocaleString("en-IN")}</span>
      </div>
      <div className="capitalize">Type: {order.orderType}{order.tableId ? ` · Table ${order.tableId}` : ""}</div>
      {mode === "bill" ? <div className="my-2 border-t border-dashed border-border" /> : null}
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th>Item</th><th className="text-right">Qty</th><th className="text-right">Amt</th>
          </tr>
        </thead>
        <tbody>
          {(mode === "kot" && kot ? kot.lines : order.lines).map((l, i) => (
            <tr key={i}>
              <td className="pr-1">{l.name}{l.note ? ` (${l.note})` : ""}</td>
              <td className="text-right">{l.qty}</td>
              {mode === "bill" ? <td className="text-right">{formatINR(order.lines[i]?.price ? order.lines[i].price * l.qty : 0, 0)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      {mode === "bill" ? <div className="my-2 border-t border-dashed border-border" /> : null}
      {mode === "bill" ? <div className="space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatINR(order.subtotal)}</span></div>
        {order.discountAmt > 0 && (
          <div className="flex justify-between"><span>Discount ({order.discountPct}%)</span><span>-{formatINR(order.discountAmt)}</span></div>
        )}
        <div className="flex justify-between"><span>CGST</span><span>{formatINR(order.cgst)}</span></div>
        <div className="flex justify-between"><span>SGST</span><span>{formatINR(order.sgst)}</span></div>
        <div className="flex justify-between"><span>Round off</span><span>{formatINR(order.roundOff)}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{formatINR(order.total, 0)}</span></div>
      </div> : null}
      <div className="my-2 border-t border-dashed border-border" />
      <div className="flex justify-between">
        <span>Paid via</span>
        <span className="uppercase">{order.payments.map((p) => p.mode).join(" + ")}</span>
      </div>
      {mode === "bill" && qr && (
        <div className="mt-3 text-center">
          <img src={qr} alt={`UPI QR to pay ${formatINR(order.total, 0)}`} width={120} height={120} className="mx-auto" />
          <div className="mt-1">Scan to pay {formatINR(order.total, 0)} via UPI</div>
        </div>
      )}
      {mode === "bill" ? <div className="mt-3 text-center">
        <div>Thank you! Visit again.</div>
        <div className="mt-1 text-[10px] text-muted-foreground">Powered by Restro POS by XTSY</div>
      </div> : null}
    </div>
  );
}
