import type { AppKind } from './staff-login-logic';

export function thermalDestination(app: AppKind): 'counter' | 'local' | 'blocked' {
  return app === 'waiter' ? 'counter' : app === 'pos' ? 'local' : 'blocked';
}
export function managerSettingAllowed(app: AppKind, tab: string | null, to?: string): boolean {
  return app !== 'manager' || (tab !== 'printing' && tab !== 'device' && to !== '/tables');
}