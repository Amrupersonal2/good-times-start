export interface GuestPlace { id: string; label: string; section: string; seats: number; occupancy: "free" | "occupied" | "reserved" }
import type { RestaurantTable } from "./types";
export interface BookingAvailability { name: string; slug: string; enabled: boolean; places: GuestPlace[] }
export type ReservationStatus = "pending" | "confirmed" | "arrived" | "cancelled" | "rejected";
export interface Reservation {
  id: string; restaurant_id: string; table_id: string; table_label: string; section: string;
  guest_name: string; guest_phone: string; party_size: number; arrival_at: string; end_at: string;
  status: ReservationStatus; created_at: string;
}
export function bookingUrl(slug: string): string { return `https://good-times-start.lovable.app/book/${encodeURIComponent(slug)}`; }
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
/** A reservation blocks its arrival window only; existing occupied bills always win. */
export function withReservations<T extends RestaurantTable>(tables: T[], rows: Reservation[], now: number): T[] {
  const reserved = new Set(rows.filter((r) => ["pending", "confirmed", "arrived"].includes(r.status) && Date.parse(r.arrival_at) <= now && Date.parse(r.end_at) > now).map((r) => r.table_id));
  return tables.map((t) => t.status === "free" && reserved.has(t.id) ? { ...t, status: "reserved" } : t);
}