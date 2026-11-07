/**
 * Room service by QR for hostel rooms on the floor plan ("Rooms" section).
 * Dorm beds are rooms with lettered beds (Room 2A … Room 8H); every other room is
 * a private room. Priority rooms (e.g. Experience by XTSY) always take QR orders;
 * other rooms only once staff switch them on.
 */

/** Stored on the outlet: restaurants.ordering.rooms. */
export interface RoomOrdering {
  /** Rooms (table ids) switched on for QR ordering. */
  on?: string[];
  /** Rooms that always take QR orders and are listed first. */
  priority?: string[];
  /** Guest-facing names, e.g. { "ROOM-666": "Experience by XTSY" }. */
  names?: Record<string, string>;
}

export interface PlaceLike { id: string; label: string; section: string }

export function isRoomSection(section: string | undefined): boolean {
  return /^rooms?$/i.test((section ?? "").trim());
}

const DORM_BED = /^(.*?\d+)\s*-?\s*([A-H])$/i;

/** "Room 2A" → dorm Room 2, bed A; "Room 666" → private. */
export function roomInfo(place: Pick<PlaceLike, "label">): { kind: "dorm" | "private"; room: string; bed?: string } {
  const m = DORM_BED.exec(place.label.trim());
  return m ? { kind: "dorm", room: (m[1] ?? "").trim(), bed: (m[2] ?? "").toUpperCase() } : { kind: "private", room: place.label.trim() };
}

/** What a guest sees: the room's own name, "Room 2 · Bed A" for a dorm bed, or the label. */
export function roomLabel(place: PlaceLike, config?: RoomOrdering | null): string {
  const named = config?.names?.[place.id]?.trim();
  if (named) return named;
  const info = roomInfo(place);
  return info.kind === "dorm" ? `${info.room} · Bed ${info.bed}` : place.label;
}

export function roomIsPriority(id: string, config?: RoomOrdering | null): boolean {
  return !!config?.priority?.includes(id);
}

/** Whether a room takes QR orders now. */
export function roomOpen(id: string, config?: RoomOrdering | null): boolean {
  return roomIsPriority(id, config) || !!config?.on?.includes(id);
}

const byLabel = (a: PlaceLike, b: PlaceLike) => a.label.localeCompare(b.label, undefined, { numeric: true });

/**
 * Rooms grouped for pickers and settings: private rooms (priority rooms first), then each
 * dorm with its beds in order.
 */
export function roomGroups<T extends PlaceLike>(places: T[], config?: RoomOrdering | null): { privateRooms: T[]; dorms: { room: string; beds: T[] }[] } {
  const rooms = places.filter((p) => isRoomSection(p.section));
  const privateRooms = rooms.filter((p) => roomInfo(p).kind === "private")
    .sort((a, b) => Number(roomIsPriority(b.id, config)) - Number(roomIsPriority(a.id, config)) || byLabel(a, b));
  const dorms = new Map<string, T[]>();
  for (const bed of rooms.filter((p) => roomInfo(p).kind === "dorm").sort(byLabel)) {
    const room = roomInfo(bed).room;
    dorms.set(room, [...(dorms.get(room) ?? []), bed]);
  }
  return { privateRooms, dorms: [...dorms].map(([room, beds]) => ({ room, beds })).sort((a, b) => a.room.localeCompare(b.room, undefined, { numeric: true })) };
}

/** Switch rooms on or off (a whole dorm is passed as all its beds). Priority rooms stay on. */
export function setRoomsOpen(config: RoomOrdering | undefined, ids: string[], open: boolean): RoomOrdering {
  const on = new Set(config?.on ?? []);
  for (const id of ids) {
    if (roomIsPriority(id, config)) continue;
    if (open) on.add(id); else on.delete(id);
  }
  return { ...(config ?? {}), on: [...on].sort() };
}
