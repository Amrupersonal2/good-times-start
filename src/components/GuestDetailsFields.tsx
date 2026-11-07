import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDb } from "@/lib/db";
import { rememberCustomer } from "@/lib/customer-actions";
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
  const [open, setOpen] = useState(false);
  // Saved guests come from this device's copy, which every terminal keeps in sync.
  const saved = useLiveQuery(() => getDb().customers.toArray(), []);
  const phoneDigits = (customer.phone ?? "").replace(/\D/g, "").slice(-10);
  const matches = useMemo(() => {
    const q = (customer.name ?? "").trim().toLowerCase();
    return (saved ?? [])
      .filter((c) => c.name && (!q || c.name.toLowerCase().includes(q) || c.phone.includes(q)))
      .filter((c) => !(c.id === phoneDigits && c.name?.toLowerCase() === q))
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 8);
  }, [saved, customer.name, phoneDigits]);
  // Save as soon as both are filled so other terminals see this guest immediately.
  const save = (c: GuestDetails) => {
    if (c.name?.trim() && (c.phone ?? "").replace(/\D/g, "").length === 10) void rememberCustomer(c);
  };
  const maxGuests = orderType === "dine-in" ? Math.max(1, Math.min(50, tableSeats ?? 6)) : 50;
  const quickMax = Math.min(6, maxGuests);
  const custom = maxGuests > 6 && (customMode || (guestCount ?? 0) > 6);

  return (
    <div className="mt-2 space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7.5rem] gap-1.5">
        <div className="relative min-w-0">
          <input aria-label="Guest name, required" aria-required="true" required placeholder="Guest name *" maxLength={60}
            role="combobox" aria-expanded={open && matches.length > 0} aria-autocomplete="list" autoComplete="off"
            value={customer.name ?? ""}
            onFocus={() => setOpen(true)}
            onBlur={() => { window.setTimeout(() => setOpen(false), 150); save(customer); }}
            onChange={(e) => { setOpen(true); setCustomer({ ...customer, name: e.target.value }); }}
            className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-xs" />
          {open && matches.length > 0 ? (
            <ul role="listbox" aria-label="Saved guests" className="absolute left-0 top-9 z-50 max-h-56 w-64 max-w-[80vw] overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-lg">
              {matches.map((c) => (
                <li key={c.id} role="option" aria-selected={c.id === phoneDigits}>
                  <button type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { const next = { ...customer, name: c.name ?? "", phone: c.phone }; setCustomer(next); setOpen(false); save(next); }}
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground">
                    <span className="truncate font-medium">{c.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{c.phone}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <input aria-label="Guest mobile number, required" aria-required="true" required placeholder="Mobile *" type="tel" inputMode="numeric" maxLength={10}
          value={phoneDigits}
          onChange={(e) => {
            const phone = e.target.value.replace(/\D/g, "").slice(0, 10);
            const known = phone.length === 10 && !customer.name?.trim() ? saved?.find((c) => c.id === phone) : undefined;
            setCustomer({ ...customer, phone, ...(known?.name ? { name: known.name } : {}) });
          }}
          onBlur={() => save(customer)}
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
