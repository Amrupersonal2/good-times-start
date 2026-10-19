import { describe, expect, it } from "vitest";
import { buildPrintSheet, qrInk, accentFor } from "./qr-print";
import { contrastRatio } from "./marketing-logic";

const card = { label: "Table 4", url: "https://x/order/tab?table=T4&s=t4", qr: "data:image/png;base64,AAAA" };
const opts = { restaurant: "TAB <Bistro>", brand: { color: "#0f766e", tagline: "Fresh & local", links: { instagram: "https://instagram.com/tab.bistro/" }, whatsapp: "919876543210" }, headline: "Scan to order", subline: "Scan · Order · Relax" };

describe("printable QR material", () => {
  it("escapes text and shows the table, handle and WhatsApp", () => {
    const html = buildPrintSheet("tent", [card], opts);
    expect(html).toContain("TAB &lt;Bistro&gt;");
    expect(html).toContain("Fresh &amp; local");
    expect(html).toContain("Table 4");
    expect(html).toContain("@tab.bistro");
    expect(html).toContain("WhatsApp +919876543210");
    expect(html).not.toContain("<Bistro>");
  });

  it("prints a tent with one upside-down panel so both sides read once folded", () => {
    const html = buildPrintSheet("tent", [card, { ...card, label: "Table 5" }], opts);
    expect(html.match(/class="tent"/g)).toHaveLength(2);
    expect(html.match(/class="panel flip"/g)).toHaveLength(2);
  });

  it("never embeds anything but our own images", () => {
    const html = buildPrintSheet("poster", [card], { ...opts, brand: { ...opts.brand, logo: "javascript:alert(1)", cover: "https://evil/x.png" } });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("evil");
  });

  it("keeps QR codes dark enough to scan", () => {
    for (const color of ["#ffeb3b", "#0f766e", "#1d1d1f", undefined]) {
      expect(contrastRatio(qrInk({ ...(color ? { color } : {}) }), "#ffffff")).toBeGreaterThanOrEqual(7);
    }
    expect(accentFor({})).toBe("#1d1d1f");
  });

  it("features an offer on posters and standees", () => {
    expect(buildPrintSheet("poster", [card], { ...opts, offer: "Chai + bun ₹99" })).toContain("Chai + bun ₹99");
    expect(buildPrintSheet("standee", [card], { ...opts, offer: "Chai + bun ₹99" })).toContain("offer small");
  });
});
