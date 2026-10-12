import { useState, useCallback } from "react";
import { toast } from "sonner";
import type { CartLine, MenuItem, Order, OrderType, PaymentMode } from "./types";
import { computeTotals, billNumber } from "./billing";
import { getDb, nextSeq } from "./db";

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [tableId, setTableId] = useState<string | undefined>();
  const [discountPct, setDiscountPct] = useState(0);

  const addItem = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const i = prev.findIndex((l) => l.itemId === item.id);
      if (i >= 0) {
        const next = [...prev];
        next[i] = { ...next[i]!, qty: next[i]!.qty + 1 };
        return next;
      }
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1, veg: item.veg, gstRate: item.gstRate, station: item.station }];
    });
  }, []);

  const setQty = useCallback((itemId: string, qty: number) => {
    setLines((prev) => (qty <= 0 ? prev.filter((l) => l.itemId !== itemId) : prev.map((l) => (l.itemId === itemId ? { ...l, qty } : l))));
  }, []);

  const setNote = useCallback((itemId: string, note: string) => {
    setLines((prev) => prev.map((l) => (l.itemId === itemId ? { ...l, note } : l)));
  }, []);

  const clear = useCallback(() => {
    setLines([]);
    setDiscountPct(0);
    setTableId(undefined);
  }, []);

  const totals = computeTotals(lines, discountPct);

  const settle = useCallback(
    async (mode: PaymentMode): Promise<Order | null> => {
      if (lines.length === 0) return null;
      const seq = await nextSeq();
      const t = computeTotals(lines, discountPct);
      const order: Order = {
        billNo: billNumber(seq, new Date()),
        orderType,
        tableId,
        lines,
        subtotal: t.subtotal,
        discountPct,
        discountAmt: t.discountAmt,
        cgst: t.cgst,
        sgst: t.sgst,
        roundOff: t.roundOff,
        total: t.total,
        payments: [{ mode, amount: t.total }],
        status: "settled",
        createdAt: Date.now(),
        synced: false,
      };
      const db = getDb();
      const id = await db.orders.add(order);
      order.id = id as number;
      // Auto-split KOTs by station
      const byStation = new Map<string, CartLine[]>();
      for (const l of lines) {
        const arr = byStation.get(l.station) ?? [];
        arr.push(l);
        byStation.set(l.station, arr);
      }
      for (const [station, sl] of byStation) {
        await db.kots.add({
          orderId: order.id,
          billNo: order.billNo,
          station,
          lines: sl.map((l) => ({ name: l.name, qty: l.qty, note: l.note })),
          status: "new",
          createdAt: Date.now(),
        });
      }
      if (tableId) await db.restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined });
      clear();
      toast.success(`Bill ${order.billNo} settled`);
      return order;
    },
    [lines, discountPct, orderType, tableId, clear],
  );

  return { lines, orderType, setOrderType, tableId, setTableId, discountPct, setDiscountPct, addItem, setQty, setNote, clear, totals, settle };
}
