import type { RestaurantTable, CartDraft, Order } from "./types";
import { GUEST_ORDER_ORIGIN } from "./qr-ordering";
export interface GuestPlace { id: string; label: string; section: string; seats: number; occupancy: "free" | "occupied" | "reserved" }
export interface BookingAvailability { name: string; slug: string; enabled: boolean; places: GuestPlace[] }
export type ReservationStatus = "pending" | "confirmed" | "arrived" | "cancelled" | "rejected";
export interface Reservation {
  id: string; restaurant_id: string; table_id: string; table_label: string; section: string;
  guest_name: string; guest_phone: string; party_size: number; arrival_at: string; end_at: string;
  status: ReservationStatus; created_at: string;
}
export function bookingUrl(slug: string): string { return `${GUEST_ORDER_ORIGIN}/book/${encodeURIComponent(slug)}`; }
export function overlaps(a: { arrival_at: string; end_at: string }, b: { arrival_at: string; end_at: string }): boolean {
  return Date.parse(a.arrival_at) < Date.parse(b.end_at) && Date.parse(b.arrival_at) < Date.parse(a.end_at);
}
export function reservationsForDate(rows: Reservation[], start: number, end: number): Reservation[] {
  return rows.filter((r) => Date.parse(r.arrival_at) >= start && Date.parse(r.arrival_at) < end).sort((a, b) => Date.parse(a.arrival_at) - Date.parse(b.arrival_at));
}
export function bookingInputError(arrival: number, hours: number, party: number, seats: number, now: number): string | null {
  if (!Number.isFinite(arrival) || arrival <= now) return "Choose a future arrival time.";
  if (!Number.isInteger(hours) || hours < 1 || hours > 24) return "Choose a duration between 1 and 24 hours.";
  if (!Number.isInteger(party) || party < 1 || party > seats) return `Choose between 1 and ${seats} guests.`;
  return null;
}
export function activeReservations(rows: Reservation[], now: number): Reservation[] {
  return rows.filter((r) => ["pending", "confirmed", "arrived"].includes(r.status) && Date.parse(r.end_at) > now).sort((a, b) => Date.parse(a.arrival_at) - Date.parse(b.arrival_at));
}
/** Confirmed upcoming arrivals are visible immediately; occupied bills always win. */
export function withReservations<T extends RestaurantTable>(tables: T[], rows: Reservation[], now: number): (T & { booking?: Reservation })[] {
  const active = activeReservations(rows, now);
  return tables.map((t) => {
    const booking = active.find((r) => r.table_id === t.id && (r.status === "confirmed" || r.status === "arrived"));
    if (!booking) return t;
    return { ...t, ...(t.status === "free" ? { status: "reserved" as const } : {}), booking };
  });
}
/** Compare to the last successful read, not just the current pending set, so reconnect/re-render never rings twice. */
export function newBookingRequests(rows: Reservation[], seen: Set<string> | null): Reservation[] {
  return seen ? rows.filter((r) => r.status === "pending" && !seen.has(r.id)) : [];
}
export function reservationDraft(r: Reservation, existing: CartDraft | undefined, running: Order | undefined, now: number): CartDraft {
  if (!["confirmed", "arrived"].includes(r.status)) throw new Error("Confirm this booking before starting an order.");
  if (running) throw new Error("This table already has a running bill. Open it from Tables before starting another guest's order.");
  if (existing?.lines.length && (existing.customer?.phone !== r.guest_phone || existing.customer?.name !== r.guest_name)) throw new Error("This table has unsent items for another guest. Review its current order first.");
  if (r.end_at && Date.parse(r.end_at) <= now) throw new Error("This reservation has ended. Review the current booking before starting an order.");
  return { ...(existing ?? { id: r.table_id, tableId: r.table_id, lines: [], discountPct: 0 }), reservationId: r.id, customer: { name: r.guest_name, phone: r.guest_phone }, guestCount: r.party_size, updatedAt: now };
}

/** Legacy bills require a unique guest/time match; table identity alone never cancels a later booking. */
export function cancelledBillBooking(order: Order, rows: Reservation[]): Reservation | undefined {
  if (order.status !== "void" || !order.tableId || order.source === "qr") return undefined;
  const candidates = rows.filter((r) => r.table_id === order.tableId && ["confirmed", "arrived"].includes(r.status));
  if (order.reservationId) return candidates.find((r) => r.id === order.reservationId);
  const matches = candidates.filter((r) => Boolean(order.customer?.phone && order.customer?.name) && r.guest_phone === order.customer?.phone && r.guest_name === order.customer?.name && order.createdAt >= Date.parse(r.created_at) && order.createdAt < Date.parse(r.end_at));
  return matches.length === 1 ? matches[0] : undefined;
}