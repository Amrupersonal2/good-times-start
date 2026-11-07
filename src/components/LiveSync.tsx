import { useEffect } from "react";
import { useStaff } from "@/lib/auth-context";
import { startLiveSync } from "@/lib/cloud-sync";
import { prepareOfflineNumbers } from "@/lib/restaurant-numbering";

/**
 * Runs once at the app root (not per page) so the realtime channel and sync
 * timers survive navigation between Billing, Tables, Kitchen and the rest.
 */
export function LiveSync() {
  const user = useStaff().user;
  const restaurantId = user?.restaurantId ?? null;
  const preparesNumbers = user?.role === "owner" || user?.role === "manager" || user?.role === "cashier" || user?.role === "captain";
  useEffect(() => {
    if (!restaurantId) return;
    return startLiveSync(restaurantId);
  }, [restaurantId]);
  useEffect(() => {
    if (!restaurantId || !preparesNumbers) return;
    const refill = () => { void prepareOfflineNumbers().catch(() => { /* Existing reserves remain usable offline. */ }); };
    refill();
    window.addEventListener("online", refill);
    const timer = window.setInterval(refill, 60_000);
    return () => { window.removeEventListener("online", refill); window.clearInterval(timer); };
  }, [restaurantId, preparesNumbers]);
  return null;
}
