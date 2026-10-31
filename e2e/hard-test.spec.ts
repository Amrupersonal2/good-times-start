import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { BREAKPOINTS, authFile, contextFor, type Breakpoint, type LoginName } from "./breakpoints";
import { readCsv } from "./files";
import { ready } from "./helpers";

/*
 * Hard test: billing maths, reports, KPI forecast, selections and scrolling, plus two-way sync.
 *
 * Billing, reports and the forecast run on a device that has synced and then gone offline, so the
 * test bills and the injected history stay on that throwaway browser and never reach the live books.
 * The two-way sync check does touch the live POS (one bill, cancelled at the end), so it runs only
 * with LIVE_ORDER=1, like the guest-order check, and its bill is cleaned up afterwards.
 */

test.setTimeout(240_000);
const bp = (name: string) => BREAKPOINTS.find((b) => b.name === name)!;
const quiet = () => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } };
const rupees = (text: string | null) => Number((text ?? "").replace(/[^\d.-]/g, "")) || 0;
const DAY = 86_400_000;

async function device(browser: Browser, baseURL: string | undefined, b: Breakpoint, login: LoginName): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ ...contextFor(b), baseURL, timezoneId: "Asia/Kolkata", locale: "en-IN", storageState: authFile(login), acceptDownloads: true });
  await context.addInitScript(quiet);
  return { context, page: await context.newPage() };
}

/** Wait until this device has finished syncing with the restaurant. */
async function synced(page: Page) {
  await ready(page);
  await expect(page.getByRole("button", { name: /^Sync status: (Live|Synced)/ })).toBeVisible({ timeout: 90_000 });
}

/** Value printed under a small label (KPI tiles and report stats). */
const valueUnder = (page: Page, label: string) => page.locator(`xpath=//*[not(self::button) and not(ancestor::button) and normalize-space(text())="${label}" and following-sibling::*]`).filter({ visible: true }).first().locator("xpath=following-sibling::*[1]");

async function download(page: Page, click: () => Promise<void>) {
  const [file] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), click()]);
  return { name: file.suggestedFilename(), data: readFileSync(await file.path()) };
}

async function nav(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: label, exact: true }).click();
  await ready(page);
}

