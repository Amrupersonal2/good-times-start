import { describe, expect, it } from "vitest";
import { SEED_TABLES } from "./seed";

describe("floor defaults", () => {
  it("does not restore removed AC, Non-AC or Rooftop sections from sample data", () => {
    const sections = SEED_TABLES.map((table) => table.section);
    for (const removed of ["AC", "Non-AC", "Non AC", "Rooftop"]) expect(sections).not.toContain(removed);
    expect(SEED_TABLES.length).toBeGreaterThan(0);
  });
});