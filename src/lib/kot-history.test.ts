import { describe, expect, it } from "vitest";
import { kotNumber, kotSubmissions } from "./kot-history";
import type { Kot } from "./types";

const ticket = (station: string, at: number, orderUid = "room666"): Kot => ({ orderId: 1, billNo: "TBX/26-27/0001", orderUid, station, createdAt: at, lines: [{ name: "Chai", qty: 1 }], status: "new" });
describe("KOT submissions", () => {
  it("counts 13 station tickets as six sends, retaining the additional Room 10A send", () => {
    const rows = [ticket("A", 1), ticket("B", 1), ticket("C", 1), ticket("D", 2), ticket("E", 3), ticket("F", 3), ticket("G", 3), ticket("A", 4, "room7"), ticket("B", 4, "room7"), ticket("A", 5, "room10"), ticket("B", 5, "room10"), ticket("C", 5, "room10"), ticket("A", 6, "room10")];
    expect(kotSubmissions(rows)).toHaveLength(6);
    expect(kotSubmissions(rows).flatMap((s) => s.tickets)).toHaveLength(13);
  });
  it("keeps explicit sends separate even if their timestamps match", () => {
    expect(kotSubmissions([{ ...ticket("A", 1), submissionId: "one" }, { ...ticket("B", 1), submissionId: "two" }])).toHaveLength(2);
  });
  it("numbers KOTs separately by day and device, not by invoice", () => {
    expect(kotNumber("abcd1234-ffff", "2026-11-06", 1)).toBe("KOT/20261106/ABCD1234/0001");
    expect(kotNumber("efgh5678-ffff", "2026-11-06", 1)).not.toBe(kotNumber("abcd1234-ffff", "2026-11-06", 1));
  });
});