test.describe("Hard test · billing and reports, offline", () => {
  for (const name of ["desktop-1440", "laptop-1280"]) {
    test(`a discounted takeaway bill adds up, settles offline, and reaches Reports, CSV and Dashboard (${name})`, async ({ browser, baseURL }, info) => {
      const { context, page } = await device(browser, baseURL, bp(name), "admin");
      await page.goto("/reports?app=manager");
      await synced(page);
      const before = { net: rupees(await valueUnder(page, "Net sales").textContent()), bills: Number(await valueUnder(page, "Bills").textContent()) };
      // A counter starts its day on Tables; that screen and the bill are then on the device.
      await page.goto("/tables?app=manager");
      await ready(page);
      await page.goto("/dashboard?app=manager");
      await ready(page);
      await page.waitForTimeout(8_000); // the other screens load in the background
      const dashBefore = rupees(await valueUnder(page, "Total sales").textContent());

      // The internet goes down; billing carries on.
      await context.setOffline(true);
      await expect(page.getByRole("button", { name: /^Sync status: Offline/ })).toBeVisible({ timeout: 15_000 });
      await nav(page, "Tables");
      await page.getByRole("link", { name: "Takeaway" }).click();
      const search = page.getByPlaceholder("Search dishes or codes (F4)");
      await expect(search).toBeVisible({ timeout: 30_000 });

      const picks: [string, number][] = [["Virgin Mojito", 2], ["Passion Fruit Mojito", 1], ["Steamed Rice", 1]];
      let subtotal = 0;
      for (const [dish, qty] of picks) {
        await search.fill(dish);
        const tile = page.locator(`button[title="${dish}"]`).first();
        await expect(tile).toBeEnabled({ timeout: 30_000 });
        const price = rupees(await tile.locator("span").last().textContent());
        expect(price, `${dish} has a price`).toBeGreaterThan(0);
        for (let i = 0; i < qty; i++) await tile.click();
        subtotal += price * qty;
      }
      await search.fill("");
      const totals = page.locator("dl").filter({ hasText: "Items" }).filter({ hasText: "Total" }).last();
      await expect(totals.getByText("4", { exact: true })).toBeVisible();

      // 10% discount, then GST as set up for the outlet (none until the GSTIN is added), rounded to the rupee.
      await page.getByRole("combobox", { name: "Discount" }).filter({ visible: true }).first().click();
      await page.getByRole("option", { name: "10%" }).click();
      const tax = rupees(await valueUnder(page, "Tax").textContent());
      const expected = Math.round(subtotal * 0.9 + tax);
      await expect(valueUnder(page, "Total")).toHaveText(new RegExp(`₹${expected.toLocaleString("en-IN")}$`));
      info.annotations.push({ type: "bill", description: `${name}: subtotal ₹${subtotal}, 10% off, tax ₹${tax} → ₹${expected}` });

      await page.getByRole("button", { name: /^KOT/ }).click();
      await page.getByRole("button", { name: /^Tap to send/ }).click();
      await page.getByRole("button", { name: /^Cash$/ }).click();
      await page.getByRole("button", { name: new RegExp(`Settle ₹${expected.toLocaleString("en-IN")}\\?`) }).click();
      // The receipt opens; closing it returns to the floor.
      const receipt = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: /^Bill \S+ settled$/ }) });
      await expect(receipt).toBeVisible({ timeout: 30_000 });
      await expect(receipt).toContainText(`₹${expected.toLocaleString("en-IN")}`);
      info.annotations.push({ type: "bill", description: `${name}: ${(await receipt.getByRole("heading").first().textContent())?.trim()} offline` });
      await info.attach(`receipt-${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("heading", { name: "Counter orders" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: /^Sync status: Offline/ })).toBeVisible();

      // Reports: today's net sales and bills move by exactly this bill.
      await nav(page, "Reports");
      await expect(valueUnder(page, "Net sales")).toHaveText(new RegExp(`₹${(before.net + expected).toLocaleString("en-IN")}$`));
      await expect(valueUnder(page, "Bills")).toHaveText(String(before.bills + 1));
      await page.getByRole("radio", { name: "GST" }).click();
      const csv = await download(page, () => page.getByRole("button", { name: "All bills CSV" }).click());
      const rows = readCsv(csv.data.toString("utf8").replace(/^﻿/, ""));
      const header = rows[0] ?? [];
      const totalCol = header.findIndex((h) => /^total/i.test(h));
      expect(totalCol, `bills CSV has a total column: ${header.join(", ")}`).toBeGreaterThanOrEqual(0);
      expect(rows.slice(1).some((r) => Number(r[totalCol]) === expected), "the new bill is in the CSV").toBe(true);

      // Dashboard: today's total sales move the same way.
      await nav(page, "Dashboard");
      await expect(valueUnder(page, "Total sales")).toHaveText(new RegExp(`₹${(dashBefore + expected).toLocaleString("en-IN")}$`));
      await info.attach(`bill-${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await context.close(); // still offline: the test bill never leaves this browser
    });
  }
});

