import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { BREAKPOINTS, LOGINS, authFile, contextFor, type LoginName } from "./breakpoints";

/** Sign each login in once (through the real sign-in screen) and keep its session for the tests. */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://127.0.0.1:4173";
  mkdirSync("e2e/.auth", { recursive: true });
  const browser = await chromium.launch();
  for (const name of Object.keys(LOGINS) as LoginName[]) {
    const login = LOGINS[name];
    const bp = BREAKPOINTS.find((b) => b.device === login.device && (login.device === "desktop" ? b.width >= 1280 : b.width >= 700))!;
    const context = await browser.newContext({ ...contextFor(bp), baseURL });
    await context.addInitScript(() => { try { localStorage.setItem("xtsy-regression", "1"); } catch { /* ignore */ } });
    const page = await context.newPage();
    await page.goto(login.entry);
    await page.waitForURL(/\/auth/, { timeout: 90_000 });
    await page.getByLabel("Login").fill(login.email);
    await page.getByLabel("Password").fill(login.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45_000 });
    } catch {
      const msg = await page.getByRole("status").first().textContent().catch(() => "");
      throw new Error(`Couldn't sign in as ${login.email}: ${msg || "still on the sign-in page"}. If the password was changed, set XTSY_${name.toUpperCase()}_PASSWORD.`);
    }
    await context.storageState({ path: authFile(name) });
    await context.close();
  }
  await browser.close();
}
