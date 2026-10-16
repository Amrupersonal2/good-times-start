import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { CartLine, Kot, MenuItem, Order, OrderType, PaymentMode } from "./types";
import { computeTotals, billNumber } from "./billing";
import { getDb, nextSeq } from "./db";
import { accumulateSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";

function kotGroups(lines: CartLine[]) {
  const groups = new Map<string, CartLine[]>();
  for (const line of lines) groups.set(line.station, [...(groups.get(line.station) ?? []), line]);
  return groups;
}

export function useCart(initialTableId?: string) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [orderType, setOrderType] = useState<OrderType>("dine-in");
  const [tableId, setTableIdState] = useState<string | undefined>(initialTableId);
  const [discountPct, setDiscountPct] = useState(0);
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [draftReady, setDraftReady] = useState(false);

  const restoreDraft = useCallback(async (id: string | undefined) => {
    setDraftReady(false);
    setActiveOrder(null);
    const draft = await getDb().drafts.get(id ?? "walkin");
    setLines(draft?.lines ?? []);
    setDiscountPct(draft?.discountPct ?? 0);
    const openOrder = id ? await getDb().orders.where("tableId").equals(id).filter((o) => o.status === "held").first() : undefined;
    setActiveOrder(openOrder ?? null);
    setDraftReady(true);
  }, []);

  useEffect(() => { void restoreDraft(initialTableId); }, [initialTableId, restoreDraft]);
  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      void getDb().drafts.put({ id: tableId ?? "walkin", tableId, lines, discountPct, updatedAt: Date.now() });
      if (tableId && lines.length) {
        void getDb().restTables.update(tableId, { status: "occupied", runningTotal: computeTotals(lines, discountPct).total, since: Date.now() });
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [draftReady, tableId, lines, discountPct]);

  const addItem = useCallback((item: MenuItem) => {
    setLines((prev) => {
      const index = prev.findIndex((line) => line.itemId === item.id);
      if (index >= 0) {
        const next = [...prev];
        const current = next[index];
        if (current) next[index] = { ...current, qty: current.qty + 1 };
        return next;
      }
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1, veg: item.veg, gstRate: item.gstRate, station: item.station }];
    });
  }, []);

  const setQty = useCallback((itemId: string, qty: number) => {
    setLines((prev) => (qty <= 0 ? prev.filter((line) => line.itemId !== itemId) : prev.map((line) => (line.itemId === itemId ? { ...line, qty } : line))));
  }, []);

  const setNote = useCallback((itemId: string, note: string) => {
    setLines((prev) => prev.map((line) => (line.itemId === itemId ? { ...line, note } : line)));
  }, []);

  const setTableId = useCallback((id: string | undefined) => {
    if (id === tableId) return;
    setTableIdState(id);
    if (id) setOrderType("dine-in");
    void restoreDraft(id);
  }, [restoreDraft, tableId]);

  const clear = useCallback(() => {
    setLines([]);
    setDiscountPct(0);
    setTableIdState(undefined);
    setActiveOrder(null);
    setDraftReady(true);
    void getDb().drafts.delete(tableId ?? "walkin");
    if (tableId) void getDb().restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined });
  }, [tableId]);

  const totals = computeTotals(lines, discountPct);
  const submitted = activeOrder?.kotSubmittedQty ?? {};
  const pendingKitchenLines = unsentKitchenLines(lines, submitted);

  const sendKitchen = useCallback(async (): Promise<Kot[]> => {
    if (!lines.length || !pendingKitchenLines.length) return [];
    const db = getDb();
    const now = Date.now();
    const updatedTotals = computeTotals(lines, discountPct);
    const order: Order = activeOrder
      ? { ...activeOrder, lines, ...updatedTotals, discountPct, status: "held", createdAt: activeOrder.createdAt }
      : {
          billNo: billNumber(await nextSeq(), new Date(now)), orderType, tableId, lines,
          subtotal: updatedTotals.subtotal, discountPct, discountAmt: updatedTotals.discountAmt,
          cgst: updatedTotals.cgst, sgst: updatedTotals.sgst, roundOff: updatedTotals.roundOff,
          total: updatedTotals.total, payments: [], status: "held", createdAt: now, synced: false,
        };
    const id = order.id ?? Number(await db.orders.add(order));
    order.id = id;
    const nextSubmitted = accumulateSubmittedQuantities(submitted, pendingKitchenLines);
    const kots: Kot[] = Array.from(kotGroups(pendingKitchenLines), ([station, stationLines]) => ({
      orderId: id, billNo: order.billNo, station,
      lines: stationLines.map((line) => ({ itemId: line.itemId, name: line.name, qty: line.qty, note: line.note })),
      status: "new", createdAt: now,
    }));
    await db.transaction("rw", db.orders, db.kots, async () => {
      await db.orders.put({ ...order, kotSubmittedQty: nextSubmitted });
      await db.kots.bulkAdd(kots);
    });
    setActiveOrder({ ...order, kotSubmittedQty: nextSubmitted });
    toast.success(`${kots.length} kitchen ticket${kots.length === 1 ? "" : "s"} sent`);
    return kots;
  }, [activeOrder, discountPct, lines, orderType, pendingKitchenLines, submitted, tableId]);

  const settle = useCallback(async (mode: PaymentMode): Promise<Order | null> => {
    if (!lines.length) return null;
    if (unsentKitchenLines(lines, activeOrder?.kotSubmittedQty).length) {
      toast.error("Send the kitchen ticket before settling this bill");
      return null;
    }
    const t = computeTotals(lines, discountPct);
    const order: Order = {
      ...(activeOrder ?? {} as Order),
      billNo: activeOrder?.billNo ?? billNumber(await nextSeq(), new Date()),
      orderType, tableId, lines, subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt,
      cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total,
      payments: [{ mode, amount: t.total }], status: "settled", createdAt: activeOrder?.createdAt ?? Date.now(), synced: false,
    };
    const db = getDb();
    const id = order.id ? await db.orders.put(order) : Number(await db.orders.add(order));
    order.id = id;
    if (tableId) await db.restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined });
    await db.drafts.delete(tableId ?? "walkin");
    setLines([]);
    setDiscountPct(0);
    setActiveOrder(null);
    setTableIdState(undefined);
    toast.success(`Bill ${order.billNo} settled`);
    return order;
  }, [activeOrder, discountPct, lines, orderType, tableId]);

  return { lines, orderType, setOrderType, tableId, setTableId, discountPct, setDiscountPct, addItem, setQty, setNote, clear, totals, settle, sendKitchen, pendingKitchenLines, activeOrder };
}