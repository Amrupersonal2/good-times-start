import { supabase } from '@/integrations/supabase/client';
import { getDb } from './db';
import { getDeviceId, touchTerminal } from './terminal-actions';
import { currentDevice } from './app-mode';
import type { Kot, Order } from './types';

interface PendingPrint { id: string; restaurant: string; kind: 'bill' | 'kot'; payload: Order | Kot[] }
const PREFIX = 'counterPrint:';
let flushing = false;

/** Explicit commands have their own durable outbox; order mirrors never print. */
export async function queueCounterPrint(restaurant: string, kind: PendingPrint['kind'], payload: PendingPrint['payload']): Promise<void> {
  const job: PendingPrint = { id: crypto.randomUUID(), restaurant, kind, payload };
  await getDb().meta.put({ key: PREFIX + job.id, value: JSON.stringify(job) });
  void flushCounterPrints(restaurant);
}

export async function flushCounterPrints(restaurant: string): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    const rows = await getDb().meta.where('key').startsWith(PREFIX).toArray();
    for (const row of rows) {
      if (typeof row.value !== 'string') continue;
      const job = JSON.parse(row.value) as PendingPrint;
      if (job.restaurant !== restaurant) continue;
      const { error } = await supabase.rpc('enqueue_counter_print', { _id: job.id, _restaurant: restaurant, _kind: job.kind, _payload: JSON.parse(JSON.stringify(job.payload)) });
      if (error) throw new Error(error.message);
      await getDb().meta.delete(row.key);
    }
    await getDb().meta.delete('counterPrintError');
  } catch (error) {
    await getDb().meta.put({ key: 'counterPrintError', value: error instanceof Error ? error.message : 'Counter printing connection unavailable' });
  } finally { flushing = false; }
}

export async function designateCounterPrinter(restaurant: string): Promise<void> {
  await touchTerminal(restaurant, 'pos', currentDevice());
  const { error } = await supabase.rpc('configure_counter_printer', { _restaurant: restaurant, _device: await getDeviceId() });
  if (error) throw new Error(error.message);
}