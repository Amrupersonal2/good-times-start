import { describe, expect, it } from "vitest";
import { bookingInputError, bookingUrl, overlaps, reservationsForDate, withReservations, reservationDraft, newBookingRequests, cancelledBillBooking, type Reservation } from "./reservations";
describe("guest reservations", () => {
  it("shows confirmed bookings before arrival without freeing running bills", () => {
    const at = Date.parse("2026-11-07T11:00Z");
    const row = { table_id: "r1", status: "confirmed", arrival_at: "2026-11-07T10:00Z", end_at: "2026-11-07T12:00Z" } as Reservation;
    const table = { id: "r1", label: "Room 1", section: "Rooms", seats: 2, status: "free" as const, runningTotal: 0 };
    expect(withReservations([table], [row], at)[0]?.status).toBe("reserved");
    expect(withReservations([table], [row], at - 7200000)[0]?.status).toBe("reserved");
    expect(withReservations([table], [row], at - 7200000)[0]?.booking?.table_id).toBe("r1");
    expect(withReservations([table], [row], at + 7200000)[0]?.status).toBe("free");
    expect(withReservations([{ ...table, status: "occupied" as const }], [row], at)[0]?.status).toBe("occupied");
  });
  it("does not reserve future pending requests before acceptance", () => {
    const row = { table_id: "r1", status: "pending", arrival_at: "2026-11-07T14:00Z", end_at: "2026-11-07T16:00Z" } as Reservation;
    const table = { id: "r1", label: "Room 1", section: "Rooms", seats: 2, status: "free" as const, runningTotal: 0 };
    expect(withReservations([table], [row], Date.parse("2026-11-07T12:00Z"))[0]?.status).toBe("free");
    expect(withReservations([table], [row], Date.parse("2026-11-07T15:00Z"))[0]?.status).toBe("free");
    expect(withReservations([table], [row], Date.parse("2026-11-07T15:00Z"))[0]?.booking).toBeUndefined();
  });
  it("hands confirmed guest identity to a local order draft without numbered records", () => {
    const row = { table_id: "r1", status: "confirmed", guest_name: "Guest One", guest_phone: "9000000000", party_size: 2 } as Reservation;
    expect(reservationDraft(row, undefined, undefined, 123)).toEqual({ id: "r1", tableId: "r1", reservationId: row.id, lines: [], discountPct: 0, customer: { name: "Guest One", phone: "9000000000" }, guestCount: 2, updatedAt: 123 });
  });
  it("never overwrites another guest's unsent draft", () => {
    const row = { table_id: "r1", status: "confirmed", guest_name: "Guest One", guest_phone: "9000000000", party_size: 2 } as Reservation;
    const draft = { id: "r1", lines: [{ qty: 1 }] as import("./types").CartLine[], customer: { name: "Other guest", phone: "9000000001" }, discountPct: 0, updatedAt: 1 };
    expect(() => reservationDraft(row, draft, undefined, 123)).toThrow("unsent items for another guest");
  });
  it("does not overwrite a running bill", () => {
    const row = { table_id: "r1", status: "confirmed" } as Reservation;
    expect(() => reservationDraft(row, undefined, { status: "held" } as import("./types").Order, 123)).toThrow("already has a running bill");
  });
  it("alerts only on new pending requests, not initial load or status changes", () => {
    const row = { id: "new", status: "pending" } as Reservation;
    expect(newBookingRequests([row], null)).toEqual([]);
    expect(newBookingRequests([row], new Set(["old"]))).toEqual([row]);
    expect(newBookingRequests([row], new Set(["new"]))).toEqual([]);
    expect(newBookingRequests([{ ...row, status: "confirmed" }], new Set())).toEqual([]);
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