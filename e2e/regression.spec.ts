import { test, expect } from "@playwright/test";
import { BREAKPOINTS, LOGINS, authFile, contextFor } from "./breakpoints";
import { audit, ready, watch } from "./helpers";

/*
 * Regression across all three apps and the guest QR page, at seven screen
 * sizes. Read-only: nothing is billed, saved or sent; test browsers don't
 * register as terminals.
 */

const quiet = () => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } };

const MANAGER_SCREENS: [string, string, (string | RegExp)?][] = [
  ["dashboard", "/dashboard", "Business overview"],
  ["dashboard-live", "/dashboard?tab=live", "Live status"],
  ["insights", "/insights"],
  ["billing", "/"],
  ["tables", "/tables"],
  ["menu", "/menu"],
  ["stock", "/stock"],
  ["guests", "/customers"],
  ["reports", "/reports", "Reports"],
  ["marketing-brand", "/marketing", "Brand colour"],
  ["marketing-qr", "/marketing?tab=qr"],
  ["marketing-whatsapp", "/marketing?tab=whatsapp", "New campaign"],
  ["marketing-results", "/marketing?tab=results", "Which QR codes work"],
  ["settings", "/settings", "Outlet settings"],
  ["settings-terminals", "/settings#terminals", "Terminals"],
  ["settings-invoice", "/settings#billing", "Invoice & GST"],
  ["settings-printing", "/settings#printing", "Printing & KOT"],
  ["settings-ordering", "/settings#ordering", "Guest ordering"],
  ["settings-restaurant", "/settings#restaurant", "Restaurant details"],
  ["settings-logins", "/settings#logins", "Logins"],
  ["settings-roles", "/settings#roles", "On with PIN"],
  ["settings-device", "/settings#device", "This device"],
  ["setup", "/setup"],
];

const POS_SCREENS: [string, string, (string | RegExp)?][] = [
  ["pos-billing", "/?app=pos"],
  ["pos-tables", "/tables?app=pos"],
  ["pos-guests", "/customers?app=pos"],
  ["pos-reports", "/reports?app=pos", /Close day|Sales Summary/],
  ["pos-settings", "/settings?app=pos", "Settings"],
];

for (const bp of BREAKPOINTS) {
  test.describe(`${bp.name} (${bp.width}×${bp.height})`, () => {
    test.use(contextFor(bp));

    test("sign-in page", async ({ page }, info) => {
      await page.addInitScript(quiet);
      const seen = watch(page);
      await page.goto("/auth");
      await audit(page, info, `${bp.name}-auth-choose-app`, seen, "Choose your app");
      // The first click can land before the page is interactive on a cold server; retry it.
      await expect(async () => {
        await page.getByRole("radio", { name: /POS Business Manager/ }).click();
        await expect(page.getByLabel("Login")).toHaveValue(LOGINS.admin.email, { timeout: 2_000 });
      }).toPass({ timeout: 30_000 });
      await audit(page, info, `${bp.name}-auth-form`, seen, "Forgot password?");
      await page.getByRole("button", { name: "Forgot password?" }).click();
      await audit(page, info, `${bp.name}-auth-reset`, seen, "Send code on WhatsApp");
    });

    test("guest QR menu", async ({ page }, info) => {
      const seen = watch(page);
      await page.goto("/order/tab-bistro");
      await audit(page, info, `${bp.name}-guest-menu`, seen, /TAB Bistro|Ordering is off|Scan the QR code/);
      await page.goto("/order/tab-bistro?table=not-a-table&s=t9");
      await audit(page, info, `${bp.name}-guest-old-qr`, seen);
      await page.goto("/order/no-such-place");
      await audit(page, info, `${bp.name}-guest-unknown`, seen, "Restaurant not found");
    });

    test.describe("Business Manager (admin)", () => {
      test.use({ storageState: authFile("admin") });
      for (const [name, path, text] of MANAGER_SCREENS) {
        test(name, async ({ page }, info) => {
          await page.addInitScript(quiet);
          const seen = watch(page);
          await page.goto(path.includes("?") ? path.replace("?", "?app=manager&") : path.includes("#") ? path.replace("#", "?app=manager#") : `${path}?app=manager`);
          await audit(page, info, `${bp.name}-manager-${name}`, seen, text);
          expect(page.url(), "stays signed in").not.toContain("/auth");
        });
      }
      test("reports: Sales Summary", async ({ page }, info) => {
        await page.addInitScript(quiet);
        const seen = watch(page);
        await page.goto("/reports?app=manager");
        await ready(page);
        await page.getByRole("radio", { name: "Sales Summary" }).or(page.getByRole("button", { name: "Sales Summary" })).first().click();
        await audit(page, info, `${bp.name}-manager-sales-summary`, seen, "Total sales");
      });
    });

    test.describe("Restro POS (billdesk)", () => {
      test.use({ storageState: authFile("billdesk") });
      if (bp.device === "desktop") {
        for (const [name, path, text] of POS_SCREENS) {
          test(name, async ({ page }, info) => {
            await page.addInitScript(quiet);
            const seen = watch(page);
            await page.goto(path);
            await audit(page, info, `${bp.name}-${name}`, seen, text);
            await expect(page.getByText("Not available here")).toHaveCount(0);
          });
        }
        test("admin-only screens stay closed", async ({ page }, info) => {
          await page.addInitScript(quiet);
          const seen = watch(page);
          await page.goto("/marketing?app=pos");
          await audit(page, info, `${bp.name}-pos-marketing-closed`, seen, /isn't part of|for the owner and managers/);
        });
      } else {
        test("blocked on phones and tablets", async ({ page }, info) => {
          await page.addInitScript(quiet);
          const seen = watch(page);
          await page.goto("/?app=pos");
          await audit(page, info, `${bp.name}-pos-blocked`, seen, "Not available here");
        });
      }
    });

    test.describe("POS Waiter (waiter)", () => {
      test.use({ storageState: authFile("waiter") });
      test(bp.device === "android" ? "waiter screen" : "blocked on computers", async ({ page }, info) => {
        await page.addInitScript(quiet);
        const seen = watch(page);
        await page.goto("/waiter?app=waiter");
        if (bp.device === "android") await audit(page, info, `${bp.name}-waiter`, seen, /Tables|No tables yet|Pick a table/);
        else await audit(page, info, `${bp.name}-waiter-blocked`, seen, "Not available here");
      });
    });
  });
}

/* The bug fixed in PR #12: sign-in must open the app on the first press. */
for (const bp of BREAKPOINTS.filter((b) => b.name === "phone-412" || b.name === "desktop-1440")) {
  test(`${bp.name}: admin signs in on the first try`, async ({ browser }, info) => {
    const context = await browser.newContext(contextFor(bp));
    await context.addInitScript(quiet);
    const page = await context.newPage();
    const seen = watch(page);
    await page.goto("/manager");
    await page.waitForURL(/\/auth/);
    await page.getByLabel("Login").fill("admin");
    await page.getByLabel("Password").fill(LOGINS.admin.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    await page.waitForTimeout(3000);
    expect(page.url(), "didn't bounce back to the sign-in page").toContain("/dashboard");
    await audit(page, info, `${bp.name}-first-sign-in`, seen, "Business overview");
    await context.close();
  });
}
