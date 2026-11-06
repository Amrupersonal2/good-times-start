import { describe, expect, it } from "vitest";
import {
  activeOffers, audienceCsv, audienceVcard, brandPalette, buildAudience, cleanSource, cleanUrl, contrastRatio, fillTemplate,
  pickRecipients, sanitizeBranding, scanSummary, sourceLabel, waLink, waNumber, withOptOut, type GuestProfile,
} from "./marketing-logic";
import { orderPageUrl } from "./guest-order-logic";
import type { Customer } from "./types";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-19T12:00:00Z");

describe("branding", () => {
  it("keeps only safe, publishable values", () => {
    const b = sanitizeBranding({
      color: "#0F766E", tagline: "  Fresh   from the pines  ", logo: "javascript:alert(1)", cover: "data:image/webp;base64,AAAA",
      links: { instagram: "@tab.bistro", googleReview: "g.page/r/abc", website: "javascript:alert(1)" },
      offers: [{ id: "", title: "  Chai + bun ₹99 ", until: "2026-10-20" }, { id: "x", title: "   " }],
      whatsapp: "98765 43210",
    });
    expect(b.color).toBe("#0f766e");
    expect(b.tagline).toBe("Fresh from the pines");
    expect(b.logo).toBeUndefined();
    expect(b.cover).toBe("data:image/webp;base64,AAAA");
    expect(b.links).toEqual({ instagram: "https://instagram.com/tab.bistro", googleReview: "https://g.page/r/abc" });
    expect(b.offers).toEqual([{ id: "chai-bun-99", title: "Chai + bun ₹99", until: "2026-10-20" }]);
    expect(b.whatsapp).toBe("919876543210");
    expect(b.askOptIn).toBe(true);
  });

  it("drops images that are too big for the guest page", () => {
    expect(sanitizeBranding({ logo: `data:image/png;base64,${"A".repeat(300_000)}` }).logo).toBeUndefined();
  });

  it("rejects links that aren't web addresses", () => {
    expect(cleanUrl("localhost")).toBeUndefined();
    expect(cleanUrl("ftp://x.com")).toBeUndefined();
    expect(cleanUrl("http://xtsy.one")).toBe("https://xtsy.one/");
  });

  it("hides offers after their last day, in India time", () => {
    const offers = [{ id: "a", title: "A", until: "2026-10-19" }, { id: "b", title: "B", until: "2026-10-18" }, { id: "c", title: "C" }];
    expect(activeOffers(offers, NOW).map((o) => o.id)).toEqual(["a", "c"]);
    // 11:30 pm on the 19th in India is still the 19th; 00:30 on the 20th is not.
    expect(activeOffers(offers, Date.parse("2026-10-19T18:00:00Z")).map((o) => o.id)).toEqual(["a", "c"]);
    expect(activeOffers(offers, Date.parse("2026-10-19T19:00:00Z")).map((o) => o.id)).toEqual(["c"]);
  });

  it("keeps button text readable whatever colour the owner picks", () => {
    for (const colour of ["#ffeb3b", "#ffffff", "#0f766e", "#b71c1c", "#87ceeb"]) {
      const p = brandPalette(colour)!;
      expect(contrastRatio(p["--primary"]!, p["--primary-foreground"]!)).toBeGreaterThanOrEqual(4.5);
    }
    expect(brandPalette("#0f766e")!["--primary"]).toBe("#0f766e"); // already readable: untouched
    expect(brandPalette("teal")).toBeNull();
  });
});

describe("WhatsApp", () => {
  it("adds India's code to 10-digit mobiles and rejects junk", () => {
    expect(waNumber("98765 43210")).toBe("919876543210");
    expect(waNumber("+91 98765-43210")).toBe("919876543210");
    expect(waNumber("09876543210")).toBe("919876543210");
    expect(waNumber("12345")).toBeNull();
    expect(waNumber("1234567890")).toBeNull(); // not an Indian mobile
    expect(waNumber("+44 7700 900123")).toBe("447700900123");
  });

  it("builds a ready-to-send link", () => {
    expect(waLink("9876543210", "Hi & bye")).toBe("https://wa.me/919876543210?text=Hi%20%26%20bye");
  });

  it("fills message placeholders and falls back politely", () => {
    expect(fillTemplate("Hi {first}! {offer} at {restaurant}: {link}", { name: "Asha Rani", restaurant: "TAB Bistro", offer: "Chai ₹49", link: "https://x.y/o" }))
      .toBe("Hi Asha! Chai ₹49 at TAB Bistro: https://x.y/o");
    expect(fillTemplate("Hi {name}, {unknown}", {})).toBe("Hi there, {unknown}");
  });

  it("adds a way to stop messages, once", () => {
    expect(withOptOut("Hello")).toBe("Hello\n\nReply STOP to stop offers.");
    expect(withOptOut("Hello. Reply STOP to unsubscribe")).toBe("Hello. Reply STOP to unsubscribe");
  });
});

