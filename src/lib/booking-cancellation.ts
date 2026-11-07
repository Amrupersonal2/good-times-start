import { getDb } from "./db";
import { supabase } from "@/integrations/supabase/client";
import { cancelledBillBooking, type Reservation } from "./reservations";
import type { Order } from "./types";

const prefix = (restaurant: string) => `bookingCancel:${restaurant}:`;
export async function queueBillBookingCancellation(restaurant: string, order: Order): Promise<void> {
  const db = getDb();
  const cache = await db.meta.get(`reservations:${restaurant}`);
  const rows: Reservation[] = typeof cache?.value === "string" ? JSON.parse(cache.value).rows ?? [] : [];
  const booking = cancelledBillBooking(order, rows);
  const id = booking?.id ?? (order.status === "void" && order.source !== "qr" ? order.reservationId : undefined);
  if (!id) return;
  await db.meta.put({ key: `${prefix(restaurant)}${id}`, value: id });
}

/** Durable intent masks stale floor annotations until the authorized server transition reads back. */
export async function applyBookingCancellations(restaurant: string, rows: Reservation[]): Promise<Reservation[]> {
  const db = getDb();
  const intents = await db.meta.where("key").startsWith(prefix(restaurant)).toArray();
  const ids = new Set(intents.map((entry) => String(entry.value)));
  return rows.map((r) => ids.has(r.id) && ["confirmed", "arrived"].includes(r.status) ? { ...r, status: "cancelled" } : r);
}
export async function flushBookingCancellations(restaurant: string): Promise<void> {
  if (!navigator.onLine) return;
  const db = getDb();
  const intents = await db.meta.where("key").startsWith(prefix(restaurant)).toArray();
  for (const entry of intents) {
    const result = await supabase.rpc("manage_guest_reservation", { _id: String(entry.value), _status: "cancelled" });
    if (result.error) throw new Error("Bill cancelled; booking cleanup is waiting for connection or restaurant permission.");
    const read = await supabase.from("guest_reservations").select("status").eq("id", String(entry.value)).maybeSingle();
    if (read.error || read.data?.status !== "cancelled") throw new Error("Booking cleanup saved; waiting for confirmation.");
    await db.meta.delete(entry.key);
  }
}