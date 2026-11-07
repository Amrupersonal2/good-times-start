import { supabase } from "@/integrations/supabase/client";

/**
 * One "sync everything" signal shared by every open terminal of a restaurant (counter, waiter,
 * Business Manager). Sent when someone taps Sync now, and when any terminal is the first to spot a
 * newly published app version. Receivers sync their data at once and check for the new version,
 * so one tap (or one terminal noticing) brings the whole restaurant up to date within seconds.
 * The signal carries no data and no instructions beyond "check now": every terminal still uses its
 * own normal sync and update rules (unsent edits kept, updates only when idle or tapped).
 */

export const SYNC_ALL_EVENT = "sync-all";
/** Ask this page's update watcher to check now. detail.remote: true when another terminal asked. */
export const CHECK_APP_UPDATE_EVENT = "xtsy:check-app-update";
/** The update watcher found a newer version. detail.remote: true when the check came from another terminal. */
export const APP_UPDATE_FOUND_EVENT = "xtsy:app-update-found";
/** Another terminal asked everyone to sync (screens refresh their non-record data, e.g. Bookings). */
export const REMOTE_SYNC_EVENT = "xtsy:remote-sync";

export type SyncAllReason = "manual" | "update";
export interface SignalTransport { send: (payload: { reason: SyncAllReason; at: number }) => Promise<unknown> }

let transport: SignalTransport | null = null;

export function channelName(restaurantId: string): string {
  return `terminals-${restaurantId}`;
}

/** What a terminal does when the signal arrives. Exported for tests. */
export function handleSyncAll(onSync: () => void, target: Pick<EventTarget, "dispatchEvent"> = window): void {
  onSync();
  target.dispatchEvent(new CustomEvent(CHECK_APP_UPDATE_EVENT, { detail: { remote: true } }));
  target.dispatchEvent(new CustomEvent(REMOTE_SYNC_EVENT));
}

/** Only a terminal that found the update itself tells the others, so the signal never echoes around. */
export function shouldAnnounceUpdate(detail: unknown): boolean {
  return !(typeof detail === "object" && detail !== null && (detail as { remote?: unknown }).remote === true);
}

/** Tell every other open terminal to sync data and check for a newer app now. */
export async function broadcastSyncAll(reason: SyncAllReason): Promise<boolean> {
  if (!transport) return false;
  try {
    await transport.send({ reason, at: Date.now() });
    return true;
  } catch {
    return false;
  }
}

/** Test hook: replace the live channel. */
export function setSignalTransport(next: SignalTransport | null): void {
  transport = next;
}

/** Join the restaurant's terminal channel. Returns a stop function. */
export function startTerminalSignals(restaurantId: string, onSync: () => void): () => void {
  const channel = supabase.channel(channelName(restaurantId), { config: { broadcast: { self: false } } });
  channel.on("broadcast", { event: SYNC_ALL_EVENT }, () => handleSyncAll(onSync));
  channel.subscribe();
  const mine: SignalTransport = {
    send: (payload) => channel.send({ type: "broadcast", event: SYNC_ALL_EVENT, payload }),
  };
  transport = mine;
  const onFound = (event: Event) => {
    if (shouldAnnounceUpdate((event as CustomEvent).detail)) void broadcastSyncAll("update");
  };
  window.addEventListener(APP_UPDATE_FOUND_EVENT, onFound);
  return () => {
    window.removeEventListener(APP_UPDATE_FOUND_EVENT, onFound);
    if (transport === mine) transport = null;
    void supabase.removeChannel(channel);
  };
}
