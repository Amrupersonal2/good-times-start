import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import type { CartLine, Kot, MenuItem, Order, OrderType, PaymentMode } from "./types";
import { computeTotals, billNumber } from "./billing";
import { getDb, getDeviceCode, markDirty, nextSeq } from "./db";
import { accumulateSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";
import { mergeSentLines, newUid, sameLines, type RecordKind } from "./sync-core";
import { applyLocalStockSale } from "./cloud-sync";
import { buildLine, priceFor } from "./menu-logic";
import { latestHeldOrder } from "./table-actions";

function kotGroups(lines: CartLine[]) {
  const groups = new Map<string, CartLine[]>();
  for (const line of lines) groups.set(line.station, [...(groups.get(line.station) ?? []), line]);
  return groups;
}

async function tableLabelOf(tableId: string | undefined): Promise<string | undefined> {
  if (!tableId) return undefined;
  return (await getDb().restTables.get(tableId))?.label ?? tableId;
}

async function orderByUid(uid: string): Promise<Order | null> {
  return (await getDb().orders.where("uid").equals(uid).first()) ?? null;
}

async function newBillNumber(at: Date): Promise<string> {
  return billNumber(await nextSeq(), at, await getDeviceCode());
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
    const openOrder = id ? await latestHeldOrder(id) : null;
    // A table opened on this device for the first time shows what other devices already sent.
    setLines(draft?.lines.length ? draft.lines : openOrder?.lines ?? []);
    setDiscountPct(draft?.discountPct ?? openOrder?.discountPct ?? 0);
    setActiveOrder(openOrder);
    if (id) setOrderType("dine-in");
    setDraftReady(true);
  }, []);

  useEffect(() => { void restoreDraft(initialTableId); }, [initialTableId, restoreDraft]);

  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      void getDb().drafts.put({ id: tableId ?? "walkin", tableId, lines, discountPct, updatedAt: Date.now() });
      if (tableId && lines.length) {
        const total = computeTotals(lines, discountPct).total;
        void getDb().restTables.get(tableId).then(async (table) => {
          if (!table || (table.status === "occupied" && table.runningTotal === total)) return;
          await getDb().restTables.update(tableId, { status: "occupied", runningTotal: total, since: table.since ?? Date.now() });
          await markDirty(["table", tableId]);
        });
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [draftReady, tableId, lines, discountPct]);

  // Follow the shared copy of the running order: another device may add items or settle it.
  const activeUid = activeOrder?.uid;
  const liveOrder = useLiveQuery(
    async () => (tableId ? latestHeldOrder(tableId) : activeUid ? orderByUid(activeUid) : null),
    [tableId, activeUid],
  );
  useEffect(() => {
    if (!draftReady || liveOrder === undefined) return;
    if (liveOrder === null || liveOrder.status !== "held") {
      if (!activeOrder) return;
      // Settled or voided on another device.
      setActiveOrder(null);
      setLines([]);
      setDiscountPct(0);
      void getDb().drafts.delete(tableId ?? "walkin");
      return;
    }
    if (activeOrder && liveOrder.uid === activeOrder.uid && sameLines(liveOrder.lines, activeOrder.lines) &&
      JSON.stringify(liveOrder.kotSubmittedQty ?? {}) === JSON.stringify(activeOrder.kotSubmittedQty ?? {})) return;
    // Items this device hasn't sent yet stay on top of whatever the shared order now holds.
    const pending = unsentKitchenLines(lines, activeOrder?.kotSubmittedQty ?? {});
    const next = mergeSentLines(liveOrder.lines, pending);
    setActiveOrder(liveOrder);
    if (!sameLines(next, lines)) setLines(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react only to changes in the shared order
  }, [liveOrder, draftReady]);

  /** Add one of a dish, with an optional portion and add-ons, priced for the current order type. */
  const addItem = useCallback((item: MenuItem, variantId?: string, addonIds: string[] = []) => {
    const line = buildLine(item, orderType, variantId, addonIds);
    setLines((prev) => {
      const index = prev.findIndex((existing) => existing.itemId === line.itemId);
      if (index >= 0) {
        const next = [...prev];
        const current = next[index];
        if (current) next[index] = { ...current, qty: current.qty + 1 };
        return next;
      }
      return [...prev, line];
    });
  }, [orderType]);

  /** Switching to takeaway, delivery or an aggregator reprices plain dishes not yet sent to the kitchen. */
  const changeOrderType = useCallback((next: OrderType) => {
    setOrderType(next);
    if (activeOrder) return;
    void getDb().menu.toArray().then((menu) => {
      const byId = new Map(menu.map((item) => [item.id, item]));
      setLines((prev) => prev.map((line) => {
        const item = line.menuItemId ? undefined : byId.get(line.itemId);
        return item ? { ...line, price: priceFor(item, next) } : line;
      }));
    });
  }, [activeOrder]);

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

  /** Start a fresh bill. A table with items already in the kitchen keeps its running order. */
  const clear = useCallback(() => {
    void getDb().drafts.delete(tableId ?? "walkin");
    if (tableId && !activeOrder) {
      void getDb().restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined })
        .then(() => markDirty(["table", tableId]));
    }
    setLines([]);
    setDiscountPct(0);
    setTableIdState(undefined);
    setActiveOrder(null);
    setDraftReady(true);
  }, [activeOrder, tableId]);

  const totals = computeTotals(lines, discountPct);
  const submitted = activeOrder?.kotSubmittedQty ?? {};
  const pendingKitchenLines = unsentKitchenLines(lines, submitted);

  const sendKitchen = useCallback(async (): Promise<Kot[]> => {
    if (!lines.length || !pendingKitchenLines.length) return [];
    const db = getDb();
    const now = Date.now();
    // Re-read the shared order: another device may have sent items for this table meanwhile.
    const latest = activeOrder?.uid ? await orderByUid(activeOrder.uid) : tableId ? await latestHeldOrder(tableId) : null;
    const base = latest && latest.status === "held" ? latest : null;
    const merged = base ? mergeSentLines(base.lines, pendingKitchenLines) : lines;
    const t = computeTotals(merged, discountPct);
    const tableLabel = await tableLabelOf(tableId);
    const order: Order = base
      ? { ...base, lines: merged, ...t, discountPct, status: "held" }
      : {
          uid: newUid(), billNo: await newBillNumber(new Date(now)), orderType, tableId, tableLabel, lines: merged,
          subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt, cgst: t.cgst, sgst: t.sgst,
          roundOff: t.roundOff, total: t.total, payments: [], status: "held", createdAt: now, synced: false,
        };
    const orderUid = order.uid ?? newUid();
    order.uid = orderUid;
    const nextSubmitted = accumulateSubmittedQuantities(base?.kotSubmittedQty ?? {}, pendingKitchenLines);
    const saved: Order = { ...order, kotSubmittedQty: nextSubmitted, synced: false };

    let kots: Kot[] = [];
    await db.transaction("rw", db.orders, db.kots, async () => {
      const id = saved.id ?? Number(await db.orders.add(saved));
      saved.id = id;
      await db.orders.put(saved);
      kots = Array.from(kotGroups(pendingKitchenLines), ([station, stationLines]): Kot => ({
        uid: newUid(), orderId: id, orderUid, billNo: saved.billNo, station, tableId: saved.tableId, tableLabel: saved.tableLabel ?? tableLabel, orderType,
        lines: stationLines.map((line) => ({ itemId: line.itemId, name: line.name, qty: line.qty, note: line.note })),
        status: "new", createdAt: now,
      }));
      await db.kots.bulkAdd(kots);
    });
    await markDirty(["order", orderUid], ...kots.map((kot): [RecordKind, string] => ["kot", kot.uid ?? ""]));
    setActiveOrder(saved);
    setLines(merged);
    toast.success(`${kots.length} kitchen ticket${kots.length === 1 ? "" : "s"} sent`);
    return kots;
  }, [activeOrder, discountPct, lines, orderType, pendingKitchenLines, tableId]);

  const settle = useCallback(async (mode: PaymentMode): Promise<Order | null> => {
    if (!lines.length) return null;
    if (unsentKitchenLines(lines, activeOrder?.kotSubmittedQty).length) {
      toast.error("Send the kitchen ticket before settling this bill");
      return null;
    }
    const latest = activeOrder?.uid ? await orderByUid(activeOrder.uid) : null;
    if (latest && latest.status !== "held") {
      toast.error(`Bill ${latest.billNo} was already ${latest.status === "settled" ? "settled" : "voided"} on another device`);
      return null;
    }
    const t = computeTotals(lines, discountPct);
    const order: Order = {
      ...(latest ?? ({} as Order)),
      uid: latest?.uid ?? newUid(),
      billNo: latest?.billNo ?? await newBillNumber(new Date()),
      orderType, tableId, tableLabel: latest?.tableLabel ?? await tableLabelOf(tableId), lines, subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt,
      cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total,
      payments: [{ mode, amount: t.total }], status: "settled", createdAt: latest?.createdAt ?? Date.now(), synced: false,
    };
    const db = getDb();
    const id = order.id ? await db.orders.put(order) : Number(await db.orders.add(order));
    order.id = id;
    const changes: [RecordKind, string][] = [["order", order.uid ?? ""]];
    if (tableId) {
      await db.restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined });
      changes.push(["table", tableId]);
    }
    await db.drafts.delete(tableId ?? "walkin");
    await markDirty(...changes);
    await applyLocalStockSale(lines);
    setLines([]);
    setDiscountPct(0);
    setActiveOrder(null);
    setTableIdState(undefined);
    toast.success(`Bill ${order.billNo} settled`);
    return order;
  }, [activeOrder, discountPct, lines, orderType, tableId]);

  return { lines, orderType, setOrderType: changeOrderType, tableId, setTableId, discountPct, setDiscountPct, addItem, setQty, setNote, clear, totals, settle, sendKitchen, pendingKitchenLines, activeOrder };
}
