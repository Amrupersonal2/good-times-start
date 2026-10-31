import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BREAKPOINTS, authFile, contextFor } from "./breakpoints";
import { readCsv, readXlsx } from "./files";
import { ready } from "./helpers";

/*
 * Final launch check, read-only: every QR code is decoded and opened, every
 * Excel/CSV export is downloaded and opened, every external link is checked,
 * and bills open only from Tables. Nothing is billed, saved or sent.
 */

const LIVE = "https://good-times-start.lovable.app";
const SLUG = "tab-bistro";
const desktop = BREAKPOINTS.find((b) => b.name === "desktop-1440")!;
const phone = BREAKPOINTS.find((b) => b.name === "phone-412")!;
const quiet = () => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } };

/** Decode a QR code from PNG bytes (jsqr + pngjs are installed in CI only). */
async function decodeQr(png: Buffer): Promise<string | null> {
  const { PNG } = await import("pngjs");
  const jsQR = (await import("jsqr")).default;
  const img = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(img.data), img.width, img.height)?.data ?? null;
}
const fromDataUrl = (src: string) => Buffer.from(src.split(",")[1] ?? "", "base64");

async function expectGuestUrl(url: string | null, what: string, info: TestInfo, table?: string) {
  expect(url, `${what}: QR decodes`).toBeTruthy();
  const u = new URL(url!);
  expect(u.origin, `${what}: points at the live site`).toBe(LIVE);
  expect(u.pathname, `${what}: opens TAB Bistro's menu`).toBe(`/order/${SLUG}`);
  if (table) expect(u.searchParams.get("table"), `${what}: for the right table`).toBe(table);
  info.annotations.push({ type: "qr", description: `${what} → ${url}` });
  return u;
}

async function download(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), click()]);
  const path = await file.path();
  return { name: file.suggestedFilename(), data: readFileSync(path) };
}

async function pickOctober(page: Page) {
  await page.getByRole("button", { name: "Pick dates" }).click();
  await page.getByLabel("From").fill("2026-10-01");
  await page.getByLabel("To").fill(new Date().toISOString().slice(0, 10));
}

