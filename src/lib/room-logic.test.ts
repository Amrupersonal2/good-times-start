import { describe, expect, it } from "vitest";
import { roomGroups, roomInfo, roomLabel, roomOpen, setRoomsOpen, type RoomOrdering } from "./room-logic";

const floor = [
  { id: "ROOM-666", label: "Room 666", section: "Rooms" },
  { id: "ROOM-12", label: "Room 12", section: "Rooms" },
  { id: "ROOM-1", label: "Room 1", section: "Rooms" },
  { id: "ROOM-2B", label: "Room 2B", section: "Rooms" },
  { id: "ROOM-2A", label: "Room 2A", section: "Rooms" },
  { id: "ROOM-10A", label: "Room 10A", section: "Rooms" },
  { id: "ROOM-8H", label: "Room 8H", section: "Rooms" },
  { id: "D1", label: "D1", section: "Dine-in" },
];
const config: RoomOrdering = { priority: ["ROOM-666"], names: { "ROOM-666": "Experience by XTSY" }, on: ["ROOM-12"] };

describe("room service by QR", () => {
  it("tells dorm beds (A–F, A–H) from private rooms", () => {
    expect(roomInfo({ label: "Room 2A" })).toEqual({ kind: "dorm", room: "Room 2", bed: "A" });
    expect(roomInfo({ label: "Room 8H" })).toEqual({ kind: "dorm", room: "Room 8", bed: "H" });
    expect(roomInfo({ label: "Room 666" })).toEqual({ kind: "private", room: "Room 666" });
    expect(roomInfo({ label: "Room 12" }).kind).toBe("private");
  });

  it("names rooms the way guests read them", () => {
    expect(roomLabel(floor[0]!, config)).toBe("Experience by XTSY");
    expect(roomLabel(floor[3]!, config)).toBe("Room 2 · Bed B");
    expect(roomLabel(floor[1]!, config)).toBe("Room 12");
  });

  it("groups private rooms (priority first) and dorms with their beds, leaving dining tables out", () => {
    const groups = roomGroups(floor, config);
    expect(groups.privateRooms.map((r) => r.id)).toEqual(["ROOM-666", "ROOM-1", "ROOM-12"]);
    expect(groups.dorms.map((d) => [d.room, d.beds.map((b) => b.id)])).toEqual([
      ["Room 2", ["ROOM-2A", "ROOM-2B"]], ["Room 8", ["ROOM-8H"]], ["Room 10", ["ROOM-10A"]],
    ]);
  });

  it("keeps priority rooms always open and others off until switched on", () => {
    expect(roomOpen("ROOM-666", config)).toBe(true);
    expect(roomOpen("ROOM-12", config)).toBe(true);
    expect(roomOpen("ROOM-1", config)).toBe(false);
    expect(roomOpen("ROOM-1", undefined)).toBe(false);
  });

  it("switches a whole dorm at once and never switches a priority room off", () => {
    const opened = setRoomsOpen(config, ["ROOM-2A", "ROOM-2B"], true);
    expect(opened.on).toEqual(["ROOM-12", "ROOM-2A", "ROOM-2B"]);
    const closed = setRoomsOpen(opened, ["ROOM-666", "ROOM-12"], false);
    expect(closed.on).toEqual(["ROOM-2A", "ROOM-2B"]);
    expect(roomOpen("ROOM-666", closed)).toBe(true);
  });
});
