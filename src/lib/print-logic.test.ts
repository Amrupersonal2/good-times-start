import { describe, expect, it } from "vitest";
import { DEFAULT_PRINT_CONFIG, kotPrintGroups, kotsForDevice, normalisePrintConfig, printCss, withCopies } from "./print-logic";
import type { Kot } from "./types";

const kot = (station: string, kind: "order" | "cancel" = "order"): Kot => ({ orderId: 1, billNo: "C1/26-27/0001", station, kind, lines: [], status: "new", createdAt: 1 });

describe("printing", () => {
  it("fills in defaults and clamps bad values", () => {
    expect(normalisePrintConfig(null)).toEqual(DEFAULT_PRINT_CONFIG);
    expect(normalisePrintConfig({ paper: 58, kotCopies: 9, billCopies: -2, stations: ["Tandoor", 4] })).toMatchObject({ paper: 58, kotCopies: 5, billCopies: 0, stations: ["Tandoor"] });
  });

  it("prints only this device's stations", () => {
    const kots = [kot("Tandoor"), kot("Chinese"), kot("Beverages")];
    expect(kotsForDevice(kots, { ...DEFAULT_PRINT_CONFIG, stations: ["Tandoor", "Beverages"] }).map((k) => k.station)).toEqual(["Tandoor", "Beverages"]);
    expect(kotsForDevice(kots, DEFAULT_PRINT_CONFIG)).toHaveLength(3);
  });

  it("prints one ticket per station, or one combined ticket that never mixes cancellations", () => {
    const kots = [kot("Tandoor"), kot("Chinese"), kot("Chinese", "cancel")];
    expect(kotPrintGroups(kots, true)).toHaveLength(3);
    expect(kotPrintGroups(kots, false).map((g) => g.map((k) => k.station))).toEqual([["Tandoor", "Chinese"], ["Chinese"]]);
  });

  it("repeats documents for copies and sizes paper", () => {
    expect(withCopies(["a", "b"], 2)).toEqual(["a", "a", "b", "b"]);
    expect(withCopies(["a"], 0)).toEqual([]);
    expect(printCss(58)).toContain("size: 58mm auto");
    expect(printCss(58)).toContain("width: 48mm");
  });
});
