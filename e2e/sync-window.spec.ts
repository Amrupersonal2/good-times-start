import { test, expect, type Page } from "@playwright/test";
import { BREAKPOINTS, authFile, contextFor } from "./breakpoints";
import { ready, watch } from "./helpers";

/*
 * The Sync window (tap the Live / Synced status in the top bar): it opens with
 * the right content, Sync now works, and it closes cleanly three ways (✕,
 * Esc, tapping outside), with one Close button, focus back on the status and
 * no errors. Read-only. Runs on the local build and, with BASE_URL, on the
 * live site.
 */

const quiet = () => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } };
const CASES = [
  { app: "Business Manager", login: "admin" as const, bp: "desktop-1440", path: "/dashboard?app=manager" },
  { app: "Business Manager", login: "admin" as const, bp: "phone-412", path: "/dashboard?app=manager" },
  { app: "Restro POS", login: "billdesk" as const, bp: "desktop-1440", path: "/tables?app=pos" },
  { app: "Restro POS", login: "billdesk" as const, bp: "laptop-1280", path: "/tables?app=pos" },
];

async function openSync(page: Page) {
  const status = page.getByRole("button", { name: /^Sync status:/ });
  await expect(status).toBeVisible({ timeout: 60_000 });
  await status.click();
  const dialog = page.getByRole("dialog", { name: "Sync" });
  await expect(dialog).toBeVisible();
  return { status, dialog };
}

async function expectClosed(page: Page, status: import("@playwright/test").Locator, how: string) {
  await expect(page.getByRole("dialog"), `${how}: window gone`).toHaveCount(0);
  await expect(page.locator("[data-radix-dialog-overlay], .fixed.inset-0.z-50[data-state]"), `${how}: no overlay left behind`).toHaveCount(0);
  await expect(status, `${how}: focus back on the sync status`).toBeFocused();
  // The page underneath is usable again.
  await expect(page.locator("body")).not.toHaveAttribute("style", /pointer-events:\s*none/);
}

for (const c of CASES) {
  const bp = BREAKPOINTS.find((b) => b.name === c.bp)!;
  test.describe(`Sync window · ${c.app} · ${bp.name}`, () => {
    test.use({ ...contextFor(bp), storageState: authFile(c.login) });

    test("opens with the right content, syncs, and closes cleanly three ways", async ({ page }, info) => {
      await page.addInitScript(quiet);
      const seen = watch(page);
      await page.goto(c.path);
      await ready(page);

      // 1. Open: content and exactly one Close button.
      let { status, dialog } = await openSync(page);
      await expect(dialog.getByText("Bills waiting to upload")).toBeVisible();
      await expect(dialog.getByText("Other changes waiting")).toBeVisible();
      await expect(dialog.getByText(/^Last synced:/)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close" }), "one Close button").toHaveCount(1);
      // Sync now: finishes without an error and records a sync time.
      await dialog.getByRole("button", { name: "Sync now" }).click();
      await expect(dialog.getByRole("button", { name: "Sync now" })).toBeEnabled({ timeout: 60_000 });
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      await expect(dialog.getByText(/^Last synced: \d/)).toBeVisible({ timeout: 30_000 });
      await info.attach(`${bp.name}-sync-open.png`, { body: await page.screenshot(), contentType: "image/png" });

      // 2. Close with ✕.
      await dialog.getByRole("button", { name: "Close" }).click();
      await expectClosed(page, status, "✕");

      // 3. Close with Esc.
      ({ status, dialog } = await openSync(page));
      await page.keyboard.press("Escape");
      await expectClosed(page, status, "Esc");

      // 4. Close by tapping outside.
      ({ status, dialog } = await openSync(page));
      const box = await dialog.boundingBox();
      await page.mouse.click(8, Math.min((box?.y ?? 200) + (box?.height ?? 0) + 20, (page.viewportSize()?.height ?? 800) - 8));
      await expectClosed(page, status, "tap outside");

      // 5. Open and close quickly several times: no stuck overlay.
      for (let i = 0; i < 5; i += 1) {
        ({ status } = await openSync(page));
        await page.keyboard.press("Escape");
      }
      await expectClosed(page, status, "repeated open/close");
      await info.attach(`${bp.name}-sync-closed.png`, { body: await page.screenshot(), contentType: "image/png" });

      expect(seen.pageErrors, "no crashes").toEqual([]);
      expect.soft(seen.consoleErrors, "no console errors").toEqual([]);
      info.annotations.push({ type: "sync", description: `${c.app} ${bp.name} on ${new URL(page.url()).origin}: opened, synced, closed by ✕, Esc and outside tap` });
    });
  });
}
