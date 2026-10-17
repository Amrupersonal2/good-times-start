import { describe, expect, it } from "vitest";
import { dropdownGroups, filterOptions } from "./dropdown-logic";

const opts = [
  { value: "t1", label: "T1", group: "Main" },
  { value: "r1", label: "R1", group: "Rooftop" },
  { value: "t2", label: "T2", group: "Main" },
  { value: "pn", label: "Paneer", hint: "kg" },
  { value: "bp", label: "Butter paneer masala" },
  { value: "ch", label: "Chicken (boneless)" },
];

describe("dropdown", () => {
  it("keeps groups together in first-seen order", () => {
    expect(dropdownGroups(opts.slice(0, 3)).map(([g, items]) => [g, items.map((o) => o.value)])).toEqual([["Main", ["t1", "t2"]], ["Rooftop", ["r1"]]]);
  });
  it("ranks a label that starts with the search above one that only contains it", () => {
    expect(filterOptions(opts, "pan").map((o) => o.value)).toEqual(["pn", "bp"]);
    expect(filterOptions(opts, "bone").map((o) => o.value)).toEqual(["ch"]);
    expect(filterOptions(opts, "roof").map((o) => o.value)).toEqual(["r1"]);
    expect(filterOptions(opts, "zzz")).toEqual([]);
    expect(filterOptions(opts, " ").length).toBe(opts.length);
  });
});
