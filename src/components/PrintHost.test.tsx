import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PRINT_CONFIG } from "@/lib/print-logic";

const state = vi.hoisted(() => ({ silent: false }));
vi.mock("@/lib/print-config", () => ({
  usePrintConfig: () => ({ ...DEFAULT_PRINT_CONFIG, silentBrowserReady: state.silent }),
}));
import { PrintHost, printDocuments } from "./PrintHost";

afterEach(() => {
  act(() => window.dispatchEvent(new Event("afterprint")));
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("explicit counter browser printing", () => {
  it.each([false, true])("dispatches once with silent setup %s; afterprint never replays", (silent) => {
    state.silent = silent;
    vi.useFakeTimers();
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<PrintHost />);
    act(() => printDocuments([<div key="test">Unsaved printer check</div>]));
    act(() => vi.advanceTimersByTime(450));
    expect(print).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event("afterprint")));
    act(() => vi.advanceTimersByTime(2000));
    expect(print).toHaveBeenCalledTimes(1);
  });
});