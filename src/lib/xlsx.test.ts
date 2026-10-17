import { describe, expect, it } from "vitest";
import { buildXlsx, columnIndex, columnLetter, crc32, readXlsx, safeSheetNames } from "./xlsx";

describe("xlsx", () => {
  it("names columns like Excel", () => {
    expect([0, 25, 26, 51, 52, 701, 702].map(columnLetter)).toEqual(["A", "Z", "AA", "AZ", "BA", "ZZ", "AAA"]);
    expect(columnIndex("AAA")).toBe(702);
  });

  it("computes zip CRCs", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("keeps sheet names legal and unique", () => {
    expect(safeSheetNames(["GST: 5%/18%", "gst  5% 18%", "A".repeat(40)])).toEqual(["GST  5% 18%", "gst  5% 18% 2", "A".repeat(31)]);
  });

  it("writes a workbook that reads back with values, totals and escaping intact", async () => {
    const bytes = buildXlsx([
      {
        name: "Sales",
        title: "TAB Bistro by XTSY",
        subtitle: "17-Oct-2026",
        columns: [{ header: "Item" }, { header: "Qty", format: "int", total: true }, { header: "Amount", format: "inr", total: true }, { header: "Veg" }],
        rows: [["Paneer Tikka", 2, 658, true], ["Fish & Chips <hot>", 1, 389.5, false], [null, 3, 0, null]],
        totals: true,
        notes: ["Prices before GST."],
      },
      { name: "Empty", columns: [{ header: "Nothing" }], rows: [] },
    ]);
    const sheets = await readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["Sales", "Empty"]);
    const rows = sheets[0]!.rows;
    expect(rows[0]?.[0]).toBe("TAB Bistro by XTSY");
    expect(rows[3]).toEqual(["Item", "Qty", "Amount", "Veg"]);
    expect(rows[4]).toEqual(["Paneer Tikka", 2, 658, true]);
    expect(rows[5]).toEqual(["Fish & Chips <hot>", 1, 389.5, false]);
    expect(rows[7]).toEqual(["Total", 6, 1047.5, null]);
    expect(rows[9]?.[0]).toBe("Prices before GST.");
  });

  it("reads files saved by other spreadsheet apps (compressed, shared strings)", async () => {
    const path = process.env["XLSX_FIXTURE"];
    if (!path) return;
    const file = Bun.file(path);
    const sheets = await readXlsx(new Uint8Array(await file.arrayBuffer()));
    expect(sheets[0]?.rows).toEqual([["Dish", "Category", "Price", "Veg"], ["Paneer Tikka", "Starters", 329, "Yes"], ["Chicken 65 & co <spicy>", "Starters", 299.5, "No"]]);
    expect(sheets[1]?.rows[2]).toEqual([null, null, "far cell"]);
  });
});
