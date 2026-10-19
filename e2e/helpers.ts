import { expect, type Page, type TestInfo } from "@playwright/test";

/** Console messages that are noise, not faults. */
const IGNORED = [/React DevTools/i, /\[vite\]/i, /Download the React/i, /favicon/i, /Failed to load resource: net::ERR_ABORTED/i, /sourcemap/i];

export function watch(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(`${e.name}: ${e.message}`.slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (!IGNORED.some((r) => r.test(text))) consoleErrors.push(text.slice(0, 300));
  });
  return { pageErrors, consoleErrors };
}

/** Wait until the app has finished its first load (the logo splash is gone). */
export async function ready(page: Page) {
  await page.waitForFunction(() => {
    const splash = document.querySelector('img[width="44"][height="44"]');
    return !!document.querySelector("main, h1, h2, [role=dialog], aside") && !(splash && splash.closest("div")?.children.length === 1);
  }, null, { timeout: 45_000 });
  await page.waitForTimeout(700);
}

/**
 * One screen at one size: no crash, nothing pushing the page sideways,
 * expected content visible, and a screenshot for the report.
 */
export async function audit(page: Page, info: TestInfo, label: string, seen: ReturnType<typeof watch>, expectText?: string | RegExp) {
  await ready(page);
  if (expectText) await expect(page.getByText(expectText).first(), `${label}: shows "${expectText}"`).toBeVisible({ timeout: 20_000 });
  const layout = await page.evaluate(() => {
    const vw = window.innerWidth;
    const over = document.documentElement.scrollWidth - vw;
    const clipsX = (el: Element | null) => {
      for (let a = el; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
      }
      return false;
    };
    const offenders = [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right <= vw + 1) return false;
      if (getComputedStyle(el).position === "fixed") return false;
      return !clipsX(el.parentElement);
    }).slice(0, 4).map((el) => `${el.tagName.toLowerCase()}${(el.getAttribute("class") ?? "").split(" ").slice(0, 4).map((c) => `.${c}`).join("")} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
    const tinyTargets = [...document.querySelectorAll("button, a[href], [role=button], input, select")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(el).visibility !== "hidden";
    }).length;
    return { over, offenders, tinyTargets };
  });
  await info.attach(`${label}.png`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  info.annotations.push({ type: "layout", description: `${label}: sideways overflow ${Math.max(0, layout.over)}px; small tap targets ${layout.tinyTargets}` });
  expect.soft(layout.over, `${label}: the page scrolls sideways by ${layout.over}px. Widest: ${layout.offenders.join(" | ")}`).toBeLessThanOrEqual(1);
  expect(seen.pageErrors, `${label}: the page crashed`).toEqual([]);
  expect.soft(seen.consoleErrors, `${label}: console errors`).toEqual([]);
  seen.pageErrors.length = 0;
  seen.consoleErrors.length = 0;
}
