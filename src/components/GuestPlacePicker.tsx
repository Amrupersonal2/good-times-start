import { BedDouble } from "lucide-react";
import { placeName } from "@/lib/table-logic";
import { guestTableChoices, type Storefront } from "@/lib/guest-order-logic";
import { isRoomSection, roomGroups, roomLabel, roomOpen } from "@/lib/room-logic";

type Place = Storefront["tables"][number];

/** What a guest calls the place they order to: "D1", "Room 2 · Bed A", "Experience by XTSY". */
export function guestPlaceName(store: Pick<Storefront, "rooms">, place: Place | undefined, fallback = ""): string {
  if (!place) return placeName(fallback);
  return isRoomSection(place.section) ? roomLabel(place, store.rooms) : placeName(place.label);
}

/** In-house guests pick their room: private rooms (priority first), then dorm beds. Closed rooms are shown but can't be picked. */
export function RoomPicker({ store, onPick }: { store: Storefront; onPick: (id: string) => void }) {
  if (!store.rooms) return null;
  const { privateRooms, dorms } = roomGroups(store.tables, store.rooms);
  if (!privateRooms.length && !dorms.length) return null;
  const option = (p: Place) => {
    const open = roomOpen(p.id, store.rooms);
    return <option key={p.id} value={p.id} disabled={!open}>{roomLabel(p, store.rooms)}{open ? "" : " — call reception"}</option>;
  };
  return (
    <section className="mt-6 rounded-2xl border border-border bg-card p-4" aria-label="Order to your room">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-tint text-primary"><BedDouble className="size-5" /></span>
        <div><h3 className="font-bold">Staying with us?</h3><p className="text-sm text-muted-foreground">Order to your room. Pay at checkout.</p></div>
      </div>
      <label className="mt-3 block text-sm font-medium">Your room
        <select aria-label="Choose your room" defaultValue="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
          className="mt-1 h-12 w-full rounded-xl border border-input bg-background px-3 text-base">
          <option value="" disabled>Choose your room or bed</option>
          {privateRooms.length ? <optgroup label="Private rooms">{privateRooms.map(option)}</optgroup> : null}
          {dorms.map((d) => <optgroup key={d.room} label={`Dorm · ${d.room}`}>{d.beds.map(option)}</optgroup>)}
        </select>
      </label>
    </section>
  );
}

/** Options for the "ordering to" switcher: dining tables, then open rooms; the current place is always kept. */
export function PlaceOptions({ store, currentId }: { store: Storefront; currentId?: string | undefined }) {
  const tables = guestTableChoices(store.tables).filter((t) => !isRoomSection(t.section));
  const { privateRooms, dorms } = roomGroups(store.tables, store.rooms);
  const keep = (p: Place) => p.id === currentId || roomOpen(p.id, store.rooms);
  const openPrivate = privateRooms.filter(keep);
  const openDorms = dorms.map((d) => ({ ...d, beds: d.beds.filter(keep) })).filter((d) => d.beds.length);
  return <>
    {tables.length ? <optgroup label="Dining tables">{tables.map((t) => <option key={t.id} value={t.id}>{placeName(t.label)}</option>)}</optgroup> : null}
    {openPrivate.length ? <optgroup label="Private rooms">{openPrivate.map((p) => <option key={p.id} value={p.id}>{roomLabel(p, store.rooms)}</option>)}</optgroup> : null}
    {openDorms.map((d) => <optgroup key={d.room} label={`Dorm · ${d.room}`}>{d.beds.map((p) => <option key={p.id} value={p.id}>{roomLabel(p, store.rooms)}</option>)}</optgroup>)}
  </>;
}