describe("audience", () => {
  const customers: Customer[] = [
    { id: "9000000001", phone: "9000000001", name: "Regular Ravi", createdAt: 0, whatsapp: { optIn: true, at: 0 } },
    { id: "9000000002", phone: "9000000002", name: "Lapsed Lata", createdAt: 0, whatsapp: { optIn: true, at: 0 } },
    { id: "9000000003", phone: "9000000003", name: "No-consent Neel", createdAt: 0 },
    { id: "9000000004", phone: "9000000004", name: "New Nisha", createdAt: 0, whatsapp: { optIn: true, at: 0, lastMessagedAt: NOW - DAY } },
    { id: "1000000005", phone: "1000000005", name: "Bad Number", createdAt: 0, whatsapp: { optIn: true, at: 0 } },
  ];
  const bill = (customerId: string, daysAgo: number, total: number, source?: "qr") => ({ customerId, status: "settled" as const, total, createdAt: NOW - daysAgo * DAY, ...(source ? { source } : {}) });
  const orders = [
    ...[2, 9, 16, 23].map((d) => bill("9000000001", d, 800)),
    bill("9000000002", 60, 400),
    bill("9000000003", 3, 5000),
    bill("9000000004", 5, 300, "qr"),
    { customerId: "9000000001", status: "void" as const, total: 9999, createdAt: NOW },
  ];
  const guests: GuestProfile[] = buildAudience(customers, orders);

  it("counts settled visits and spend only", () => {
    const ravi = guests.find((g) => g.id === "9000000001")!;
    expect(ravi.visits).toBe(4);
    expect(ravi.spend).toBe(3200);
    expect(guests.find((g) => g.id === "9000000004")!.ordersOnline).toBe(1);
  });

  it("only messages guests who agreed, never twice in the cool-down, and only real numbers", () => {
    const { ready, skipped } = pickRecipients(guests, "all", NOW);
    expect(ready.map((r) => r.name)).toEqual(["Lapsed Lata", "Regular Ravi"]);
    expect(Object.fromEntries(skipped.map((s) => [s.guest.name, s.reason]))).toEqual({
      "No-consent Neel": "no consent", "New Nisha": "messaged recently", "Bad Number": "no valid number",
    });
    expect(pickRecipients(guests, "all", NOW, 0).ready.map((r) => r.name)).toContain("New Nisha");
  });

  it("finds each segment", () => {
    const names = (seg: Parameters<typeof pickRecipients>[1]) => pickRecipients(guests, seg, NOW, 0).ready.map((r) => r.name);
    expect(names("recent")).toEqual(["New Nisha", "Regular Ravi"]);
    expect(names("lapsed")).toEqual(["Lapsed Lata"]);
    expect(names("regulars")).toEqual(["Regular Ravi"]);
    expect(names("new")).toEqual(["New Nisha"]);
    expect(names("ordered-online")).toEqual(["New Nisha"]);
    // Neel spent most but never agreed, so the top-spender campaign skips him.
    expect(names("top")).toEqual([]);
  });

  it("exports contacts safely", () => {
    const r = [{ id: "1", phone: "9000000001", wa: "919000000001", name: "=HYPERLINK(\"x\")" }];
    expect(audienceCsv(r)).toBe("Name,WhatsApp\n\"'=HYPERLINK(\"\"x\"\")\",+919000000001");
    expect(audienceVcard([{ ...r[0]!, name: "Asha, R" }], "TAB")).toContain("FN:Asha\\, R (TAB)\r\nTEL;TYPE=CELL:+919000000001");
  });
});

describe("QR sources", () => {
  it("labels and totals scans, with orders per scan", () => {
    const rows = [{ day: "2026-10-18", source: "t1", scans: 4 }, { day: "2026-10-19", source: "t1", scans: 6 }, { day: "2026-10-19", source: "poster", scans: 2 }];
    expect(scanSummary(rows, new Map([["t1", 3], ["poster", 5]]))).toEqual([
      { source: "t1", scans: 10, orders: 3, rate: 0.3 },
      { source: "poster", scans: 2, orders: 5, rate: 1 },
    ]);
    expect(sourceLabel("t1", [{ id: "T1", label: "1" }])).toBe("Table 1");
    expect(sourceLabel("insta", [])).toBe("Instagram");
    expect(cleanSource("Insta Story!")).toBe("instastory");
  });

  it("puts the source into the QR link", () => {
    expect(orderPageUrl("https://pos.xtsy.one/", "tab", "T 1", "t1")).toBe("https://pos.xtsy.one/order/tab?table=T%201&s=t1");
    expect(orderPageUrl("https://pos.xtsy.one", "tab", undefined, "poster")).toBe("https://pos.xtsy.one/order/tab?s=poster");
    expect(orderPageUrl("https://pos.xtsy.one", "tab")).toBe("https://pos.xtsy.one/order/tab");
  });
});
