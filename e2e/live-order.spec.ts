import { test, expect, type Browser } from "@playwright/test";
import { BREAKPOINTS, authFile, contextFor } from "./breakpoints";

/*
 * Live end-to-end guest order, run on demand only (LIVE_ORDER=1), because it
 * puts a real order on the restaurant's POS:
 *   1. a guest on a phone scans the QR menu, picks a table, adds a dish and orders;
 *   2. Reception's Restro POS on a computer sees it and accepts it (KOT + bill);
 *   3. the guest's page updates to "the kitchen has your order";
 *   4. the admin's Business Manager on a second device sees the same bill.
 * The order is clearly marked as a test; clean it up afterwards.
 */

test.skip(process.env["LIVE_ORDER"] !== "1", "Live order check runs only on demand (LIVE_ORDER=1).");
test.setTimeout(240_000);

const TEST_NAME = "XTSY TEST — do not prepare";
const phone = BREAKPOINTS.find((b) => b.name === "phone-412")!;
const desktop = BREAKPOINTS.find((b) => b.name === "desktop-1440")!;
const tabletBp = BREAKPOINTS.find((b) => b.name === "tablet-768")!;
const quiet = () => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } };

async function open(browser: Browser, bp: typeof phone, auth?: Parameters<typeof authFile>[0]) {
  const context = await browser.newContext({ ...contextFor(bp), baseURL: "http://127.0.0.1:4173", ...(auth ? { storageState: authFile(auth) } : {}) });
  await context.addInitScript(quiet);
  return context;
}

test("guest QR order reaches the POS, is accepted, and syncs to another device", async ({ browser }, info) => {
  const shot = async (page: import("@playwright/test").Page, name: string) =>
    info.attach(`${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // 1. Guest on a phone.
  const guestCtx = await open(browser, phone);
  const guest = await guestCtx.newPage();
  await guest.goto("/order/tab-bistro?s=e2e");
  await expect(guest.getByRole("heading", { name: "Choose your table" })).toBeVisible({ timeout: 60_000 });
  await shot(guest, "1-choose-table");
  const tables = guest.getByRole("button", { name: /^Table / });
  const tableButton = tables.last();
  const tableLabel = ((await tableButton.textContent()) ?? "").replace(/^\s*Table\s*/, "").trim();
  await tableButton.click();
  await expect(guest).toHaveURL(/table=/);
  const tableId = new URL(guest.url()).searchParams.get("table")!;
  await expect(guest.getByText(`Ordering to table ${tableLabel}`)).toBeVisible({ timeout: 30_000 });

  const add = guest.getByRole("button", { name: /^Add / }).filter({ hasText: /^Add$/ }).first();
  const dish = ((await add.getAttribute("aria-label")) ?? "").replace(/^Add /, "");
  await add.click();
  await shot(guest, "2-menu-with-cart");
  await guest.getByRole("button", { name: /Review order/ }).click();
  await guest.getByLabel(/Your name/).fill(TEST_NAME);
  await guest.getByLabel(/Anything the kitchen should know/).fill("Automated live check. DO NOT PREPARE.");
  await shot(guest, "3-checkout");
  await guest.getByRole("button", { name: /^Place order/ }).click();
  const code = guest.getByRole("heading", { level: 1 }).filter({ hasText: /^Q-\d+/ });
  await expect(code).toBeVisible({ timeout: 30_000 });
  const orderCode = (await code.textContent())!.trim();
  info.annotations.push({ type: "live-order", description: `Guest order ${orderCode}: ${dish} at table ${tableLabel} (${tableId})` });
  await shot(guest, "4-order-sent");

  // 2. Reception's Restro POS on a computer accepts it.
  const posCtx = await open(browser, desktop, "billdesk");
  const pos = await posCtx.newPage();
  await pos.goto("/tables?app=pos");
  const bell = pos.getByRole("button", { name: /^Guest orders: \d+ waiting/ });
  await expect(bell).toBeVisible({ timeout: 60_000 });
  await bell.click();
  const card = pos.locator("article").filter({ hasText: orderCode });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await shot(pos, "5-pos-incoming");
  await card.getByRole("button", { name: /Accept & send KOT/ }).click();
  await card.getByRole("button", { name: /Tap again to accept/ }).click();
  await expect(pos.getByText(new RegExp(`${orderCode} accepted`))).toBeVisible({ timeout: 30_000 });
  await shot(pos, "6-pos-accepted");

  // 3. The guest's page follows along.
  await expect(guest.getByText("The kitchen has your order.")).toBeVisible({ timeout: 45_000 });
  await shot(guest, "7-guest-preparing");

  // 4. The admin's Business Manager on a tablet sees the same running bill.
  const mgrCtx = await open(browser, tabletBp, "admin");
  const mgr = await mgrCtx.newPage();
  await mgr.goto(`/?app=manager&table=${encodeURIComponent(tableId)}`);
  await expect(mgr.getByText(dish).filter({ visible: true }).first()).toBeVisible({ timeout: 90_000 });
  await shot(mgr, "8-manager-sees-bill");

  await Promise.all([guestCtx.close(), posCtx.close(), mgrCtx.close()]);
});

test("a waiter taking an order holds the table; others see it; emptying it frees the table", async ({ browser }, info) => {
  const shot = async (page: import("@playwright/test").Page, name: string) =>
    info.attach(`${name}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

  // Waiter on a tablet picks a free table and adds one dish, without sending it.
  const waiterCtx = await open(browser, tabletBp, "waiter");
  const waiter = await waiterCtx.newPage();
  await waiter.goto("/waiter?app=waiter");
  const freeTile = waiter.locator('aside[aria-label="Tables"] button').filter({ hasNotText: "₹" }).filter({ hasNotText: "Reserved" }).first();
  await expect(freeTile).toBeVisible({ timeout: 60_000 });
  const label = ((await freeTile.locator("span").first().textContent()) ?? "").trim();
  await freeTile.click();
  const dish = waiter.locator('section[aria-label="Menu"] button:not([disabled])').filter({ hasText: "₹" }).filter({ hasNotText: "Options" }).first();
  const dishName = ((await dish.locator("span").nth(2).textContent()) ?? "").trim();
  await dish.click();
  info.annotations.push({ type: "hold", description: `Waiter holds table ${label} with ${dishName || "a dish"} (not sent)` });
  await shot(waiter, "h1-waiter-holding");

  // Reception opens the same table on Restro POS: sees who holds it and can't add a second order.
  const posCtx = await open(browser, desktop, "billdesk");
  const pos = await posCtx.newPage();
  await pos.goto("/tables?app=pos");
  const tile = pos.getByRole("button", { name: new RegExp(`^Table ${label}(,|$)`) });
  await expect(tile).toContainText("Taking order", { timeout: 60_000 });
  await tile.click();
  await expect(pos.getByRole("status").filter({ hasText: "is taking this table's order" })).toBeVisible({ timeout: 30_000 });
  await shot(pos, "h2-counter-sees-hold");

  // Waiter removes the dish: the table is free again everywhere.
  await waiter.getByRole("button", { name: /^Fewer / }).first().click();
  await pos.goto("/tables?app=pos");
  await expect(pos.getByRole("button", { name: `Table ${label}`, exact: true })).toBeVisible({ timeout: 60_000 });
  await shot(pos, "h3-table-free-again");
  await Promise.all([waiterCtx.close(), posCtx.close()]);
});
