import { useState } from "react";
import type { OrderType } from "@/lib/types";

type GuestDetails = { name?: string; phone?: string; gstin?: string };

export function GuestDetailsFields({
  customer, setCustomer, guestCount, setGuestCount, orderType, tableSeats,
}: {
  customer: GuestDetails;
  setCustomer: (value: GuestDetails) => void;
  guestCount?: number | undefined;
  setGuestCount: (value: number | undefined) => void;
  orderType: OrderType;
  tableSeats?: number | undefined;
}) {
  const [customMode, setCustomMode] = useState(false);
  const maxGuests = orderType === "dine-in" ? Math.max(1, Math.min(50, tableSeats ?? 6)) : 50;
  const quickMax = Math.min(6, maxGuests);
  const custom = maxGuests > 6 && (customMode || (guestCount ?? 0) > 6);

  return (
    <div className="mt-2 space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem] gap-1.5">
        <input aria-label="Guest name, required" aria-required="true" required placeholder="Guest name *" maxLength={60}
          value={customer.name ?? ""} onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs" />
        <input aria-label="Guest mobile number, required" aria-required="true" required placeholder="Mobile *" type="tel" inputMode="numeric" maxLength={10}
          value={(customer.phone ?? "").replace(/\D/g, "").slice(-10)}
          onChange={(e) => setCustomer({ ...customer, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs tabular-nums" />
        <select aria-label="Total number of guests, required" aria-required="true" required
          value={custom ? "custom" : guestCount ? String(guestCount) : ""}
          onChange={(e) => {
            if (e.target.value === "custom") { setCustomMode(true); if ((guestCount ?? 0) <= 6) setGuestCount(undefined); }
            else { setCustomMode(false); setGuestCount(e.target.value ? Number(e.target.value) : undefined); }
          }}
          className="h-8 min-w-0 rounded-md border border-input bg-background px-1.5 text-xs">
          <option value="">Guests *</option>
          {Array.from({ length: quickMax }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} {n === 1 ? "guest" : "guests"}</option>)}
          {maxGuests > 6 ? <option value="custom">Custom (7–{maxGuests})</option> : null}
        </select>
      </div>
      {custom && maxGuests > 6 ? (
        <label className="block text-[11px] text-muted-foreground">
          {orderType === "dine-in" ? `Custom guest count (table capacity: ${maxGuests})` : "Custom guest count"}
          <input aria-label="Custom total number of guests" type="number" inputMode="numeric" min={7} max={maxGuests}
            required value={(guestCount ?? 0) > 6 ? guestCount : ""}
            onChange={(e) => setGuestCount(e.target.value ? Number(e.target.value) : undefined)}
            className="mt-0.5 h-8 w-full rounded-md border border-input bg-background px-2 text-xs tabular-nums" />
        </label>
      ) : null}
      {orderType === "dine-in" && tableSeats ? <p className="text-[10px] text-muted-foreground">Table capacity: {tableSeats} guests</p> : null}
    </div>
  );
}
