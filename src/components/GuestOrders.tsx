import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { placeName } from "@/lib/table-logic";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, ChefHat, Clock, Phone, Send, ShoppingBag, Smartphone, UtensilsCrossed, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ConfirmButton";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VegMark } from "@/components/VegMark";
import { printKots } from "@/components/PrintHost";
import { useStaff } from "@/lib/auth-context";
import { useAccount } from "@/lib/use-account";
import { formatINR } from "@/lib/billing";
import { acceptGuestOrder, isActiveGuestOrder, loadGuestOrders, setGuestOrderStatus } from "@/lib/guest-order-actions";
import { sortGuestOrders, type GuestOrder } from "@/lib/guest-order-logic";
import { Segmented } from "@/components/Segmented";
import { fillTemplate, waLink } from "@/lib/marketing-logic";
import { useRestaurantSettings } from "@/lib/use-settings";
import { sendOrderReadyMessage } from "@/lib/whatsapp.functions";

function chime(ctx: AudioContext) {
  const now = ctx.currentTime;
  [660, 990, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now + i * 0.16);
    gain.gain.exponentialRampToValueAtTime(0.3, now + i * 0.16 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.22);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + i * 0.16);
    osc.stop(now + i * 0.16 + 0.26);
  });
}

const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const REJECT_REASONS = ["A dish is unavailable", "Kitchen is closing", "Too busy right now"];

