import { CalendarClock, Check, X, LogIn, ReceiptText, Volume2 } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "./ui/button";
import { useReservations } from "@/lib/use-reservations";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { activeReservations, reservationsForDate, type Reservation } from "@/lib/reservations";
import { dayBounds, dateLabel } from "@/lib/orders-history";
import { useNavigate } from "@tanstack/react-router";
import { startReservationOrder } from "@/lib/reservation-actions";
import { playBookingChime, unlockBookingAudio } from "@/lib/booking-alert-audio";

export interface ReservationsPanelProps extends React.HTMLAttributes<HTMLElement> { date?: string; readOnly?: boolean; upcoming?: boolean; onOpenOrder?: () => void; ref?: React.Ref<HTMLElement> }
/** Staff arrival ledger; reservation state never changes financial settlements or creates kitchen tickets. */
export function ReservationsPanel({ date, readOnly = false, upcoming = false, onOpenOrder, className = "", ref, ...props }: ReservationsPanelProps) {
  const { user } = useStaff();
  const bookings = useReservations();
  const [selectedDate, setSelectedDate] = useState(dateLabel());
  const [busy, setBusy] = useState("");
  const navigate = useNavigate();
  const [start, end] = dayBounds(date ?? selectedDate);
  const rows = upcoming ? activeReservations(bookings.rows, Date.now()) : reservationsForDate(bookings.rows, start, end);
  const startOrder = async (r: Reservation) => {
    setBusy(r.id);
    try {
      await startReservationOrder(r);
      onOpenOrder?.();
      await navigate({ to: "/", search: { table: r.table_id } });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't open this booking."); } finally { setBusy(""); }
  };
  const change = async (id: string, status: "confirmed" | "arrived" | "cancelled" | "rejected") => {
    setBusy(id);
    try { await bookings.update(id, status); toast.success("Reservation updated"); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update reservation"); } finally { setBusy(""); }
  };
  return <section ref={ref} {...props} aria-label="Guest reservations" className={`mb-7 border-y border-border py-4 ${className}`}>
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-bold"><CalendarClock className="size-5 text-primary" />Guest reservations</h2><div className="flex flex-wrap items-center gap-2">{!readOnly ? <Button size="sm" variant="outline" onClick={() => { void unlockBookingAudio().then(async (ok) => { if (ok) { await playBookingChime(); toast.success("Booking sound enabled"); } else toast.error("Sound is blocked on this device."); }); }}><Volume2 />Enable sound</Button> : null}{!date && !upcoming ? <input aria-label="Reservation date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="rounded-md border border-input bg-card p-2 text-sm" /> : null}</div></header>
    <p className="mb-3 text-xs text-muted-foreground">{bookings.connected ? "Live arrivals" : bookings.at ? `Saved arrivals · ${new Date(bookings.at).toLocaleTimeString("en-IN")}` : "Connecting…"}{bookings.error ? ` · ${bookings.error}` : ""}</p>
    <div className="divide-y divide-border">{rows.map((r) => <article key={r.id} className="flex flex-wrap items-center gap-3 py-3">
      <span className="w-20 font-bold tabular-nums">{upcoming ? <span className="block text-xs text-muted-foreground">{new Date(r.arrival_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span> : null}{new Date(r.arrival_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
      <div className="min-w-0 flex-1"><h3 className="break-words text-lg font-bold">{r.section} · {r.table_label}</h3><p className="text-base font-semibold">{r.guest_name} · {r.party_size} guests</p><p className={r.status === "pending" ? "text-sm font-semibold text-warning" : "text-sm font-semibold text-success"}>{r.status === "pending" ? "Awaiting allotment" : r.status === "confirmed" ? "Table allotted" : r.status === "arrived" ? "Arrived" : r.status}</p>{!readOnly ? <p className="text-sm text-muted-foreground">{r.guest_phone}</p> : null}</div>
      {!readOnly && can(user, "guestOrders.handle") ? <div className="flex flex-wrap gap-2">
        {r.status === "pending" ? <><Button disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "confirmed")}><Check />Accept & allot</Button><Button variant="outline" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "rejected")}><X />Decline</Button></> : null}
        {r.status === "confirmed" ? <Button size="sm" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "arrived")}><LogIn />Arrived</Button> : null}
        {["confirmed", "arrived"].includes(r.status) && can(user, "bill.create") ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void startOrder(r)}><ReceiptText />Start order</Button> : null}
        {["pending", "confirmed", "arrived"].includes(r.status) ? <Button size="sm" variant="ghost" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "cancelled")}><X />Cancel</Button> : null}
      </div> : null}
    </article>)}{!rows.length ? <p className="py-3 text-sm text-muted-foreground">No guest reservations for this date.</p> : null}</div>
  </section>;
}