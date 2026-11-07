import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINT_CONFIG } from "@/lib/print-logic";

const state = vi.hoisted(() => ({ silent: false, restaurantId: undefined as string | undefined, sync: vi.fn(async () => undefined) }));
vi.mock("@/lib/print-config", () => ({
  usePrintConfig: () => ({ ...DEFAULT_PRINT_CONFIG, silentBrowserReady: state.silent }),
}));
vi.mock("@/lib/db", async (load) => ({
  ...(await load<typeof import("@/lib/db")>()),
  getDb: () => ({ meta: { get: async (key: string) => (key === "restaurantId" && state.restaurantId ? { key, value: state.restaurantId } : undefined) } }),
}));
vi.mock("@/lib/cloud-sync", () => ({ syncCloudData: state.sync }));
import { PrintHost, printDocuments } from "./PrintHost";

afterEach(() => {
  act(() => window.dispatchEvent(new Event("afterprint")));
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  state.restaurantId = undefined;
});

describe("explicit counter browser printing", () => {
  it.each([false, true])("dispatches once with silent setup %s; afterprint never replays", async (silent) => {
    state.silent = silent;
    vi.useFakeTimers();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintHost />);
    act(() => printDocuments([<div key="test">Unsaved printer check</div>]));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(print).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event("afterprint")));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("sends the bill to the cloud before printing, but never waits more than 4 s", async () => {
    vi.useFakeTimers();
    state.restaurantId = "restaurant-id";
    state.sync.mockImplementation(() => new Promise(() => {})); // the internet hangs
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintHost />);
    act(() => printDocuments([<div key="test">KOT</div>]));
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(state.sync).toHaveBeenCalledWith("restaurant-id");
    expect(print).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(print).toHaveBeenCalledTimes(1);
  });
});
