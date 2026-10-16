import { useEffect } from "react";
import { useStaff } from "@/lib/auth-context";
import { startLiveSync } from "@/lib/cloud-sync";

/**
 * Runs once at the app root (not per page) so the realtime channel and sync
 * timers survive navigation between Billing, Tables, Kitchen and the rest.
 */
export function LiveSync() {
  const restaurantId = useStaff().user?.restaurantId ?? null;
  useEffect(() => {
    if (!restaurantId) return;
    return startLiveSync(restaurantId);
  }, [restaurantId]);
  return null;
}
