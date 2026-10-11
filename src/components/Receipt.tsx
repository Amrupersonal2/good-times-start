import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Order } from "@/lib/types";
import { formatINR, upiLink } from "@/lib/billing";
import { RESTAURANT } from "@/lib/seed";
import logo from "@/assets/logo.png";

export function Receipt({ order }: { order: Order }) {
  const [qr, setQr] = useState("");
  useEffect(() => {
    QRCode.toDataURL(
      upiLink({ vpa: RESTAURANT.upiVpa, name: RESTAURANT.name, amount: order.total, billNo: order.billNo }),
      { width: 160, margin: 0 },
    ).then(setQr).catch(() => {});
  }, [order]);

  return (
    <div id="receipt-print" className="mx-auto w-full max-w-xs bg-card p-4 font-mono text-xs text-foreground">
      <div className="text-center">
        <img src={logo} alt="Restro POS logo" width={40} height={40} className="mx-auto mb-1" />
        <div className="text-sm font-bold uppercase">{RESTAURANT.name}</div>
        <div>{RESTAURANT.address}</div>
        <div>Ph: {RESTAURANT.phone}</div>
        <div>GSTIN: {RESTAURANT.gstin} · FSSAI: {RESTAURANT.fssai}</div>
      </div>
      <div className="my-2 border-t border-dashed border-border" />
      <div className="flex justify-between">
        <span>{order.billNo}</span>
        <span>{new Date(order.createdAt).toLocaleString("en-IN")}</span>
      </div>
      <div className="capitalize">Type: {order.orderType}{order.tableId ? ` · Table ${order.tableId}` : ""}</div>
      <div className="my-2 border-t border-dashed border-border" />
      <table className="w-full">
        <thead>
          <tr className="text-left">
            <th>Item</th><th className="text-right">Qty</th><th className="text-right">Amt</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td className="pr-1">{l.name}{l.note ? ` (${l.note})` : ""}</td>
              <td className="text-right">{l.qty}</td>
              <td className="text-right">{formatINR(l.price * l.qty, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="my-2 border-t border-dashed border-border" />
      <div className="space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatINR(order.subtotal)}</span></div>
        {order.discountAmt > 0 && (
          <div className="flex justify-between"><span>Discount ({order.discountPct}%)</span><span>-{formatINR(order.discountAmt)}</span></div>
        )}
        <div className="flex justify-between"><span>CGST</span><span>{formatINR(order.cgst)}</span></div>
        <div className="flex justify-between"><span>SGST</span><span>{formatINR(order.sgst)}</span></div>
        <div className="flex justify-between"><span>Round off</span><span>{formatINR(order.roundOff)}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{formatINR(order.total, 0)}</span></div>
      </div>
      <div className="my-2 border-t border-dashed border-border" />
      <div className="flex justify-between">
        <span>Paid via</span>
        <span className="uppercase">{order.payments.map((p) => p.mode).join(" + ")}</span>
      </div>
      {qr && (
        <div className="mt-3 text-center">
          <img src={qr} alt={`UPI QR to pay ${formatINR(order.total, 0)}`} width={120} height={120} className="mx-auto" />
          <div className="mt-1">Scan to pay {formatINR(order.total, 0)} via UPI</div>
        </div>
      )}
      <div className="mt-3 text-center">
        <div>Thank you! Visit again.</div>
        <div className="mt-1 text-[10px] text-muted-foreground">Powered by Restro POS by XTSY</div>
      </div>
    </div>
  );
}
