import { supabase } from "@/integrations/supabase/client";
import { getDb } from "./db";
import { syncCloudData } from "./cloud-sync";
import { financialYear } from "./billing";

export function ownerCanReset(role: string | undefined): boolean { return role === "owner"; }

export function resetSequence(keep: boolean): number { return keep ? 1 : 0; }

/** A reset is online and owner-authorized; normal checkout stays entirely offline. */
export async function resetBillNumbers(restaurantId: string, role: string, retainedUid?: string): Promise<void> {
  if (!ownerCanReset(role)) throw new Error("Only the owner can reset bill numbers");
  if (!navigator.onLine) throw new Error("Connect to the internet before resetting bill numbers");
  await syncCloudData(restaurantId);
  const db = getDb();
  const retained = retainedUid ? await db.orders.where("uid").equals(retainedUid).first() : undefined;
  if (retainedUid && !retained) throw new Error("The retained bill is not loaded yet");
  const source = retained?.billNo.split("/")[0] ?? (await db.meta.get("deviceCode"))?.value;
  if (typeof source !== "string") throw new Error("Counter series is not ready");
  const { error } = await supabase.rpc("reset_counter_bill_numbers", {
    _restaurant: restaurantId, _source: source, _year: financialYear(new Date()), ...(retainedUid ? { _keep: retainedUid } : {}),
  });
  if (error) throw new Error(error.message);
  // Bind this counter to the retained bill's original series. Other devices with
  // that series receive the same durable mapping on their next sync.
  await db.meta.put({ key: "deviceCode", value: source });
  await db.meta.put({ key: "billSeq", value: resetSequence(Boolean(retainedUid)) });
  await syncCloudData(restaurantId);
}