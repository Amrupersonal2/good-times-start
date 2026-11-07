import { describe, expect, it } from "vitest";
import { nextOfflineNumber, parseSequence } from "./counter-offline-numbering";

describe("counter offline numbering", () => {
  it("continues from the last synced bill number", () => {
    expect(nextOfflineNumber("POS", 4).number).toBe("POS/0005");
  });
  it("continues from the last synced KOT number", () => {
    expect(nextOfflineNumber("KOT", parseSequence("KOT/0019")).number).toBe("KOT/0020");
  });
});
