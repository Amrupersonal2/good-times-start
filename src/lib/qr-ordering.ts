import type { MenuItem } from "./types";

/** The live site. Every QR code, printed card, shared link and install link uses it, never an editor or localhost origin. */
export const GUEST_ORDER_ORIGIN = "https://good-times-start.lovable.app";

export type GuestDiet = "all" | "veg" | "nonveg";

/** Direct storefront visitors can choose a table; printed QR links retain their table. */
export function guestChannel(qr: boolean, online: boolean, tableId?: string): "table" | "online" | null {
  if (tableId) return qr ? "table" : null;
  return online ? "online" : null;
}

/** Filters are combined; category names are searchable alongside dish names. */
export function filterGuestMenu(items: MenuItem[], query: string, diet: GuestDiet): MenuItem[] {
  const term = query.trim().toLocaleLowerCase();
  return items.filter((item) =>
    (diet === "all" || (diet === "veg" ? item.veg : !item.veg)) &&
    (!term || `${item.name} ${item.category} ${item.description ?? ""}`.toLocaleLowerCase().includes(term)),
  );
}

/** A successful update must read back a row; RLS-denied zero-row writes aren't saves. */
export function orderingSaveError(error: { code?: string; message: string } | null, rows: unknown[] | null): string | null {
  if (error?.code === "23505") return "That web address is taken. Try another.";
  if (error?.code === "23514") return "Use lower-case letters, numbers and dashes for the web address.";
  if (error) return error.message;
  return rows?.length ? null : "Only the owner or a manager can change guest ordering.";
}