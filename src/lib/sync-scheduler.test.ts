import { describe, expect, it } from "vitest";
import { POLL_DOWN, POLL_LIVE, SyncScheduler, retryDelay, type Timers } from "./sync-scheduler";

/** A hand-driven clock: timers fire only when the test moves time on. */
function clock() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    now: () => now,
    setTimeout: (fn, ms) => { seq += 1; pending.set(seq, { at: now + ms, fn }); return seq; },
    clearTimeout: (h) => { pending.delete(h as number); },
  };
  const advance = async (ms: number) => {
    const end = now + ms;
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    }
    now = end;
  };
  return { timers, advance, get now() { return now; } };
}

describe("sync scheduler", () => {
  it("still syncs within 2 seconds while edits keep coming every half second", async () => {
    const c = clock();
    const runs: number[] = [];
    const s = new SyncScheduler(async () => { runs.push(c.now); }, c.timers);
    for (let t = 0; t < 6000; t += 500) { s.request(800); await c.advance(500); }
    // The old debounce would never have fired during this burst.
    expect(runs.length).toBeGreaterThanOrEqual(3);
    expect(runs[0]).toBeLessThanOrEqual(800);
    s.stop();
  });

  it("an urgent request jumps ahead of a later one, never the other way round", async () => {
    const c = clock();
    const runs: number[] = [];
    const s = new SyncScheduler(async () => { runs.push(c.now); }, c.timers);
    s.request(800);
    s.request(0);
    s.request(800);
    await c.advance(10);
    expect(runs).toEqual([0]);
    s.stop();
  });

  it("retries a failing sync at 2, 5, 15, 30 and 60 seconds, then polls normally once it works", async () => {
    const c = clock();
    const runs: number[] = [];
    let failing = true;
    const s = new SyncScheduler(async () => { runs.push(c.now); if (failing) throw new Error("down"); }, c.timers);
    s.request(0);
    await c.advance(0 + 2_000 + 5_000 + 15_000 + 30_000 + 60_000 + 1);
    expect(runs.map((t, i) => (i ? t - (runs[i - 1] ?? 0) : t))).toEqual([0, 2_000, 5_000, 15_000, 30_000, 60_000]);
    expect(s.consecutiveFailures).toBe(6);
    failing = false;
    s.request(0);
    await c.advance(1);
    expect(s.consecutiveFailures).toBe(0);
    s.stop();
  });

  it("polls every 15 s while the live connection is down and every 60 s while it's up", async () => {
    const c = clock();
    const runs: number[] = [];
    const s = new SyncScheduler(async () => { runs.push(c.now); }, c.timers);
    s.setLive(false);
    await c.advance(45_000);
    expect(runs).toEqual([POLL_DOWN, 2 * POLL_DOWN, 3 * POLL_DOWN]);
    s.setLive(true);
    runs.length = 0;
    await c.advance(15_000 + POLL_LIVE);
    expect(runs).toEqual([60_000, 60_000 + POLL_LIVE]);
    s.stop();
  });

  it("runs again straight after a sync when an edit lands mid-sync, and stops cleanly", async () => {
    const c = clock();
    let release: (() => void) | undefined;
    let count = 0;
    const s = new SyncScheduler(() => { count += 1; return new Promise<void>((r) => { release = r; }); }, c.timers);
    s.request(0);
    await c.advance(1);
    s.request(0); // an edit while the first sync is still running
    release?.();
    await c.advance(1);
    expect(count).toBe(2);
    release?.();
    s.stop();
    await c.advance(120_000);
    expect(count).toBe(2);
  });

  it("caps the retry gap at a minute", () => {
    expect(retryDelay(1)).toBe(2_000);
    expect(retryDelay(99)).toBe(60_000);
  });
});
