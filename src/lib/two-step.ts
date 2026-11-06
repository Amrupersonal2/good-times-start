/**
 * Two-step actions: the first press arms an action, a second press within a
 * few seconds does it. Only one action is armed at a time across the app, so a
 * stray tap anywhere else simply disarms it. Used for settling bills, sending
 * KOTs, accepting orders and every other action that commits something.
 */

export const ARM_MS = 4_000;

type Listener = () => void;
let armedKey: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<Listener>();

function emit() { for (const l of listeners) l(); }

export function armed(): string | null { return armedKey; }

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function disarm(key?: string): void {
  if (key !== undefined && armedKey !== key) return;
  if (timer) clearTimeout(timer);
  timer = null;
  if (armedKey !== null) { armedKey = null; emit(); }
}

/**
 * Press an action's button (or its shortcut key). Returns true when this press
 * should run the action, false when it only armed it.
 */
export function press(key: string, ms = ARM_MS): boolean {
  if (armedKey === key) { disarm(); return true; }
  if (timer) clearTimeout(timer);
  armedKey = key;
  timer = setTimeout(() => disarm(key), ms);
  emit();
  return false;
}
