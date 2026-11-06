import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("./cloud-sync", () => ({ syncCloudData: vi.fn() }));
import { ownerCanReset, resetSequence, resetBillNumbers } from "./bill-number-reset";
import { billNumber } from "./billing";

describe("owner counter reset", () => {
  it("allows only owners", async () => {
    expect(ownerCanReset("owner")).toBe(true);
    for (const role of ["manager", "cashier", "captain", "kitchen", "unknown"]) {
      expect(ownerCanReset(role)).toBe(false);
      await expect(resetBillNumbers("restaurant", role)).rejects.toThrow("Only the owner");
    }
  });
  it("starts an empty counter at 0001", () => {
    expect(billNumber(resetSequence(false) + 1, new Date(2026, 10, 6), "TBX")).toBe("TBX/26-27/0001");
  });
  it("keeps 0001 and starts the next bill at 0002", () => {
    expect(billNumber(resetSequence(true), new Date(2026, 10, 6), "TBX")).toBe("TBX/26-27/0001");
    expect(billNumber(resetSequence(true) + 1, new Date(2026, 10, 6), "TBX")).toBe("TBX/26-27/0002");
  });
});