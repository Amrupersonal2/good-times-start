import { CalendarClock, Check, X, LogIn } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "./ui/button";
import { useReservations } from "@/lib/use-reservations";
import { useStaff } from "@/lib/auth-context";
import { can } from "@/lib/permissions";
import { reservationsForDate } from "@/lib/reservations";
import { dayBounds, dateLabel } from "@/lib/orders-history";

export interface ReservationsPanelProps extends React.HTMLAttributes<HTMLElement> { date?: string; readOnly?: boolean; ref?: React.Ref<HTMLElement> }
/** Staff arrival ledger; reservation state never changes financial settlements or creates kitchen tickets. */
export function ReservationsPanel({ date, readOnly = false, className = "", ref, ...props }: ReservationsPanelProps) {
  const { user } = useStaff();
  const bookings = useReservations();
  const [selectedDate, setSelectedDate] = useState(dateLabel());
  const [busy, setBusy] = useState("");
  const [start, end] = dayBounds(date ?? selectedDate);
  const rows = reservationsForDate(bookings.rows, start, end);
  const change = async (id: string, status: "confirmed" | "arrived" | "cancelled" | "rejected") => {
    setBusy(id);
    try { await bookings.update(id, status); toast.success("Reservation updated"); } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't update reservation"); } finally { setBusy(""); }
  };
  return <section ref={ref} {...props} aria-label="Guest reservations" className={`mb-7 border-y border-border py-4 ${className}`}>
    <header className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-base font-bold"><CalendarClock className="size-5 text-primary" />Guest reservations</h2>{!date ? <input aria-label="Reservation date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="rounded-md border border-input bg-card p-2 text-sm" /> : null}</header>
    <p className="mb-3 text-xs text-muted-foreground">{bookings.connected ? "Live arrivals" : bookings.at ? `Saved arrivals · ${new Date(bookings.at).toLocaleTimeString("en-IN")}` : "Connecting…"}{bookings.error ? ` · ${bookings.error}` : ""}</p>
    <div className="divide-y divide-border">{rows.map((r) => <article key={r.id} className="flex flex-wrap items-center gap-3 py-3">
      <span className="w-20 font-bold tabular-nums">{new Date(r.arrival_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
      <div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{r.section} · {r.table_label}</h3><p className="text-sm text-muted-foreground">{r.guest_name} · {r.party_size} guests · {r.status}</p>{!readOnly ? <p className="text-xs text-muted-foreground">{r.guest_phone}</p> : null}</div>
      {!readOnly && can(user, "guestOrders.handle") ? <div className="flex flex-wrap gap-2">
        {r.status === "pending" ? <><Button size="sm" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "confirmed")}><Check />Confirm</Button><Button size="sm" variant="outline" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "rejected")}><X />Reject</Button></> : null}
        {r.status === "confirmed" ? <Button size="sm" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "arrived")}><LogIn />Arrived</Button> : null}
        {["pending", "confirmed", "arrived"].includes(r.status) ? <Button size="sm" variant="ghost" disabled={!!busy || !bookings.connected} onClick={() => void change(r.id, "cancelled")}><X />Cancel</Button> : null}
      </div> : null}
    </article>)}{!rows.length ? <p className="py-3 text-sm text-muted-foreground">No guest reservations for this date.</p> : null}</div>
  </section>;
}