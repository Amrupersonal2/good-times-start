import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { supabase } from "@/integrations/supabase/client";
import { getDb } from "./db";
import { useStaff } from "./auth-context";
import type { Reservation } from "./reservations";

export function useReservations() {
  const { user } = useStaff();
  const restaurant = user?.restaurantId;
  const key = `reservations:${restaurant ?? "none"}`;
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const cache = useLiveQuery(async () => {
    const row = await getDb().meta.get(key);
    if (!row || typeof row.value !== "string") return { rows: [] as Reservation[], at: 0 };
    try { return JSON.parse(row.value) as { rows: Reservation[]; at: number }; } catch { return { rows: [] as Reservation[], at: 0 }; }
  }, [key], { rows: [] as Reservation[], at: 0 });
  useEffect(() => {
    if (!restaurant) return;
    let alive = true;
    let running = false;
    const refresh = async () => {
      if (running || !navigator.onLine) { if (alive && !navigator.onLine) setConnected(false); return; }
      running = true;
      try {
        const result = await supabase.from("guest_reservations").select("id,restaurant_id,table_id,table_label,section,guest_name,guest_phone,party_size,arrival_at,end_at,status,created_at").eq("restaurant_id", restaurant).order("arrival_at").limit(1000);
        if (result.error) throw result.error;
        if (!alive) return;
        await getDb().meta.put({ key, value: JSON.stringify({ rows: result.data, at: Date.now() }) });
        setConnected(true); setError("");
      } catch { if (alive) { setConnected(false); setError("Bookings unavailable — showing saved arrivals."); } }
      finally { running = false; }
    };
    void refresh();
    const online = () => void refresh();
    const offline = () => setConnected(false);
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    window.addEventListener("online", online); window.addEventListener("offline", offline);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener("offline", offline); };
  }, [restaurant, key]);
  const update = async (id: string, status: "confirmed" | "arrived" | "cancelled" | "rejected") => {
    if (!navigator.onLine) throw new Error("Reconnect before confirming or cancelling a booking.");
    const result = await supabase.rpc("manage_guest_reservation", { _id: id, _status: status });
    if (result.error) throw new Error(result.error.message);
    // Never claim a status change until the server's authoritative row is read back.
    const readback = await supabase.from("guest_reservations").select("id,restaurant_id,table_id,table_label,section,guest_name,guest_phone,party_size,arrival_at,end_at,status,created_at").eq("restaurant_id", restaurant ?? "").order("arrival_at").limit(1000);
    if (readback.error) throw new Error("Saved, but couldn't refresh bookings. Reconnect to check the status.");
    await getDb().meta.put({ key, value: JSON.stringify({ rows: readback.data, at: Date.now() }) });
  };
  return { rows: restaurant ? cache.rows : [], at: cache.at, connected, error, update };
}