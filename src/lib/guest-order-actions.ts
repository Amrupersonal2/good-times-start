import { supabase } from "@/integrations/supabase/client";
import type { CartLine, Kot, Order } from "./types";
import { billNumber } from "./billing";
import { getDb, getDeviceCode, getSettings, markDirty, nextSeq } from "./db";
import { newUid, type RecordKind } from "./sync-core";
import { latestHeldOrder } from "./table-actions";
import { taxOptionsFor } from "./billing-config";
import { withCustomerId } from "./customer-logic";
import { rememberCustomer } from "./customer-actions";
import { setWhatsappConsent } from "./marketing-actions";
import { billWithGuestLines, cartLinesFromGuest, orderTypeFor, type GuestOrder, type GuestStatus } from "./guest-order-logic";
import { orderingSaveError } from "./qr-ordering";
import { syncCloudData } from "./cloud-sync";

const ACTIVE: GuestStatus[] = ["new", "accepted", "ready"];

/** Guest orders still needing attention, plus today's finished ones. */
export async function loadGuestOrders(restaurantId: string): Promise<GuestOrder[]> {
  const since = new Date(Date.now() - 18 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase.from("guest_orders").select("*")
    .eq("restaurant_id", restaurantId).gte("created_at", since)
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw error;
  return (data ?? []) as unknown as GuestOrder[];
}

export function isActiveGuestOrder(order: GuestOrder): boolean {
  return ACTIVE.includes(order.status);
}

/**
 * Accept a guest order: claim it in the cloud (so two counters can't both
 * accept it), then add it to the table's running bill or open a pickup bill,
 * and create the kitchen tickets. Returns the tickets to print.
 */
export async function acceptGuestOrder(guest: GuestOrder, staffName: string): Promise<{ order: Order; kots: Kot[]; missing: string[] } | null> {
  await ensureReadyForBilling(guest.restaurant_id);
  const { data: claimed, error } = await supabase.from("guest_orders")
    .update({ status: "accepted", handled_by: staffName })
    .eq("id", guest.id).eq("status", "new").select("id");
  if (error) throw new Error("Couldn't reach the cloud to accept this order. Check the internet and try again.");
  if (!claimed?.length) return null; // accepted, rejected or cancelled meanwhile
  try {
    return await openBillFor(guest);
  } catch (failure) {
    // Hand the order back so this or another counter can accept it again.
    await supabase.from("guest_orders").update({ status: "new", handled_by: "" }).eq("id", guest.id);
    throw failure;
  }
}

/**
 * A device that hasn't received the restaurant's menu and tax settings yet
 * (fresh install, just cleared) would open a bill without GST. Catch up first,
 * and refuse, without claiming the order, if it still isn't ready.
 */
async function ensureReadyForBilling(restaurantId: string): Promise<void> {
  const ready = async () => (await getSettings()).name.trim() !== "" && (await getDb().menu.count()) > 0;
  if (await ready()) return;
  try { await syncCloudData(restaurantId); } catch { /* reported below */ }
  if (!(await ready())) throw new Error("This device is still loading the menu and tax settings. Wait a moment and accept again.");
}

async function openBillFor(guest: GuestOrder): Promise<{ order: Order; kots: Kot[]; missing: string[] }> {
  const db = getDb();
  const [menu, settings] = await Promise.all([db.menu.toArray(), getSettings()]);
  const orderType = orderTypeFor(guest.channel);
  const { lines, missing } = cartLinesFromGuest(guest.lines, menu, guest.channel);
  const now = Date.now();
  const tableId = guest.channel === "table" ? guest.table_id ?? undefined : undefined;
  const base = tableId ? await latestHeldOrder(tableId) : null;
  const table = tableId ? await db.restTables.get(tableId) : undefined;
  const customer = guest.customer_name || guest.customer_phone
    ? { ...(guest.customer_name ? { name: guest.customer_name } : {}), ...(guest.customer_phone ? { phone: guest.customer_phone } : {}) }
    : undefined;

  // A bill number is used only when a new bill opens, so the series never skips.
  const billNo = base ? base.billNo : billNumber(await nextSeq(), new Date(now), await getDeviceCode());
  const order = withCustomerId(billWithGuestLines(base, lines, {
    uid: newUid(),
    billNo,
    orderType, tableId, tableLabel: table?.label ?? guest.table_label ?? undefined,
    discountPct: 0, serviceChargePct: 0, tax: taxOptionsFor(settings, orderType),
    payments: [], status: "held", createdAt: now, synced: false,
    source: guest.channel === "table" ? "qr" : "online",
    ...(customer ? { customer } : {}),
  }, guest.code));
  if (base && customer && !base.customer) order.customer = customer;

  const byStation = new Map<string, CartLine[]>();
  for (const line of lines) byStation.set(line.station, [...(byStation.get(line.station) ?? []), line]);
  const pickupNote = guest.channel === "online"
    ? `${guest.code} pickup${guest.pickup_at ? ` at ${new Date(guest.pickup_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : ""}${guest.note ? `: ${guest.note}` : ""}`
    : guest.note ? `${guest.code}: ${guest.note}` : "";

  let kots: Kot[] = [];
  await db.transaction("rw", db.orders, db.kots, async () => {
    const id = order.id ?? Number(await db.orders.add(order));
    order.id = id;
    await db.orders.put(order);
    kots = Array.from(byStation, ([station, stationLines], index): Kot => ({
      uid: newUid(), orderId: id, orderUid: order.uid ?? "", billNo: order.billNo, station, kind: "order",
      tableId: order.tableId, tableLabel: order.tableLabel ?? (guest.channel === "online" ? `${guest.code} ${guest.customer_name}`.trim() : undefined), orderType,
      lines: stationLines.map((l, i) => ({ itemId: l.itemId, name: l.name, qty: l.qty, note: index === 0 && i === 0 && pickupNote ? [l.note, pickupNote].filter(Boolean).join(" · ") : l.note })),
      status: "new", createdAt: now,
    }));
    await db.kots.bulkAdd(kots);
  });
  const changes: [RecordKind, string][] = [["order", order.uid ?? ""], ...kots.map((k): [RecordKind, string] => ["kot", k.uid ?? ""])];
  if (tableId && table) {
    await db.restTables.update(tableId, { status: "occupied", runningTotal: order.total, since: table.since ?? now });
    changes.push(["table", tableId]);
  }
  await markDirty(...changes);
  if (customer) await rememberCustomer(customer);
  // A guest who ticked "send me offers on WhatsApp" is recorded as agreeing.
  if (guest.whatsapp_opt_in && guest.customer_phone) await setWhatsappConsent(guest.customer_phone, true, guest.source || (guest.channel === "table" ? "qr" : "online"), guest.customer_name || undefined);

  await supabase.from("guest_orders").update({ order_uid: order.uid ?? null, bill_no: order.billNo }).eq("id", guest.id);
  return { order, kots, missing };
}

export async function setGuestOrderStatus(guest: GuestOrder, status: GuestStatus, staffName: string, reason = ""): Promise<void> {
  const { error } = await supabase.from("guest_orders")
    .update({ status, handled_by: staffName, ...(reason ? { reason } : {}) })
    .eq("id", guest.id);
  if (error) throw new Error("Couldn't update the order. Check the internet and try again.");
}

/** Owner or manager: change the outlet's guest ordering switches and web address. */
export async function saveOrderingConfig(restaurantId: string, changes: { ordering?: Record<string, unknown>; slug?: string }): Promise<string | null> {
  const { data, error } = await supabase.from("restaurants").update(changes as never).eq("id", restaurantId).select("id");
  return orderingSaveError(error, data);
}
