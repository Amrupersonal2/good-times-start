import { describe, expect, it } from 'vitest';
import { managerSettingAllowed, thermalDestination } from './print-routing';
describe('printing separation', () => {
  it('routes wireless waiter slips only to the counter', () => { expect(thermalDestination('waiter')).toBe('counter'); });
  it('keeps POS slips local', () => { expect(thermalDestination('pos')).toBe('local'); });
  it('blocks manager thermal output', () => { expect(thermalDestination('manager')).toBe('blocked'); });
  it('denies manager printer settings', () => { expect(managerSettingAllowed('manager', 'printing')).toBe(false); });
  it('denies manager table settings', () => { expect(managerSettingAllowed('manager', null, '/tables')).toBe(false); });
  it('preserves manager report access', () => { expect(managerSettingAllowed('manager', null, '/reports')).toBe(true); });
});