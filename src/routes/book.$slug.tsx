import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Users, CheckCircle2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingAvailability, bookingStatus, requestBooking } from "@/lib/reservations.functions";
import { bookingInputError } from "@/lib/reservations";
import cover from "@/assets/photography/bistro-menu.jpg";

const availabilityOptions = (slug: string, arrival: string, hours: number) => queryOptions({ queryKey: ["booking-availability", slug, arrival, hours], queryFn: () => bookingAvailability({ data: { slug, arrival, hours } }), refetchInterval: 5000 });
export const Route = createFileRoute("/book/$slug")({
  loader: async ({ params, context }) => {
    const arrival = new Date(Date.now() + 3600_000).toISOString();
    await context.queryClient.ensureQueryData(availabilityOptions(params.slug, arrival, 2));
    return { arrival };
  },
  head: () => ({ meta: [{ title: "Reserve a table — TAB Bistro by XTSY" }, { name: "description", content: "Room and dine-in availability with guest arrival reservations." }, { property: "og:title", content: "Reserve a table — TAB Bistro by XTSY" }, { property: "og:description", content: "Room and dine-in availability with guest arrival reservations." }, { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary_large_image" }] }),
  component: BookingPage,
});
function localDateTime(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}T${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`; }
function BookingPage() {
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();
  const [arrival, setArrival] = useState(initial.arrival);
  const [hours, setHours] = useState(2);
  const [table, setTable] = useState("");
  const [section, setSection] = useState("all");
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [party, setParty] = useState(2);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<{ id: string; token: string } | null>(null);
  const request = useRef<{ fingerprint: string; id: string } | null>(null);
  const send = useServerFn(requestBooking);
  const store = useQuery(availabilityOptions(slug, arrival, hours));
  const status = useQuery({ queryKey: ["reservation-status", receipt?.id], enabled: !!receipt, queryFn: () => receipt ? bookingStatus({ data: receipt }) : null, refetchInterval: 3000 });
  useEffect(() => {
    try { const raw = sessionStorage.getItem(`booking:${slug}`); if (raw) setReceipt(JSON.parse(raw) as { id: string; token: string }); } catch { /* No saved booking. */ }
  }, [slug]);
  const places = store.data?.places ?? [];
  const selected = places.find((p) => p.id === table);
  const sections = [...new Set(places.map((p) => p.section))];
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    if (!selected || selected.occupancy !== "free") { setError("Select an available room or table."); return; }
    const issue = bookingInputError(Date.parse(arrival), hours, party, selected.seats, Date.now()); if (issue) { setError(issue); return; }
    const fingerprint = JSON.stringify({ table, name, phone, party, arrival, hours });
    if (!request.current || request.current.fingerprint !== fingerprint) request.current = { fingerprint, id: crypto.randomUUID() };
    setBusy(true);
    try {
      const result = await send({ data: { slug, request: request.current.id, table, name, phone, party, arrival, hours } });
      setReceipt(result);
      try { sessionStorage.setItem(`booking:${slug}`, JSON.stringify({ id: result.id, token: result.token })); } catch { /* Keep confirmation in memory. */ }
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't send your reservation."); void store.refetch(); }
    finally { setBusy(false); }
  };
  return <main className="min-h-screen bg-background text-foreground">
    <header className="relative bg-sidebar text-sidebar-foreground"><img src={cover} alt="" className="absolute inset-0 size-full object-cover opacity-30" /><div className="relative mx-auto max-w-4xl px-5 py-10"><Link to="/order/$slug" params={{ slug }} className="mb-5 inline-flex items-center gap-2 text-sm"><ArrowLeft className="size-4" />Menu</Link><h1 className="text-3xl font-bold">{store.data?.name ?? "TAB Bistro by XTSY"}</h1><p className="mt-2 flex items-center gap-2"><CalendarClock className="size-5" />Guest reservations</p></div></header>
    <div className="mx-auto max-w-4xl px-5 py-6">
    {receipt ? <section className="py-6"><CheckCircle2 className="mb-4 size-10 text-success" /><h2 className="text-2xl font-bold">{status.data?.status === "confirmed" ? "Reservation confirmed" : status.data?.status === "arrived" ? "Welcome" : status.data?.status === "rejected" || status.data?.status === "cancelled" ? "Reservation closed" : "Awaiting staff confirmation"}</h2><p className="mt-3">{status.data?.section} · {status.data?.table_label}</p><p className="mt-2 text-muted-foreground">{status.data ? new Date(status.data.arrival_at).toLocaleString("en-IN") : "Checking reservation…"}</p>{status.isError ? <p role="alert" className="mt-3 text-destructive">Couldn't check the status. Your request is saved.</p> : null}<Button className="mt-5" variant="outline" onClick={() => { setReceipt(null); request.current=null; sessionStorage.removeItem(`booking:${slug}`); }}>Another reservation</Button></section> : <>
    {store.isError ? <p role="alert" className="mb-4 text-destructive">Availability unavailable. Check your connection.<Button variant="ghost" onClick={() => void store.refetch()}>Retry</Button></p> : null}
    {store.data && !store.data.enabled ? <p className="py-6 text-muted-foreground">Guest reservations are closed. Please contact the restaurant.</p> : <form onSubmit={(e) => void submit(e)} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-semibold">Arrival time<input aria-label="Arrival time" type="datetime-local" required value={localDateTime(arrival)} disabled={busy} onChange={(e) => { const d = new Date(e.target.value); if (Number.isFinite(d.getTime())) setArrival(d.toISOString()); setTable(""); }} className="mt-2 w-full rounded-md border border-input bg-card p-3" /></label><label className="text-sm font-semibold">Duration<select aria-label="Duration" value={hours} disabled={busy} onChange={(e) => { setHours(Number(e.target.value)); setTable(""); }} className="mt-2 w-full rounded-md border border-input bg-card p-3">{[1,2,3,4,8,12,24].map((h) => <option key={h} value={h}>{h} hours</option>)}</select></label><label className="text-sm font-semibold">Section<select aria-label="Reservation section" value={section} onChange={(e) => setSection(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-card p-3"><option value="all">All rooms & dine-in</option>{sections.map((s) => <option key={s}>{s}</option>)}</select></label></div>
      <section><div className="mb-3 flex flex-wrap justify-between gap-2"><h2 className="text-lg font-bold">Rooms & dine-in</h2><p className="text-sm text-muted-foreground">{places.filter((p) => p.occupancy === "free").length} available · {places.filter((p) => p.occupancy !== "free").length} occupied / reserved</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{places.filter((p) => section === "all" || p.section === section).map((p) => <Button key={p.id} type="button" variant={table === p.id ? "default" : "outline"} disabled={busy || p.occupancy !== "free" || store.isError} aria-pressed={table === p.id} className="h-28 flex-col whitespace-normal" onClick={() => setTable(p.id)}><span className="text-xs">{p.section}</span><span className="text-lg font-bold">{p.label}</span><span className="flex items-center gap-1 text-xs"><Users className="size-3" />{p.seats} · {p.occupancy === "free" ? "Available" : p.occupancy === "occupied" ? "Occupied" : "Reserved"}</span></Button>)}</div></section>
      <div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-semibold">Guest name<input aria-label="Guest name" required minLength={2} maxLength={80} value={name} disabled={busy} onChange={(e) => setName(e.target.value)} className="mt-2 w-full rounded-md border border-input bg-card p-3" /></label><label className="text-sm font-semibold">Mobile number<input aria-label="Mobile number" required type="tel" pattern="[0-9]{10,15}" maxLength={15} value={phone} disabled={busy} onChange={(e) => setPhone(e.target.value.replace(/\D/g,""))} className="mt-2 w-full rounded-md border border-input bg-card p-3" /></label><label className="text-sm font-semibold">Guests<input aria-label="Guests" type="number" required min={1} max={selected?.seats ?? 50} value={party} disabled={busy} onChange={(e) => setParty(Number(e.target.value))} className="mt-2 w-full rounded-md border border-input bg-card p-3" /></label></div>
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}<Button type="submit" disabled={busy || !selected || store.isError || selected.occupancy !== "free"}><CalendarClock />{busy ? "Sending…" : "Request reservation"}</Button>
    </form>}</>}
    </div>
  </main>;
}