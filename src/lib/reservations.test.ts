import { describe, expect, it } from "vitest";
import { bookingInputError, bookingUrl, overlaps, reservationsForDate, withReservations, type Reservation } from "./reservations";
describe("guest reservations", () => {
  it("blocks only the arrival window without freeing running bills", () => {
    const at = Date.parse("2026-11-07T11:00Z");
    const row = { table_id: "r1", status: "confirmed", arrival_at: "2026-11-07T10:00Z", end_at: "2026-11-07T12:00Z" } as Reservation;
    const table = { id: "r1", label: "Room 1", section: "Rooms", seats: 2, status: "free" as const, runningTotal: 0 };
    expect(withReservations([table], [row], at)[0]?.status).toBe("reserved");
    expect(withReservations([table], [row], at + 7200000)[0]?.status).toBe("free");
    expect(withReservations([{ ...table, status: "occupied" as const }], [row], at)[0]?.status).toBe("occupied");
  });
  it("uses the canonical public QR origin", () => expect(bookingUrl("tab-bistro")).toBe("https://good-times-start.lovable.app/book/tab-bistro"));
  it("requires a future arrival", () => expect(bookingInputError(100, 2, 2, 4, 100)).toBe("Choose a future arrival time."));
  it("does not accept parties above capacity", () => expect(bookingInputError(200, 2, 5, 4, 100)).toBe("Choose between 1 and 4 guests."));
  it("permits adjacent slots but detects overlapping ones", () => {
    const a = { arrival_at: "2026-11-07T10:00Z", end_at: "2026-11-07T12:00Z" };
    expect(overlaps(a, { arrival_at: "2026-11-07T11:00Z", end_at: "2026-11-07T13:00Z" })).toBe(true);
    expect(overlaps(a, { arrival_at: "2026-11-07T12:00Z", end_at: "2026-11-07T14:00Z" })).toBe(false);
  });
  it("lists arrivals by arrival date, independently of settlement", () => {
    const row = { arrival_at: "2026-11-07T10:00Z" } as Reservation;
    expect(reservationsForDate([row], Date.parse("2026-11-07T00:00Z"), Date.parse("2026-11-08T00:00Z"))).toEqual([row]);
  });
});