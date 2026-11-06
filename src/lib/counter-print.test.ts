import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), put: vi.fn(), remove: vi.fn(), rows: [] as { key: string; value: string }[] }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('./db', () => ({ getDb: () => ({ meta: { put: mocks.put, delete: mocks.remove, where: () => ({ startsWith: () => ({ toArray: async () => mocks.rows }) }) } }) }));
vi.mock('./terminal-actions', () => ({ getDeviceId: async () => 'counter-device', touchTerminal: vi.fn() }));
vi.mock('./app-mode', () => ({ currentDevice: () => 'desktop' }));
import { flushCounterPrints } from './counter-print';
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; });
it('retains waiter print requests when no counter is configured', async () => {
  mocks.rows = [{ key: 'counterPrint:one', value: JSON.stringify({ id: 'one', restaurant: 'r', kind: 'kot', payload: [] }) }];
  mocks.rpc.mockResolvedValue({ error: { message: 'No connected counter' } });
  await flushCounterPrints('r');
  expect(mocks.remove).not.toHaveBeenCalledWith('counterPrint:one');
  expect(mocks.put).toHaveBeenCalledWith({ key: 'counterPrintError', value: 'No connected counter' });
});
it('removes only acknowledged commands and never sends another restaurant requests', async () => {
  mocks.rows = ['r', 'other'].map((restaurant) => ({ key: 'counterPrint:' + restaurant, value: JSON.stringify({ id: restaurant, restaurant, kind: 'bill', payload: { billNo: 'TBX/26-27/0001' } }) }));
  mocks.rpc.mockResolvedValue({ error: null });
  await flushCounterPrints('r');
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith('enqueue_counter_print', { _id: 'r', _restaurant: 'r', _kind: 'bill', _payload: { billNo: 'TBX/26-27/0001' } });
  expect(mocks.remove).toHaveBeenCalledWith('counterPrint:r');
  expect(mocks.remove).not.toHaveBeenCalledWith('counterPrint:other');
});