import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { toast } from "sonner";
import type { CartLine, Kot, MenuItem, Order, OrderType, PaymentMode } from "./types";
import { computeTotals, billNumber } from "./billing";
import { getDb, getDeviceCode, markDirty, nextSeq } from "./db";
import { accumulateSubmittedQuantities, cancelledKitchenLines, removeCancelled, reopenedLines, subtractSubmittedQuantities, unsentKitchenLines } from "./kitchen-order";
import { mergeSentLines, newUid, sameLines, type RecordKind } from "./sync-core";
import { applyLocalStockSale } from "./cloud-sync";
import { buildLine, priceFor } from "./menu-logic";
import { latestHeldOrder } from "./table-actions";
import { settledPayments, type Payment } from "./payment-logic";
import { splitLines } from "./bill-splitting";
import { rememberCustomer } from "./customer-actions";
import { withCustomerId } from "./customer-logic";
import { useRestaurantSettings } from "./use-settings";
import { taxOptionsFor } from "./billing-config";
import type { TaxOptions } from "./billing";
import { useStaff } from "./auth-context";
import { getDeviceId } from "./terminal-actions";
import { heldTable, holdByOther, withoutHold, type HeldBy } from "./table-hold";

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
  const [serviceChargePct, setServiceChargePct] = useState(0);
  const [customer, setCustomer] = useState<{ name?: string; phone?: string; gstin?: string }>({});
  const [activeOrder, setActiveOrder] = useState<Order | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const settings = useRestaurantSettings();
  const { user } = useStaff();
  const staffName = user?.displayName ?? "";
  const [myDevice, setMyDevice] = useState("");
  useEffect(() => { void getDeviceId().then(setMyDevice).catch(() => setMyDevice("")); }, []);
  // A running bill keeps the tax rules it started with; new bills follow current settings.
  const tax: TaxOptions = activeOrder?.tax ?? taxOptionsFor(settings, orderType);
  const taxKey = JSON.stringify(tax);

  const restoreDraft = useCallback(async (id: string | undefined) => {
    setDraftReady(false);
    setActiveOrder(null);
    const stored = await getDb().drafts.get(id ?? "walkin");
    const openOrder = id ? await latestHeldOrder(id) : null;
    // A draft built on a bill that has since been settled, cancelled or replaced elsewhere is stale:
    // its "sent" items would look unsent and could reach the kitchen twice.
    const draft = stored && (!stored.orderUid || stored.orderUid === openOrder?.uid) ? stored : undefined;
    if (stored && !draft) void getDb().drafts.delete(stored.id);
    // A table opened on this device for the first time shows what other devices already sent.
    // Start from the shared bill: other devices may have added to it since this draft was saved.
    setLines(draft?.lines.length
      ? (openOrder ? reopenedLines(draft.lines, draft.sentQty, openOrder.lines, openOrder.kotSubmittedQty) : draft.lines)
      : openOrder?.lines ?? []);
    setDiscountPct(draft?.discountPct ?? openOrder?.discountPct ?? 0);
    setServiceChargePct(openOrder?.serviceChargePct ?? 0);
    setCustomer(openOrder?.customer ?? {});
    setActiveOrder(openOrder);
    if (id) setOrderType("dine-in");
    setDraftReady(true);
  }, []);

  useEffect(() => { void restoreDraft(initialTableId); }, [initialTableId, restoreDraft]);

  useEffect(() => {
    if (!draftReady) return;
    const timeout = window.setTimeout(() => {
      void getDb().drafts.put({ id: tableId ?? "walkin", tableId, orderUid: activeOrder?.uid, sentQty: activeOrder?.kotSubmittedQty, lines, discountPct, updatedAt: Date.now() });
      if (tableId && lines.length) {
        const total = computeTotals(lines, discountPct, serviceChargePct, tax).total;
        void getDb().restTables.get(tableId).then(async (table) => {
          if (!table) return;
          const now = Date.now();
          // Someone else is taking this table's first order: leave their hold alone.
          if (holdByOther(table, myDevice, !!activeOrder, now)) return;
          let next: typeof table;
          if (activeOrder) next = withoutHold({ ...table, status: table.status === "billed" ? "billed" : "occupied", runningTotal: total, since: table.since ?? now });
          else if (myDevice) next = heldTable(table, myDevice, staffName, total, table.heldDevice === myDevice && table.runningTotal === total ? table.heldAt ?? now : now);
          else next = { ...table, status: "occupied", runningTotal: total, since: table.since ?? now };
          if (JSON.stringify(next) === JSON.stringify(table)) return;
          await getDb().restTables.put(next);
          await markDirty(["table", tableId]);
        });
      } else if (tableId && !activeOrder && myDevice) {
        // The first order was emptied before reaching the kitchen: free the table again.
        void getDb().restTables.get(tableId).then(async (table) => {
          if (!table || table.heldDevice !== myDevice || table.status !== "occupied") return;
          await getDb().restTables.put({ ...withoutHold(table), status: "free", runningTotal: 0, since: undefined });
          await markDirty(["table", tableId]);
        });
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tax is tracked by taxKey
  }, [draftReady, tableId, lines, discountPct, serviceChargePct, activeOrder?.uid, taxKey, myDevice, staffName]);

  // Who else is taking this table's first order, if anyone.
  const liveTable = useLiveQuery(async () => (tableId ? getDb().restTables.get(tableId) : undefined), [tableId]);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setClock(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  const hold: HeldBy | null = holdByOther(liveTable, myDevice, !!activeOrder, clock);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  /** Take over a table someone else is holding (their unsent order stays on their device). */
  const takeOver = useCallback(async () => {
    if (!tableId || !myDevice) return;
    const table = await getDb().restTables.get(tableId);
    if (!table) return;
    await getDb().restTables.put(heldTable(table, myDevice, staffName, table.runningTotal, Date.now()));
    await markDirty(["table", tableId]);
    setClock(Date.now());
  }, [tableId, myDevice, staffName]);

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
    const held = holdRef.current;
    if (held) { toast.error(`${held.by} is taking this table's order. It opens for everyone once it reaches the kitchen.`); return; }
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

  /** Put back items marked for cancellation before the cancel ticket goes out. */
  const restoreLine = useCallback((line: CartLine) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.itemId === line.itemId);
      return existing ? prev.map((l) => (l.itemId === line.itemId ? { ...l, qty: l.qty + line.qty } : l)) : [...prev, { ...line }];
    });
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

  /** Open a running bill that has no table (a pickup or takeaway order) to add to it or settle it. */
  const openOrder = useCallback((order: Order) => {
    // A table's QR bill opens on its own, like a pickup order, so it never mixes with the staff bill.
    if (order.tableId && order.source !== "qr") { setTableId(order.tableId); return; }
    setTableIdState(undefined);
    setActiveOrder(order);
    setLines(order.lines);
    setDiscountPct(order.discountPct);
    setServiceChargePct(order.serviceChargePct ?? 0);
    setCustomer(order.customer ?? {});
    setOrderType(order.orderType);
    setDraftReady(true);
  }, [setTableId]);

  /** Start a fresh bill. A table with items already in the kitchen keeps its running order. */
  const clear = useCallback(() => {
    void getDb().drafts.delete(tableId ?? "walkin");
    if (tableId && !activeOrder) {
      void getDb().restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined, heldBy: undefined, heldDevice: undefined, heldAt: undefined })
        .then(() => markDirty(["table", tableId]));
    }
    setLines([]);
    setDiscountPct(0);
    setServiceChargePct(0);
    setCustomer({});
    setTableIdState(undefined);
    setActiveOrder(null);
    setDraftReady(true);
  }, [activeOrder, tableId]);

  const totals = computeTotals(lines, discountPct, serviceChargePct, tax);
  const submitted = activeOrder?.kotSubmittedQty ?? {};
  const pendingKitchenLines = unsentKitchenLines(lines, submitted);
  const pendingCancelLines = cancelledKitchenLines(lines, submitted, activeOrder?.lines ?? []);

  /** Shared bookkeeping once a bill leaves the table: free the table, forget the draft, reset the screen. */
  const finishTable = useCallback(async (changes: [RecordKind, string][]) => {
    const db = getDb();
    if (tableId) {
      await db.restTables.update(tableId, { status: "free", runningTotal: 0, since: undefined, heldBy: undefined, heldDevice: undefined, heldAt: undefined });
      changes.push(["table", tableId]);
    }
    await db.drafts.delete(tableId ?? "walkin");
    await markDirty(...changes);
    setLines([]);
    setDiscountPct(0);
    setServiceChargePct(0);
    setCustomer({});
    setActiveOrder(null);
    setTableIdState(undefined);
  }, [tableId]);

  /** Send unsent items (and cancellations) to the kitchen; returns the tickets and the saved running bill. */
  const sendKitchenWithOrder = useCallback(async (): Promise<{ kots: Kot[]; order: Order } | null> => {
    if (!pendingKitchenLines.length && !pendingCancelLines.length) return null;
    const db = getDb();
    const now = Date.now();
    // Re-read the shared order: another device may have sent items for this table meanwhile.
    const latest = activeOrder?.uid ? await orderByUid(activeOrder.uid) : tableId ? await latestHeldOrder(tableId) : null;
    const base = latest && latest.status === "held" ? latest : null;
    const merged = base ? removeCancelled(mergeSentLines(base.lines, pendingKitchenLines), pendingCancelLines) : lines;
    const t = computeTotals(merged, discountPct, serviceChargePct, tax);
    const tableLabel = await tableLabelOf(tableId);
    const extras = { serviceChargePct, tax, taxable: t.taxable, ...(customer.name || customer.phone || customer.gstin ? { customer } : {}) };
    const order: Order = withCustomerId(base
      ? { ...base, lines: merged, ...t, discountPct, ...extras, status: "held" as const }
      : {
          uid: newUid(), billNo: await newBillNumber(new Date(now)), orderType, tableId, tableLabel, lines: merged,
          subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt, cgst: t.cgst, sgst: t.sgst,
          roundOff: t.roundOff, total: t.total, payments: [], status: "held", createdAt: now, synced: false, ...extras,
        });
    const orderUid = order.uid ?? newUid();
    order.uid = orderUid;
    const nextSubmitted = subtractSubmittedQuantities(accumulateSubmittedQuantities(base?.kotSubmittedQty ?? {}, pendingKitchenLines), pendingCancelLines);
    const allCancelled = merged.length === 0;
    const saved: Order = {
      ...order, kotSubmittedQty: nextSubmitted, synced: false,
      ...(allCancelled ? { status: "void" as const, voidReason: "All items cancelled before billing" } : {}),
    };

    let kots: Kot[] = [];
    await db.transaction("rw", db.orders, db.kots, async () => {
      const id = saved.id ?? Number(await db.orders.add(saved));
      saved.id = id;
      await db.orders.put(saved);
      const ticket = (kind: "order" | "cancel") => ([station, stationLines]: [string, CartLine[]]): Kot => ({
        uid: newUid(), orderId: id, orderUid, billNo: saved.billNo, station, kind, tableId: saved.tableId, tableLabel: saved.tableLabel ?? tableLabel, orderType,
        lines: stationLines.map((line) => ({ itemId: line.itemId, name: line.name, qty: line.qty, note: line.note })),
        status: "new", createdAt: now,
      });
      kots = [
        ...Array.from(kotGroups(pendingKitchenLines), ticket("order")),
        ...Array.from(kotGroups(pendingCancelLines), ticket("cancel")),
      ];
      await db.kots.bulkAdd(kots);
    });
    await markDirty(["order", orderUid], ...kots.map((kot): [RecordKind, string] => ["kot", kot.uid ?? ""]));
    if (allCancelled) {
      await finishTable([]);
      toast.success(`Cancellation sent to the kitchen; bill ${saved.billNo} closed with nothing to pay`);
      return { kots, order: saved };
    }
    setActiveOrder(saved);
    setLines(merged);
    toast.success(`${kots.length} kitchen ticket${kots.length === 1 ? "" : "s"} sent`);
    return { kots, order: saved };
  }, [activeOrder, customer, discountPct, finishTable, lines, orderType, pendingCancelLines, pendingKitchenLines, serviceChargePct, tableId, taxKey]);

  const sendKitchen = useCallback(async (): Promise<Kot[]> => (await sendKitchenWithOrder())?.kots ?? [], [sendKitchenWithOrder]);

  /** Re-read the shared order before closing it, in case another device already did. */
  const checkStillOpen = useCallback(async (): Promise<Order | null | false> => {
    if (unsentKitchenLines(lines, activeOrder?.kotSubmittedQty).length || cancelledKitchenLines(lines, activeOrder?.kotSubmittedQty, activeOrder?.lines).length) {
      toast.error("Send the kitchen ticket before settling this bill");
      return false;
    }
    const latest = activeOrder?.uid ? await orderByUid(activeOrder.uid) : null;
    if (latest && latest.status !== "held") {
      toast.error(`Bill ${latest.billNo} was already ${latest.status === "settled" ? "settled" : "voided"} on another device`);
      return false;
    }
    return latest;
  }, [activeOrder, lines]);

  const settle = useCallback(async (
    payment: PaymentMode | Payment[],
    closedBy?: string,
    options: { autoKot?: boolean; onKots?: (kots: Kot[]) => void } = {},
  ): Promise<Order | null> => {
    if (!lines.length) return null;
    let latest: Order | null;
    let billLines = lines;
    const unsent = pendingKitchenLines.length > 0 || pendingCancelLines.length > 0;
    if (unsent && options.autoKot) {
      // Quick-service flow: send what's left to the kitchen, then settle the bill it produced.
      const sent = await sendKitchenWithOrder();
      if (!sent || sent.order.status !== "held") return null;
      options.onKots?.(sent.kots);
      latest = sent.order;
      billLines = sent.order.lines;
    } else {
      const checked = await checkStillOpen();
      if (checked === false) return null;
      latest = checked;
    }
    const t = computeTotals(billLines, discountPct, serviceChargePct, tax);
    const payments = Array.isArray(payment) ? settledPayments(payment, t.total) : [{ mode: payment, amount: t.total }];
    const received = payments.reduce((sum, p) => sum + p.amount, 0);
    if (received + 0.01 < t.total) {
      // Another device added to this table after payment was entered: never record a short payment.
      toast.error(`This bill is now ${t.total.toLocaleString("en-IN")}. Take payment again.`);
      return null;
    }
    const order: Order = withCustomerId({
      ...(latest ?? ({} as Order)),
      uid: latest?.uid ?? newUid(),
      billNo: latest?.billNo ?? await newBillNumber(new Date()),
      orderType, tableId: tableId ?? latest?.tableId, tableLabel: latest?.tableLabel ?? await tableLabelOf(tableId), lines: billLines, subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt,
      serviceChargePct, serviceCharge: t.serviceCharge, cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total,
      taxable: t.taxable, tax,
      payments, status: "settled", createdAt: latest?.createdAt ?? Date.now(), synced: false,
      ...(customer.name || customer.phone || customer.gstin ? { customer } : {}),
      ...(closedBy ? { closedBy } : {}),
    });
    const db = getDb();
    const id = order.id ? await db.orders.put(order) : Number(await db.orders.add(order));
    order.id = id;
    await applyLocalStockSale(billLines, { orderUid: order.uid ?? "", billNo: order.billNo, by: closedBy });
    await rememberCustomer(order.customer);
    await finishTable([["order", order.uid ?? ""]]);
    toast.success(`Bill ${order.billNo} settled`);
    return order;
  }, [checkStillOpen, customer, discountPct, finishTable, lines, orderType, pendingCancelLines, pendingKitchenLines, sendKitchenWithOrder, serviceChargePct, tableId, taxKey]);

  /**
   * Settle part of a running bill now (guests paying separately). The chosen
   * quantities become their own settled bill; the rest stays on the table.
   */
  const settlePart = useCallback(async (quantities: Record<string, number>, payment: Payment[], closedBy?: string): Promise<Order | null> => {
    const latest = await checkStillOpen();
    if (latest === false) return null;
    const { split, remaining } = splitLines(lines, quantities);
    if (!split.length) { toast.error("Choose at least one item to split off"); return null; }
    if (!remaining.length) return settle(payment, closedBy);

    const now = Date.now();
    const t = computeTotals(split, discountPct, serviceChargePct, tax);
    const label = latest?.tableLabel ?? await tableLabelOf(tableId);
    const part: Order = withCustomerId({
      uid: newUid(), billNo: await newBillNumber(new Date(now)), orderType, tableId: tableId ?? latest?.tableId, tableLabel: label, lines: split,
      subtotal: t.subtotal, discountPct, discountAmt: t.discountAmt, serviceChargePct, serviceCharge: t.serviceCharge,
      cgst: t.cgst, sgst: t.sgst, roundOff: t.roundOff, total: t.total, payments: settledPayments(payment, t.total),
      taxable: t.taxable, tax,
      status: "settled", createdAt: now, synced: false,
      kotSubmittedQty: Object.fromEntries(split.map((l) => [l.itemId, l.qty])),
      ...(customer.name || customer.phone || customer.gstin ? { customer } : {}),
      ...(closedBy ? { closedBy } : {}),
    });
    const db = getDb();
    part.id = Number(await db.orders.add(part));
    const changes: [RecordKind, string][] = [["order", part.uid ?? ""]];

    const rest = computeTotals(remaining, discountPct, serviceChargePct, tax);
    if (latest?.id !== undefined) {
      const sent: Record<string, number> = { ...(latest.kotSubmittedQty ?? {}) };
      for (const line of split) sent[line.itemId] = Math.max(0, (sent[line.itemId] ?? 0) - line.qty);
      const updated: Order = { ...latest, lines: remaining, kotSubmittedQty: sent, subtotal: rest.subtotal, discountAmt: rest.discountAmt,
        serviceCharge: rest.serviceCharge, taxable: rest.taxable, cgst: rest.cgst, sgst: rest.sgst, roundOff: rest.roundOff, total: rest.total, synced: false };
      await db.orders.put(updated);
      setActiveOrder(updated);
      if (updated.uid) changes.push(["order", updated.uid]);
    }
    if (tableId) {
      await db.restTables.update(tableId, { runningTotal: rest.total });
      changes.push(["table", tableId]);
    }
    await markDirty(...changes);
    await applyLocalStockSale(split, { orderUid: part.uid ?? "", billNo: part.billNo, by: closedBy });
    await rememberCustomer(part.customer);
    setLines(remaining);
    toast.success(`Bill ${part.billNo} settled; the rest stays on the table`);
    return part;
  }, [checkStillOpen, customer, discountPct, lines, orderType, serviceChargePct, settle, tableId, taxKey]);

  /** Cancel a running order (nothing was paid). Kept as a void bill with the reason. */
  const cancelOrder = useCallback(async (reason: string, closedBy?: string) => {
    const latest = activeOrder?.uid ? await orderByUid(activeOrder.uid) : null;
    const changes: [RecordKind, string][] = [];
    if (latest?.id !== undefined && latest.status === "held") {
      await getDb().orders.update(latest.id, { status: "void", voidReason: reason, synced: false, ...(closedBy ? { closedBy } : {}) });
      if (latest.uid) changes.push(["order", latest.uid]);
    }
    await finishTable(changes);
    toast.success(latest ? `Bill ${latest.billNo} cancelled` : "Bill cleared");
  }, [activeOrder, finishTable]);

  return {
    lines, orderType, setOrderType: changeOrderType, tableId, setTableId, discountPct, setDiscountPct, tax,
    serviceChargePct, setServiceChargePct, customer, setCustomer, addItem, setQty, setNote, clear, totals,
    settle, settlePart, cancelOrder, sendKitchen, pendingKitchenLines, pendingCancelLines, activeOrder, openOrder, restoreLine,
    hold, takeOver,
  };
}
