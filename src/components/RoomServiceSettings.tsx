import { BedDouble, Star } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { roomGroups, roomIsPriority, roomLabel, roomOpen, setRoomsOpen, type RoomOrdering } from "@/lib/room-logic";
import type { RestaurantTable } from "@/lib/types";

/**
 * Owner/manager switches for room service by QR. Priority rooms (Experience by XTSY)
 * are always on; every other private room or dorm is off until switched on here.
 */
export function RoomServiceSettings({ tables, value, onChange, disabled }: { tables: RestaurantTable[]; value: RoomOrdering | undefined; onChange: (next: RoomOrdering) => void; disabled: boolean }) {
  const { privateRooms, dorms } = roomGroups(tables, value);
  if (!privateRooms.length && !dorms.length) return null;
  const row = (key: string, title: string, hint: string, open: boolean, ids: string[], locked = false) => (
    <li key={key} className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className="min-w-0 flex-1"><span className="flex items-center gap-1.5 font-medium">{locked ? <Star className="size-3.5 fill-current text-gold" /> : null}{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
      <Switch aria-label={`Room service by QR for ${title}`} checked={open} disabled={disabled || locked} onCheckedChange={(v) => onChange(setRoomsOpen(value, ids, v))} />
    </li>
  );
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-start gap-3 border-b border-border p-3 text-sm">
        <BedDouble className="mt-0.5 size-4 shrink-0 text-primary" />
        <span><span className="font-medium">Room service by QR</span><span className="mt-0.5 block text-xs text-muted-foreground">In-house guests order to their room from the QR page. Starred rooms are always on; switch others on when they should take orders.</span></span>
      </div>
      {privateRooms.length ? <><p className="px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Private rooms</p>
        <ul className="divide-y divide-border">{privateRooms.map((r) => roomIsPriority(r.id, value)
          ? row(r.id, roomLabel(r, value), `${r.label} · always on`, true, [r.id], true)
          : row(r.id, roomLabel(r, value), roomOpen(r.id, value) ? "Taking QR orders" : "Off", roomOpen(r.id, value), [r.id]))}</ul></> : null}
      {dorms.length ? <><p className="border-t border-border px-3 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Dorms</p>
        <ul className="divide-y divide-border">{dorms.map((d) => {
          const on = d.beds.filter((b) => roomOpen(b.id, value)).length;
          return row(d.room, `Dorm · ${d.room}`, `${d.beds.length} beds (${d.beds[0]?.label.slice(-1)}–${d.beds[d.beds.length - 1]?.label.slice(-1)})${on && on < d.beds.length ? ` · ${on} on` : on ? " · taking QR orders" : " · off"}`, on === d.beds.length, d.beds.map((b) => b.id));
        })}</ul></> : null}
    </div>
  );
}
