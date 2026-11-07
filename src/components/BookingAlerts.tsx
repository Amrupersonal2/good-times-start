import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useStaff } from "@/lib/auth-context";
import { useReservations } from "@/lib/use-reservations";
import { newBookingRequests } from "@/lib/reservations";
import { playBookingChime, unlockBookingAudio } from "@/lib/booking-alert-audio";
import { can } from "@/lib/permissions";

/** One notifier at the software root, surviving navigation; no public-guest or kitchen sound. */
export function BookingAlerts() {
  const { user } = useStaff();
  const bookings = useReservations();
  const seen = useRef<Set<string> | null>(null);
  const identity = useRef<string | null>(null);
  useEffect(() => {
    const unlock = () => { void unlockBookingAudio(); };
    window.addEventListener("pointerdown", unlock); window.addEventListener("keydown", unlock);
    return () => { window.removeEventListener("pointerdown", unlock); window.removeEventListener("keydown", unlock); };
  }, []);
  useEffect(() => {
    const next = user?.restaurantId ?? null;
    if (identity.current !== next) { identity.current = next; seen.current = null; }
    if (!next || !bookings.connected || !can(user, "guestOrders.handle")) return;
    const fresh = newBookingRequests(bookings.rows, seen.current);
    if (fresh.length) {
      void playBookingChime();
      const first = fresh[0];
      toast(`New table booking${fresh.length > 1 ? `s (${fresh.length})` : ""}: ${first?.table_label ?? "Guest request"}`, { duration: 10000, action: { label: "Open", onClick: () => window.dispatchEvent(new Event("pos:bookings")) } });
    }
    seen.current = new Set([...(seen.current ?? []), ...bookings.rows.map((r) => r.id)]);
  }, [bookings.rows, bookings.connected, user]);
  return null;
}