test.describe("Hard test · KPI forecast", () => {
  test("forecast waits for history, then projects today and the month exactly as worked by hand", async ({ browser, baseURL }, info) => {
    const { context, page } = await device(browser, baseURL, bp("desktop-1440"), "admin");
    await page.goto("/dashboard?app=manager");
    await synced(page);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Forecast" }) });
    await expect(card).toBeVisible();
    const notReady = await card.getByText(/The forecast starts after \d+ days of sales/).isVisible();
    info.annotations.push({ type: "forecast", description: `Live data: ${(await card.innerText()).replace(/\s+/g, " ").slice(0, 160)}` });

    // Cut this browser off from the restaurant, replace its bills with a known history, and reload.
    await context.route(/supabase\.co/, (route) => route.abort());
    const plan = await page.evaluate(async (DAY) => {
      const dayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };
      const now = Date.now();
      const today = dayStart(now);
      const bill = (createdAt: number, total: number, n: number) => ({
        uid: `hard-test-${n}`, billNo: `HT/26-27/${String(n).padStart(4, "0")}`, orderType: "dine-in", lines: [{ itemId: "x", name: "Test dish", price: total, qty: 1, veg: true, gstRate: 0, station: "K" }],
        subtotal: total, discountPct: 0, discountAmt: 0, cgst: 0, sgst: 0, roundOff: 0, total, payments: [{ mode: "cash", amount: total }], status: "settled", createdAt, synced: true,
      });
      const rows = [];
      let n = 1;
      for (let back = 1; back <= 14; back++) {
        const d = dayStart(today - back * DAY + 3_600_000);
        rows.push(bill(d + 60_000, 1000, n++), bill(d + DAY - 120_000, 2000, n++)); // 12:01 am and 11:58 pm
      }
      rows.push(bill(today + 60_000, 1500, n++));
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("restro-pos");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("orders", "readwrite");
          const store = tx.objectStore("orders");
          store.clear();
          for (const r of rows) store.add(r);
          tx.oncomplete = () => { open.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
      const monthStart = new Date(new Date(today).getFullYear(), new Date(today).getMonth(), 1).getTime();
      const nextMonth = new Date(new Date(today).getFullYear(), new Date(today).getMonth() + 1, 1).getTime();
      const monthSoFar = rows.filter((r) => r.createdAt >= monthStart).reduce((t, r) => t + r.total, 0);
      const daysLeft = Math.round((nextMonth - dayStart(today + DAY + 3_600_000)) / DAY);
      const minutes = (now - today) / 60_000;
      return { monthSoFar, daysLeft, month: monthSoFar + 2000 + 3000 * daysLeft, weekday: new Date(now).toLocaleDateString("en-IN", { weekday: "long" }), safe: minutes > 2 && minutes < 1430 };
    }, DAY);
    test.skip(!plan.safe, "Too close to midnight for a fixed-time history");
    await page.reload();
    await ready(page);

    // 14 days × (₹1,000 + ₹2,000); today ₹1,500 at 12:01 am. Same weekday 7 and 14 days ago each billed ₹2,000 later in the day.
    await expect(card.getByText("₹3,500", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("₹1,500 billed so far.");
    await expect(card).toContainText(`17% above a usual ${plan.weekday}`);
    await expect(card.locator("div").filter({ hasText: /^Bills expected/ }).locator("dd")).toHaveText("2");
    await expect(card.locator("div").filter({ hasText: /^Average bill/ }).locator("dd")).toHaveText("₹1,750");
    await expect(card.locator("div").filter({ hasText: /^This month/ }).locator("dd")).toHaveText(`₹${plan.month.toLocaleString("en-IN")}`);
    await expect(card).toContainText(`From 2 past ${plan.weekday}s.`);
    // The KPI tiles agree with the same history.
    await expect(valueUnder(page, "Total sales")).toHaveText("₹1,500");
    await expect(valueUnder(page, "Bills")).toHaveText("1");
    info.annotations.push({ type: "forecast", description: `Injected 14 days: today ₹3,500 (2 bills, avg ₹1,750, +17% vs usual ${plan.weekday}), month ₹${plan.month} (₹${plan.monthSoFar} so far, ${plan.daysLeft} days left); earlier live card ${notReady ? "correctly waited for history" : "had a forecast"}` });
    await info.attach("forecast.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Reports read the same bills: today ₹1,500; this month what was injected for this month.
    await page.goto("/reports?app=manager");
    await ready(page);
    await expect(valueUnder(page, "Net sales")).toHaveText("₹1,500");
    await page.getByRole("button", { name: "This month", exact: true }).click();
    await expect(valueUnder(page, "Net sales")).toHaveText(`₹${plan.monthSoFar.toLocaleString("en-IN")}`);
    await context.close();
  });
});

test.describe("Hard test · selections", () => {
  test("every dashboard period, report tab and menu section opens without a fault, and totals stay consistent", async ({ browser, baseURL }, info) => {
    const { context, page } = await device(browser, baseURL, bp("tablet-1024-landscape"), "admin");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/dashboard?app=manager");
    await synced(page);
    const seen: Record<string, number> = {};
    for (const period of ["Today", "Yesterday", "This week", "Last week", "Last 15 days", "This month", "Last month"]) {
      await page.getByRole("combobox", { name: "Period" }).click();
      await page.getByRole("option", { name: period, exact: true }).click();
      await expect(page.getByRole("combobox", { name: "Period" })).toContainText(period);
      seen[period] = rupees(await valueUnder(page, "Total sales").textContent());
      const bills = Number((await valueUnder(page, "Bills").textContent())?.replace(/\D/g, ""));
      const avg = rupees(await valueUnder(page, "Average bill").textContent());
      if (bills) expect(Math.abs(avg - seen[period] / bills), `${period}: average = sales ÷ bills`).toBeLessThanOrEqual(1);
    }
    expect(seen["This month"]!, "this month includes today").toBeGreaterThanOrEqual(seen["Today"]!);
    expect(seen["Last 15 days"]!, "15 days include yesterday").toBeGreaterThanOrEqual(seen["Yesterday"]!);
    info.annotations.push({ type: "periods", description: Object.entries(seen).map(([k, v]) => `${k} ₹${v}`).join(", ") });

    await page.goto("/reports?app=manager");
    await ready(page);
    for (const tab of ["Overview", "Sales Summary", "Items", "GST", "Staff", "Bills", "Close day"]) {
      await page.getByRole("radio", { name: tab, exact: true }).click();
      await expect(page.getByRole("radio", { name: tab, exact: true })).toBeChecked();
    }

    await page.goto("/tables?app=manager");
    await ready(page);
    await page.getByRole("link", { name: "Takeaway" }).click();
    const sections = page.getByRole("navigation", { name: "Menu sections" }).getByRole("button");
    await expect(sections.first()).toBeVisible({ timeout: 30_000 });
    const count = await sections.count();
    for (let i = 0; i < count; i++) {
      await sections.nth(i).click();
      await expect(page.locator("button[title]").filter({ hasText: "₹" }).first().or(page.getByText("Nothing available in this category"))).toBeVisible();
    }
    info.annotations.push({ type: "sections", description: `${count} menu sections opened` });
    expect(errors, errors.join(" | ")).toHaveLength(0);
    // Leave without saving: the empty takeaway bill is never created.
    await context.close();
  });

  test("Insights is gone from Business Manager", async ({ browser, baseURL }) => {
    for (const name of ["phone-412", "desktop-1440"]) {
      const { context, page } = await device(browser, baseURL, bp(name), "admin");
      await page.goto("/dashboard?app=manager");
      await ready(page);
      await expect(page.getByRole("link", { name: "Dashboard", exact: true }).filter({ visible: true }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: "Insights" })).toHaveCount(0);
      await context.close();
    }
  });
});

test.describe("Hard test · scrolling", () => {
  const SCREENS = ["/dashboard", "/tables", "/menu", "/stock", "/customers", "/reports", "/marketing", "/settings"];
  for (const name of ["phone-360", "phone-412", "tablet-768", "tablet-1024-landscape", "laptop-1280"]) {
    test(`every Business Manager screen scrolls to its end with nothing hidden under the tab bar (${name})`, async ({ browser, baseURL }, info) => {
      const { context, page } = await device(browser, baseURL, bp(name), "admin");
      await page.goto("/dashboard?app=manager");
      await synced(page);
      const problems: string[] = [];
      for (const path of SCREENS) {
        await page.goto(`${path}?app=manager`);
        await ready(page);
        const r = await page.evaluate(async () => {
          const scrollers = [document.scrollingElement!, ...[...document.querySelectorAll("main *")].filter((el) => {
            const s = getComputedStyle(el);
            return /(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 2;
          })];
          // Keep going until the page stops growing (pictures and QR codes fill in as they load).
          for (let round = 0, last = -1; round < 8; round++) {
            for (const el of scrollers) el.scrollTop = el.scrollHeight;
            window.scrollTo(0, document.documentElement.scrollHeight);
            await new Promise((r) => setTimeout(r, 500));
            const h = document.documentElement.scrollHeight + scrollers.reduce((t, el) => t + el.scrollHeight, 0);
            if (h === last) break;
            last = h;
          }
          const bar = [...document.querySelectorAll('nav[aria-label="Main"]')].find((n) => getComputedStyle(n).position === "fixed" && n.getBoundingClientRect().height > 0);
          const barTop = bar ? bar.getBoundingClientRect().top : window.innerHeight;
          const reachedEnd = scrollers.every((el) => el === document.scrollingElement
            ? window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
            : el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
          // The lowest visible bit of content, clipped by any scroll box it sits in.
          let lowest = 0; let what = "";
          for (const el of document.querySelectorAll("main *")) {
            if (el.children.length || !(el.textContent ?? "").trim()) continue;
            const rect = el.getBoundingClientRect();
            if (!rect.width || !rect.height || getComputedStyle(el).visibility === "hidden") continue;
            let bottom = rect.bottom;
            for (let a = el.parentElement; a; a = a.parentElement) {
              if (/(auto|scroll|hidden)/.test(getComputedStyle(a).overflowY)) bottom = Math.min(bottom, a.getBoundingClientRect().bottom);
              if (getComputedStyle(a).position === "fixed") { bottom = -1; break; }
            }
            if (bottom > lowest) { lowest = bottom; what = (el.textContent ?? "").trim().slice(0, 40); }
          }
          return { reachedEnd, lowest: Math.round(lowest), barTop: Math.round(barTop), what, sideways: document.documentElement.scrollWidth - window.innerWidth };
        });
        if (!r.reachedEnd) problems.push(`${path}: could not scroll to the end`);
        if (r.lowest > r.barTop + 1) problems.push(`${path}: "${r.what}" ends at ${r.lowest}px, under the tab bar at ${r.barTop}px`);
        if (r.sideways > 1) problems.push(`${path}: scrolls sideways by ${r.sideways}px`);
      }
      await info.attach(`scroll-${name}.png`, { body: await page.screenshot(), contentType: "image/png" });
      info.annotations.push({ type: "scroll", description: `${name}: ${SCREENS.length} screens, ${problems.length ? problems.join("; ") : "all reach the end with content above the tab bar"}` });
      expect(problems, problems.join("\n")).toHaveLength(0);
      await context.close();
    });
  }
});

test.describe("Hard test · two-way sync on the live POS", () => {
  test.skip(process.env["LIVE_ORDER"] !== "1", "Touches the live POS; runs only on demand (LIVE_ORDER=1).");

  test("counter → waiter → counter → owner, then cancel frees the table everywhere", async ({ browser, baseURL }, info) => {
    const counter = await device(browser, baseURL, bp("desktop-1440"), "billdesk");
    const waiter = await device(browser, baseURL, bp("tablet-768"), "waiter");
    const owner = await device(browser, baseURL, bp("phone-412"), "admin");
    const shot = async (page: Page, name: string) => info.attach(`${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

    // Counter opens a free table and sends one Virgin Mojito to the kitchen.
    await counter.page.goto("/tables?app=pos");
    await synced(counter.page);
    // Not the last free table: the guest-order check uses that one at the same time.
    const freeTables = counter.page.getByRole("button", { name: /^Table [^,]+$/ });
    await expect(freeTables.nth(1)).toBeVisible({ timeout: 60_000 });
    const free = freeTables.nth((await freeTables.count()) - 2);
    const label = ((await free.getAttribute("aria-label")) ?? "").replace(/^Table /, "");
    await free.click();
    // Safety: only a table with no running bill. A real guest's bill is never touched.
    await expect(counter.page.getByText("New bill", { exact: true })).toBeVisible({ timeout: 30_000 });
    const search = counter.page.getByPlaceholder("Search dishes or codes (F4)");
    await search.fill("Virgin Mojito");
    await counter.page.locator('button[title="Virgin Mojito"]').first().click();
    await counter.page.getByRole("button", { name: /^KOT/ }).click();
    await counter.page.getByRole("button", { name: /^Tap to send/ }).click();
    const billText = await counter.page.getByText(/^Bill \S+, opened/).textContent({ timeout: 30_000 });
    const billNo = billText?.match(/^Bill (\S+),/)?.[1] ?? "?";
    info.annotations.push({ type: "sync", description: `Live sync test bill ${billNo} on table ${label} (cancelled at the end; clean up)` });
    await shot(counter.page, "s1-counter-sent");

    // Waiter's tablet sees the running table and adds a Passion Fruit Mojito.
    // The waiter app has no sync chip; its table list is the sign it has synced.
    await waiter.page.goto("/waiter?app=waiter");
    await ready(waiter.page);
    const tile = waiter.page.locator('aside[aria-label="Tables"] button').filter({ hasText: new RegExp(`^\\s*${label}\\b`) }).first();
    await expect(tile).toContainText("₹160", { timeout: 90_000 });
    await tile.click();
    await waiter.page.getByPlaceholder("Find a dish").fill("Passion Fruit Mojito");
    await waiter.page.locator('section[aria-label="Menu"] button:not([disabled])').filter({ hasText: "Passion Fruit Mojito" }).first().click();
    await waiter.page.getByRole("button", { name: /^Send 1 to kitchen/ }).click();
    await waiter.page.getByRole("button", { name: /Tap again to send/ }).click();
    await expect(waiter.page.getByRole("button", { name: /Kitchen has everything/ })).toBeVisible({ timeout: 30_000 });
    await shot(waiter.page, "s2-waiter-added");

    // Counter's floor shows both dishes' total; the owner's phone shows the running bill.
    await counter.page.goto("/tables?app=pos");
    await ready(counter.page);
    await expect(counter.page.getByRole("button", { name: new RegExp(`^Table ${label},`) })).toContainText("₹340", { timeout: 90_000 });
    await owner.page.goto("/dashboard?app=manager&tab=live");
    await synced(owner.page);
    const card = owner.page.locator("article, li, section").filter({ hasText: billNo }).filter({ hasText: "₹340" }).first();
    await expect(card).toBeVisible({ timeout: 90_000 });
    await expect(card).toContainText("Passion Fruit Mojito");
    await shot(owner.page, "s3-owner-live");

    // Counter cancels the bill with a reason: the table frees on the waiter's tablet and leaves the owner's live board.
    await counter.page.getByRole("button", { name: new RegExp(`^Table ${label},`) }).click();
    await counter.page.getByRole("button", { name: "Cancel bill" }).click();
    await counter.page.getByRole("button", { name: "Order entered by mistake" }).click();
    await counter.page.getByRole("button", { name: "Cancel this bill" }).click();
    await expect(counter.page.getByRole("button", { name: `Table ${label}`, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(tile).not.toContainText("₹", { timeout: 90_000 });
    await expect(owner.page.locator("article, li, section").filter({ hasText: billNo }).filter({ hasText: "₹340" })).toHaveCount(0, { timeout: 90_000 });
    await shot(waiter.page, "s4-waiter-free-again");
    await Promise.all([counter.context.close(), waiter.context.close(), owner.context.close()]);
  });
});
