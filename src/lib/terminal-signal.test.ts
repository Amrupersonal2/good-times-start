import { afterEach, describe, expect, it, vi } from "vitest";
import {
  broadcastSyncAll, channelName, CHECK_APP_UPDATE_EVENT, handleSyncAll, REMOTE_SYNC_EVENT,
  setSignalTransport, shouldAnnounceUpdate, shouldHandleSignal, SIGNAL_MIN_GAP_MS,
} from "./terminal-signal";

afterEach(() => setSignalTransport(null));

describe("terminal sync signal", () => {
  it("every terminal of a restaurant shares one channel", () => {
    expect(channelName("r1")).toBe("terminals-r1");
    expect(channelName("r1")).toBe(channelName("r1"));
    expect(channelName("r2")).not.toBe(channelName("r1"));
  });

  it("on the signal a terminal syncs data, checks for an app update and refreshes bookings", () => {
    const onSync = vi.fn();
    const target = new EventTarget();
    const seen: string[] = [];
    target.addEventListener(CHECK_APP_UPDATE_EVENT, (e) => seen.push(`${e.type}:${String((e as CustomEvent<{ remote?: boolean }>).detail.remote)}`));
    target.addEventListener(REMOTE_SYNC_EVENT, (e) => seen.push(e.type));
    handleSyncAll(onSync, target);
    expect(onSync).toHaveBeenCalledOnce();
    expect(seen).toEqual([`${CHECK_APP_UPDATE_EVENT}:true`, REMOTE_SYNC_EVENT]);
  });

  it("only the terminal that found the update itself announces it, so the signal never echoes", () => {
    expect(shouldAnnounceUpdate({ remote: false })).toBe(true);
    expect(shouldAnnounceUpdate(undefined)).toBe(true);
    expect(shouldAnnounceUpdate({ remote: true })).toBe(false);
  });

  it("broadcast reports whether the others were reached, and never throws", async () => {
    expect(await broadcastSyncAll("manual")).toBe(false); // not connected
    const send = vi.fn().mockResolvedValue("ok");
    setSignalTransport({ send });
    expect(await broadcastSyncAll("manual")).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ reason: "manual" }));
    setSignalTransport({ send: () => Promise.reject(new Error("socket down")) });
    expect(await broadcastSyncAll("update")).toBe(false);
  });

  it("ignores a flood of signals: at most one every few seconds", () => {
    expect(shouldHandleSignal(0, 10_000)).toBe(true);
    expect(shouldHandleSignal(10_000, 10_000 + SIGNAL_MIN_GAP_MS - 1)).toBe(false);
    expect(shouldHandleSignal(10_000, 10_000 + SIGNAL_MIN_GAP_MS)).toBe(true);
  });
});
