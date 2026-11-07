import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import type { BookingAvailability } from "./reservations";

function publicClient(url: string | undefined, key: string | undefined) {
  if (!url || !key) throw new Error("Guest booking is temporarily unavailable.");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => {
    const headers = new Headers(init?.headers);
    if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
    headers.set("apikey", key);
    return fetch(input, { ...init, headers });
  } } });
}
const slot = z.object({ slug: z.string().min(1).max(120), arrival: z.string().datetime(), hours: z.number().int().min(1).max(24) });
export const bookingAvailability = createServerFn({ method: "GET" }).inputValidator(slot).handler(async ({ data }) => {
  const client = publicClient(process.env['SUPABASE_URL'], process.env['SUPABASE_PUBLISHABLE_KEY']);
  const result = await client.rpc("public_booking_availability", { _slug: data.slug, _arrival: data.arrival, _hours: data.hours });
  if (result.error) throw new Error("Couldn't load availability. Please try again.");
  return result.data as unknown as BookingAvailability | null;
});
export const requestBooking = createServerFn({ method: "POST" }).inputValidator(slot.extend({ request: z.string().uuid(), table: z.string().min(1).max(100), name: z.string().trim().min(2).max(80), phone: z.string().regex(/^\d{10,15}$/), party: z.number().int().min(1).max(50) })).handler(async ({ data }) => {
  const client = publicClient(process.env['SUPABASE_URL'], process.env['SUPABASE_PUBLISHABLE_KEY']);
  const result = await client.rpc("request_guest_reservation", { _slug: data.slug, _request: data.request, _table: data.table, _name: data.name, _phone: data.phone, _party: data.party, _arrival: data.arrival, _hours: data.hours });
  if (result.error) throw new Error(result.error.code === "P0001" ? result.error.message : "Couldn't confirm your request. Retry without changing the booking.");
  return result.data as unknown as { id: string; token: string; status: string };
});
export const bookingStatus = createServerFn({ method: "GET" }).inputValidator(z.object({ id: z.string().uuid(), token: z.string().uuid() })).handler(async ({ data }) => {
  const client = publicClient(process.env['SUPABASE_URL'], process.env['SUPABASE_PUBLISHABLE_KEY']);
  const result = await client.rpc("guest_reservation_status", { _id: data.id, _token: data.token });
  if (result.error) throw new Error("Couldn't check your reservation.");
  return result.data as unknown as { table_label: string; section: string; party_size: number; arrival_at: string; status: string } | null;
});