/** Live list of guest orders for the active outlet; chimes when a new one arrives. */
function useGuestOrders(restaurantId: string | null, enabled: boolean) {
  const queryClient = useQueryClient();
  const key = useMemo(() => ["guest-orders", restaurantId], [restaurantId]);
  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!restaurantId,
    queryFn: () => loadGuestOrders(restaurantId ?? ""),
    refetchInterval: 20_000,
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!enabled || !restaurantId) return;
    const channel = supabase.channel(`guest-orders-${restaurantId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "guest_orders", filter: `restaurant_id=eq.${restaurantId}` },
        () => { void queryClient.invalidateQueries({ queryKey: key }); })
      // On (re)connect, fetch anything that arrived while the connection was down.
      .subscribe((status: string) => { if (status === "SUBSCRIBED") void queryClient.invalidateQueries({ queryKey: key }); });
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, restaurantId, queryClient, key]);
  return query;
}

export function GuestOrdersButton() {
  const { user } = useStaff();
  const account = useAccount().data;
  const ordering = account?.outlet.ordering ?? {};
  const enabled = !!user?.restaurantId && user.role !== "kitchen" && (!!ordering.table || !!ordering.online);
  const orders: GuestOrder[] = useGuestOrders(user?.restaurantId ?? null, enabled).data ?? [];
  const waiting = orders.filter((o) => o.status === "new");
  const [open, setOpen] = useState(false);
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef<Set<string> | null>(null);

  // Browsers allow sound only after a tap; prepare it on the first one.
  useEffect(() => {
    const unlock = () => {
      if (audio.current) return;
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audio.current = new Ctx();
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);
  useEffect(() => {
    const ids = new Set<string>(waiting.map((o) => o.id));
    if (seen.current) {
      const fresh = waiting.filter((o) => !seen.current?.has(o.id));
      if (fresh.length) {
        if (audio.current) { void audio.current.resume(); chime(audio.current); }
        toast(`New ${fresh[0]?.channel === "table" ? `table order from ${fresh[0]?.table_label ?? "a table"}` : "pickup order"}`, { action: { label: "Open", onClick: () => setOpen(true) } });
      }
    }
    seen.current = ids;
  }, [waiting]);

  if (!enabled) return null;
  return (
    <>
      <Button size="sm" variant={waiting.length ? "default" : "outline"} onClick={() => setOpen(true)} className={waiting.length ? "animate-pulse bg-gold text-gold-foreground hover:bg-gold/90" : ""}
        aria-label={`Guest orders${waiting.length ? `: ${waiting.length} waiting` : ""}`}>
        <BellRing className="size-4" />
        <span className="hidden sm:inline">Orders</span>
        {waiting.length ? <span className="rounded-full bg-gold-foreground px-1.5 text-[11px] font-bold text-gold">{waiting.length}</span> : null}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
          <GuestOrdersPanel orders={orders} onDone={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

type View = "waiting" | "progress" | "done";

function GuestOrdersPanel({ orders, onDone }: { orders: GuestOrder[]; onDone: () => void }) {
  const [view, setView] = useState<View>("waiting");
  const groups: Record<View, GuestOrder[]> = {
    waiting: orders.filter((o) => o.status === "new"),
    progress: orders.filter((o) => o.status === "accepted" || o.status === "ready"),
    done: orders.filter((o) => !isActiveGuestOrder(o)),
  };
  const list = sortGuestOrders(groups[view]);
  return (
    <div>
      <DialogTitle>Guest orders</DialogTitle>
      <p className="-mt-1 text-sm text-muted-foreground">From table QR codes and your online ordering page. Accepting sends the KOT and opens the bill.</p>
      <Segmented ariaLabel="Order status" stretch className="mt-3" value={view} onChange={setView}
        options={([["waiting", "Waiting"], ["progress", "In progress"], ["done", "Done today"]] as const).map(([v, l]) => ({ value: v, label: l, badge: groups[v].length }))} />
      <div className="mt-3 space-y-3">
        {list.length ? list.map((o) => <GuestOrderCard key={o.id} order={o} onOpenBill={onDone} />) : (
          <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{view === "waiting" ? "No orders waiting." : "Nothing here yet."}</p>
        )}
      </div>
    </div>
  );
}

function GuestOrderCard({ order, onOpenBill }: { order: GuestOrder; onOpenBill: () => void }) {
  const { user } = useStaff();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const staff = user?.displayName ?? "Staff";
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ["guest-orders", user?.restaurantId ?? null] }), [queryClient, user?.restaurantId]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (error) { toast.error(error instanceof Error ? error.message : "Something went wrong"); } finally { setBusy(false); void refresh(); }
  };
  const accept = () => run(async () => {
    const result = await acceptGuestOrder(order, staff);
    if (!result) { toast.error(`Order ${order.code} was already handled on another device`); return; }
    void printKots(result.kots, "sent");
    toast.success(`${order.code} accepted: ${result.kots.length} KOT${result.kots.length === 1 ? "" : "s"} sent, bill ${result.order.billNo}`);
    if (result.missing.length) toast.warning(`Not on this device's menu: ${result.missing.join(", ")}. Added at the guest's price; check the bill.`);
  });
  const status = (next: GuestOrder["status"], why = "") => run(() => setGuestOrderStatus(order, next, staff, why));
  const restaurant = useRestaurantSettings().name;
  const readyText = fillTemplate("Hi {first}, your order {offer} from {restaurant} is ready for pickup. See you soon!", { name: order.customer_name, offer: order.code, restaurant });
  const markReady = () => run(async () => {
    await setGuestOrderStatus(order, "ready", staff);
    // Automatic WhatsApp, only if the owner switched it on and the guest said yes.
    if (order.whatsapp_opt_in) {
      try {
        const sent = await sendOrderReadyMessage({ data: { guestOrderId: order.id } });
        if (sent.sent) toast.success(`${order.customer_name || "Guest"} told on WhatsApp`);
      } catch { /* the one-tap button below still works */ }
    }
  });
  const openBill = () => {
    onOpenBill();
    if (order.channel === "table" && order.table_id) void navigate({ to: "/", search: { table: order.table_id } });
    else if (order.order_uid) void navigate({ to: "/", search: { bill: order.order_uid } });
  };

  return (
    <article className={`rounded-xl border p-4 ${order.status === "new" ? "border-gold bg-gold/5" : "border-border bg-card"}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-extrabold">{order.code}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
              {order.channel === "table" ? <><UtensilsCrossed className="size-3" />{placeName(order.table_label ?? "")}</> : <><ShoppingBag className="size-3" />Pickup{order.pickup_at ? ` ${timeOf(order.pickup_at)}` : " ASAP"}</>}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground"><Clock className="mr-1 inline size-3" />{minutesAgo(order.created_at)} min ago{order.handled_by ? ` · ${order.handled_by}` : ""}{order.bill_no ? ` · Bill ${order.bill_no}` : ""}</p>
        </div>
        <div className="text-right">
          <div className="text-lg font-bold">{formatINR(order.subtotal, 0)}</div>
          <div className="text-[11px] text-muted-foreground">before tax</div>
        </div>
      </header>
      {order.customer_name || order.customer_phone ? (
        <p className="mt-2 text-sm"><span className="font-semibold">{order.customer_name}</span>{order.customer_phone ? <a href={`tel:${order.customer_phone}`} className="ml-2 inline-flex items-center gap-1 text-primary"><Phone className="size-3" />{order.customer_phone}</a> : null}
          {order.whatsapp_opt_in ? <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success"><Send className="size-3" />Offers OK</span> : null}</p>
      ) : null}
      <ul className="mt-2 space-y-1 text-sm">
        {order.lines.map((l, i) => (
          <li key={i} className="flex items-start gap-2"><span className="mt-1"><VegMark veg={l.veg ?? false} /></span><span className="flex-1"><strong>{l.qty} ×</strong> {l.name}{l.note ? <span className="block text-xs text-muted-foreground">{l.note}</span> : null}</span></li>
        ))}
      </ul>
      {order.note ? <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-sm">“{order.note}”</p> : null}
      {order.payment === "upi" ? <p className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary"><Smartphone className="size-3.5" />Paying by UPI{order.upi_ref ? `, ref ${order.upi_ref}` : ""}. Check it before settling.</p> : null}
      {order.reason && !isActiveGuestOrder(order) ? <p className="mt-2 text-xs text-muted-foreground">{order.reason}</p> : null}

      {rejecting ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">{REJECT_REASONS.map((r) => <button key={r} type="button" onClick={() => setReason(r)} className={`rounded-full px-3 py-1 text-xs font-semibold ${reason === r ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>{r}</button>)}</div>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="Reason the guest will see" className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm" />
          <div className="flex gap-2"><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void status("rejected", reason.trim())}>Reject order</Button><Button variant="ghost" onClick={() => setRejecting(false)}>Back</Button></div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {order.status === "new" ? <>
            <ConfirmButton id={`accept-${order.id}`} disabled={busy} onConfirm={accept} className={buttonVariants()} armedClassName="!bg-gold !text-gold-foreground" confirm={<><ChefHat />Tap again to accept</>}><ChefHat />{busy ? "Accepting…" : "Accept & send KOT"}</ConfirmButton>
            <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setRejecting(true)}><X />Reject</Button>
          </> : null}
          {order.status === "accepted" && order.channel === "online" ? <ConfirmButton id={`ready-${order.id}`} disabled={busy} onConfirm={markReady} className={buttonVariants()} armedClassName="!bg-gold !text-gold-foreground" confirm="Tap again: tell guest it's ready"><Check />Ready for pickup</ConfirmButton> : null}
          {order.status === "ready" && order.customer_phone ? <Button variant="outline" asChild><a href={waLink(order.customer_phone, readyText)} target="_blank" rel="noreferrer"><Send />WhatsApp guest</a></Button> : null}
          {order.status === "accepted" && order.channel === "table" ? <ConfirmButton id={`served-${order.id}`} disabled={busy} onConfirm={() => status("completed")} className={buttonVariants({ variant: "secondary" })} armedClassName="!bg-gold !text-gold-foreground" confirm="Tap again"><Check />Served</ConfirmButton> : null}
          {order.status === "ready" ? <ConfirmButton id={`picked-${order.id}`} disabled={busy} onConfirm={() => status("completed")} className={buttonVariants()} armedClassName="!bg-gold !text-gold-foreground" confirm="Tap again"><Check />Picked up</ConfirmButton> : null}
          {order.status === "accepted" || order.status === "ready" ? <Button variant="outline" onClick={openBill}>Open bill</Button> : null}
        </div>
      )}
    </article>
  );
}