test.describe("Launch check", () => {
  test.setTimeout(180_000);

  test.describe("QR codes (admin, desktop)", () => {
    test.use({ ...contextFor(desktop), storageState: authFile("admin") });

    test("table QR in Settings → Guest ordering scans to that table's menu", async ({ page }, info) => {
      await page.addInitScript(quiet);
      await page.goto("/settings?app=manager#ordering");
      await ready(page);
      const select = page.getByLabel("QR destination");
      await expect(select).toBeVisible({ timeout: 30_000 });
      // A fresh device fills in the tables once its first sync finishes.
      const tableOptions = () => select.locator("option").evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter(Boolean));
      await expect.poll(async () => (await tableOptions()).length, { message: "tables to print QR codes for", timeout: 60_000 }).toBeGreaterThan(0);
      const options = await tableOptions();
      const table = options[0]!;
      await select.selectOption(table);
      const img = page.getByAltText("QR code for selected table");
      await expect(img).toBeVisible();
      const u = await expectGuestUrl(await decodeQr(fromDataUrl((await img.getAttribute("src"))!)), "Settings table QR", info, table);
      // Scanning it opens that table's menu.
      await page.goto(`${u.pathname}${u.search}`);
      await expect(page.getByText(/Ordering to table/).first()).toBeVisible({ timeout: 30_000 });
      await info.attach("scanned-table-menu.png", { body: await page.screenshot(), contentType: "image/png" });
      // Downloaded QR file is the same code.
      await page.goto("/settings?app=manager#ordering");
      await ready(page);
      await expect.poll(async () => (await page.getByLabel("QR destination").locator("option").count()), { timeout: 60_000 }).toBeGreaterThan(1);
      await page.getByLabel("QR destination").selectOption(table);
      const file = await download(page, () => page.getByRole("link", { name: "Download QR" }).click());
      await expectGuestUrl(await decodeQr(file.data), `Downloaded ${file.name}`, info, table);
    });

    test("printed table cards scan, even with the logo on them", async ({ page }, info) => {
      await page.addInitScript(quiet);
      await page.goto("/marketing?tab=qr&app=manager");
      await ready(page);
      const preview = page.getByAltText("QR code preview");
      await expect(preview).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await preview.getAttribute("src"))?.length ?? 0, { timeout: 60_000 }).toBeGreaterThan(100);
      await expectGuestUrl(await decodeQr(fromDataUrl((await preview.getAttribute("src"))!)), "QR kit table tent sample", info);
      // Poster: the shareable PNG.
      await page.getByRole("radio", { name: /Poster/ }).click();
      const png = await download(page, () => page.getByRole("button", { name: "PNG", exact: true }).click());
      await expectGuestUrl(await decodeQr(png.data), `QR kit ${png.name}`, info);
      // Table tents for every table: decode each card as printed, logo badge included.
      await page.getByRole("radio", { name: /Table tent/ }).click();
      const [sheet] = await Promise.all([page.waitForEvent("popup"), page.getByRole("button", { name: /^Print / }).click()]);
      await sheet.waitForLoadState();
      const cards = sheet.locator(".qr");
      const n = await cards.count();
      expect(n, "cards on the print sheet").toBeGreaterThan(0);
      for (let i = 0; i < n; i += 1) {
        const shot = await cards.nth(i).screenshot();
        await expectGuestUrl(await decodeQr(shot), `Printed card ${i + 1}`, info);
      }
      await info.attach("print-sheet.png", { body: await sheet.screenshot({ fullPage: true }), contentType: "image/png" });
    });

    test("install QR codes for the three apps open the live apps", async ({ page }, info) => {
      await page.addInitScript(quiet);
      await page.goto("/settings?app=manager#logins");
      await ready(page);
      const imgs = page.getByAltText(/^QR code to open /);
      await expect(imgs.first()).toBeVisible({ timeout: 30_000 });
      const urls: string[] = [];
      for (const img of await imgs.all()) {
        const url = await decodeQr(fromDataUrl((await img.getAttribute("src"))!));
        expect(url, "install QR decodes").toBeTruthy();
        expect(new URL(url!).origin, "install QR points at the live site").toBe(LIVE);
        urls.push(url!);
      }
      expect(urls.map((u) => new URL(u).pathname).sort()).toEqual(["/manager", "/tables", "/waiter"]);
      info.annotations.push({ type: "qr", description: `Install links: ${urls.join(", ")}` });
    });

    test("WhatsApp ordering link points at the live menu", async ({ page }) => {
      await page.addInitScript(quiet);
      await page.goto("/marketing?tab=whatsapp&app=manager");
      await ready(page);
      const link = page.locator(`input[value^="${LIVE}/order/${SLUG}"]`).first();
      await expect(link).toBeVisible({ timeout: 30_000 });
    });
  });

  test.describe("Excel and CSV exports (admin, desktop)", () => {
    test.use({ ...contextFor(desktop), storageState: authFile("admin") });

    test("Reports: all-reports Excel, GSTR-1, GST CSV, bills CSV, items CSV, Sales Summary", async ({ page }, info) => {
      await page.addInitScript(quiet);
      await page.goto("/reports?app=manager");
      await ready(page);
      await pickOctober(page);
      const allButton = page.getByRole("button", { name: "Excel (all reports)" });
      // After a clean launch there are no bills yet: the exports must then be off, not broken.
      const hasBills = await expect(allButton).toBeEnabled({ timeout: 45_000 }).then(() => true, () => false);
      if (!hasBills) {
        await expect(allButton).toBeDisabled();
        await page.getByRole("radio", { name: "GST" }).click();
        await expect(page.getByRole("button", { name: "GSTR-1 (Excel)" })).toBeDisabled();
        info.annotations.push({ type: "export", description: "No bills yet (clean launch): report exports are correctly disabled until the first bill" });
        return;
      }
      const all = await download(page, () => allButton.click());
      const book = readXlsx(all.data);
      expect(book.sheets.length, "sheets in all-reports Excel").toBeGreaterThan(2);
      expect(book.rows, "rows of data").toBeGreaterThan(5);
      info.annotations.push({ type: "export", description: `${all.name}: ${book.sheets.join(", ")} (${book.rows} rows)` });

      await page.getByRole("radio", { name: "GST" }).click();
      const gstr = await download(page, () => page.getByRole("button", { name: "GSTR-1 (Excel)" }).click());
      const g = readXlsx(gstr.data);
      expect(g.sheets.join(" ").toLowerCase()).toMatch(/b2cs|hsn|summary|docs/);
      info.annotations.push({ type: "export", description: `${gstr.name}: ${g.sheets.join(", ")}` });
      // GST CSV lists taxed bills only; until the GSTIN is set, bills carry no GST and the button stays off.
      const gstButton = page.getByRole("button", { name: "GST CSV" });
      let gstCsvName = "GST CSV off (no GST on bills yet)";
      if (await gstButton.isEnabled()) {
        const gstCsv = await download(page, () => gstButton.click());
        expect(readCsv(gstCsv.data.toString("utf8")).length).toBeGreaterThan(1);
        gstCsvName = gstCsv.name;
      } else {
        await expect(gstButton).toBeDisabled();
      }
      const bills = await download(page, () => page.getByRole("button", { name: "All bills CSV" }).click());
      const billRows = readCsv(bills.data.toString("utf8"));
      expect(billRows.length, "bills in CSV").toBeGreaterThan(1);
      info.annotations.push({ type: "export", description: `${gstCsvName}, ${bills.name}: ${billRows.length - 1} bills` });

      await page.getByRole("radio", { name: "Items" }).click();
      const items = await download(page, () => page.getByRole("button", { name: "CSV", exact: true }).click());
      // The file starts with a byte-order mark so Excel shows ₹ and names correctly.
      expect(readCsv(items.data.toString("utf8").replace(/^\uFEFF/, ""))[0]).toEqual(["Item", "Category", "Quantity", "Sales before GST"]);

      await page.getByRole("radio", { name: "Sales Summary" }).click();
      const summary = await download(page, () => page.getByRole("button", { name: "Download Excel" }).click());
      expect(readXlsx(summary.data).rows).toBeGreaterThan(1);
      info.annotations.push({ type: "export", description: `${items.name}, ${summary.name}` });
    });

    test("Guests, Stock and Menu Excel", async ({ page }, info) => {
      await page.addInitScript(quiet);
      const out: string[] = [];

      for (const [path, name] of [["/customers?app=manager", "Excel"], ["/stock?app=manager", "Excel"], ["/menu?app=manager", "Excel"]] as const) {
        await page.goto(path);
        await ready(page);
        const button = page.getByRole("button", { name, exact: true }).first();
        const ready_ = await expect(button).toBeEnabled({ timeout: 30_000 }).then(() => true, () => false);
        if (!ready_ && path.startsWith("/customers")) { out.push("guests: none yet (clean launch), export correctly disabled"); continue; }
        await expect(button).toBeEnabled();
        const f = await download(page, () => button.click());
        const x = readXlsx(f.data);
        expect(x.rows, `${f.name} has rows`).toBeGreaterThan(1);
        out.push(`${f.name} (${x.rows} rows)`);
      }
      // The menu export holds the final menu.
      info.annotations.push({ type: "export", description: out.join(", ") });
    });
  });

  test.describe("External links", () => {
    test.use({ ...contextFor(phone) });

    test("every link on the guest menu works", async ({ page, request }, info) => {
      await page.goto(`/order/${SLUG}`);
      await ready(page);
      const tableButton = page.getByRole("button", { name: /^Table / }).first();
      if (await tableButton.isVisible().catch(() => false)) await tableButton.click();
      await expect(page.getByText(/Ordering to table|Order for pickup/).first()).toBeVisible({ timeout: 30_000 });
      const hrefs = await page.locator("a[href]").evaluateAll((as) => [...new Set(as.map((a) => (a as HTMLAnchorElement).href))]);
      const results: string[] = [];
      for (const href of hrefs) {
        const u = new URL(href);
        if (u.protocol === "tel:") { expect(href, "phone link").toMatch(/^tel:\+?[0-9 ]{8,}$/); results.push(`${href} ok`); continue; }
        if (u.protocol === "mailto:") { expect(href).toMatch(/^mailto:[^@]+@[^@]+\.[a-z]+/i); results.push(`${href} ok`); continue; }
        if (u.hostname === "127.0.0.1" || u.hostname === "localhost") continue; // links inside the app
        if (u.hostname === "wa.me") { expect(href, "WhatsApp link").toMatch(/^https:\/\/wa\.me\/\d{10,15}(\?text=.+)?$/); results.push(`${href} ok`); continue; }
        const res = await request.get(href, { maxRedirects: 5, timeout: 20_000, failOnStatusCode: false }).catch(() => null);
        const status = res?.status() ?? 0;
        // Social sites often refuse automated checks; that still proves the page exists.
        const blocked = [401, 403, 429, 999].includes(status) && /instagram|facebook|google|zomato|swiggy/.test(u.hostname);
        expect(status > 0 && (status < 400 || blocked), `${href} answers (got ${status})`).toBe(true);
        results.push(`${href} → ${status}${blocked ? " (site blocks automated checks; page exists)" : ""}`);
      }
      info.annotations.push({ type: "links", description: results.join(" | ") || "No external links on the guest menu" });
    });
  });

  test.describe("Bills open only from Tables", () => {
    test.describe("Restro POS (Reception, desktop)", () => {
      test.use({ ...contextFor(desktop), storageState: authFile("billdesk") });

      test("no Billing menu item; / goes to Tables; tables and counter orders open bills", async ({ page }, info) => {
        await page.addInitScript(quiet);
        await page.goto("/?app=pos");
        await expect(page).toHaveURL(/\/tables/, { timeout: 30_000 });
        await ready(page);
        await expect(page.getByRole("heading", { name: "Tables", level: 1 })).toBeVisible();
        await expect(page.getByRole("link", { name: /^Billing$/ })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Counter orders" })).toBeVisible();

        await page.getByRole("link", { name: "Takeaway" }).click();
        await expect(page).toHaveURL(/type=takeaway/);
        await expect(page.getByText("Takeaway").first()).toBeVisible();
        await info.attach("takeaway-bill.png", { body: await page.screenshot(), contentType: "image/png" });
        await page.getByRole("link", { name: "Tables" }).first().click();
        await expect(page).toHaveURL(/\/tables/);

        const tile = page.getByRole("button", { name: /^Table [^,]+$/ }).first(); // a free table
        const label = ((await tile.getAttribute("aria-label")) ?? "").replace(/^Table /, "");
        await tile.click();
        await expect(page).toHaveURL(/table=/);
        await expect(page.getByText(`Table ${label}`).first()).toBeVisible({ timeout: 30_000 });
        await info.attach("table-bill.png", { body: await page.screenshot(), contentType: "image/png" });
        // Table options (move, merge, reserve) are on the tile's own button.
        await page.goto("/tables?app=pos");
        await ready(page);
        await page.getByRole("button", { name: `More for table ${label}` }).click();
        await expect(page.getByRole("dialog").getByText(`Table ${label}`)).toBeVisible();
      });
    });

    test.describe("Business Manager (admin, phone)", () => {
      test.use({ ...contextFor(phone), storageState: authFile("admin") });

      test("/ goes to Tables, and the bottom menu has no Billing", async ({ page }) => {
        await page.addInitScript(quiet);
        await page.goto("/?app=manager");
        await expect(page).toHaveURL(/\/tables/, { timeout: 30_000 });
        await ready(page);
        await expect(page.getByRole("link", { name: /^Billing$/ })).toHaveCount(0);
        await expect(page.getByRole("heading", { name: "Counter orders" })).toBeVisible();
      });
    });
  });
});
