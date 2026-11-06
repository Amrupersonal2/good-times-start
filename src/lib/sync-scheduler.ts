/**
 * When to sync next. Pure timing logic with injectable timers, so it can be
 * tested without a browser:
 *
 * - A request never pushes an earlier sync back. A busy counter making edits
 *   every half second still syncs within `maxDelay` (the old debounce could
 *   keep postponing it for as long as edits kept coming).
 * - After a failed sync, retry with growing gaps (2 s, 5 s, 15 s, 30 s, 60 s)
 *   instead of waiting for the next minute's poll.
 * - Poll every 15 s while the live connection is down, every 60 s while it's up.
 */

export interface Timers {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export const RETRY_DELAYS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
export const POLL_LIVE = 60_000;
export const POLL_DOWN = 15_000;

export function retryDelay(failures: number): number {
  return RETRY_DELAYS[Math.min(Math.max(failures, 1), RETRY_DELAYS.length) - 1] ?? 60_000;
}

export class SyncScheduler {
  private handle: unknown = null;
  private due = Infinity;
  private failures = 0;
  private running = false;
  private again = false;
  private stopped = false;
  private live = false;

  constructor(private readonly run: () => Promise<void>, private readonly timers: Timers, private readonly maxDelay = 2_000) {}

  /** Ask for a sync within `delay` ms. Earlier requests win. */
  request(delay = 0): void {
    if (this.stopped) return;
    if (this.running) { this.again = true; return; }
    const at = this.timers.now() + Math.min(Math.max(0, delay), this.maxDelay);
    if (at >= this.due) return;
    this.arm(at);
  }

  /** Realtime connection up or down: changes how often we poll. */
  setLive(live: boolean): void {
    this.live = live;
    if (!this.running && this.due === Infinity) this.arm(this.timers.now() + this.pollDelay());
  }

  get consecutiveFailures(): number { return this.failures; }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.handle = null;
    this.due = Infinity;
  }

  private pollDelay(): number { return this.live ? POLL_LIVE : POLL_DOWN; }

  private arm(at: number): void {
    if (this.handle !== null) this.timers.clearTimeout(this.handle);
    this.due = at;
    this.handle = this.timers.setTimeout(() => { void this.fire(); }, Math.max(0, at - this.timers.now()));
  }

  private async fire(): Promise<void> {
    this.handle = null;
    this.due = Infinity;
    if (this.stopped) return;
    this.running = true;
    this.again = false;
    let ok = true;
    try { await this.run(); } catch { ok = false; }
    this.running = false;
    if (this.stopped) return;
    if (ok) {
      this.failures = 0;
      this.arm(this.timers.now() + (this.again ? 0 : this.pollDelay()));
    } else {
      this.failures += 1;
      this.arm(this.timers.now() + (this.again ? Math.min(retryDelay(this.failures), 2_000) : retryDelay(this.failures)));
    }
  }
}
