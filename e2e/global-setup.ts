import { chromium, type FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { envValue } from "./env";
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
    const app = name === "admin" ? "manager" : name === "billdesk" ? "pos" : "waiter";
    await context.addInitScript((selectedApp: string) => {
      try {
        localStorage.setItem("xtsy-regression", "1");
        sessionStorage.setItem("xtsy-app", selectedApp);
      } catch { /* ignore */ }
    }, app);
    const page = await context.newPage();
    // Enter the sign-in route directly. App entry routes (e.g. /manager) are
    // client redirects and can remain on their shell if auth hydration stalls.
    // The app query preserves the intended app context after sign-in.
    await page.goto(`/auth?app=${app}`);
    await page.getByRole("heading", { name: "Sign in" }).waitFor({ state: "visible", timeout: 30_000 });
    // App mode is seeded in sessionStorage before app code executes. Wait for the
    // actual username input rather than relying on the label's accessible name.
    const loginField = page.locator('input[autocomplete="username"]');
    try {
      await loginField.waitFor({ state: "visible", timeout: 20_000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        bodyText: document.body.innerText.slice(0, 3000),
        inputs: Array.from(document.querySelectorAll("input")).map((el) => ({ type: el.type, name: el.getAttribute("name"), autocomplete: el.getAttribute("autocomplete"), ariaLabel: el.getAttribute("aria-label") })),
        buttons: Array.from(document.querySelectorAll("button")).map((el) => el.innerText.trim()).filter(Boolean).slice(0, 30),
        appMode: sessionStorage.getItem("xtsy-app"),
      })).catch(() => null);
      throw new Error(`Sign-in username field did not render for ${name}. Diagnostic: ${JSON.stringify(diagnostic)}. Original: ${String(error)}`);
    }
    await loginField.fill(login.email);
    await page.getByLabel("Password").fill(login.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/auth"), { timeout: 45_000 });
    } catch {
      const msg = await page.getByRole("status").first().textContent().catch(() => "");
      throw new Error(`Couldn't sign in as ${login.email}: ${msg || "still on the sign-in page"}. If the password was changed, set XTSY_${name.toUpperCase()}_PASSWORD.`);
    }
    await context.storageState({ path: authFile(name) });
    if (name === "admin") await saveLoginDevices(page);
    await context.close();
  }
  await browser.close();
}

/**
 * Which devices the admin currently allows each login on (Settings → Logins),
 * so the device checks test the real setting rather than the defaults.
 */
async function saveLoginDevices(page: import("@playwright/test").Page) {
  const url = envValue("VITE_SUPABASE_URL");
  const key = envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
  const rows = await page.evaluate(async ({ url, key }) => {
    const stored = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    const token = stored ? (JSON.parse(localStorage.getItem(stored) ?? "{}") as { access_token?: string }).access_token : undefined;
    if (!url || !key || !token) return null;
    const res = await fetch(`${url}/rest/v1/staff_logins?select=login,active,devices`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
    return res.ok ? ((await res.json()) as { login: string; active: boolean; devices: string[] }[]) : null;
  }, { url, key });
  if (!rows?.length) throw new Error("Couldn't read the login device settings as admin.");
  writeFileSync("e2e/.auth/devices.json", JSON.stringify(Object.fromEntries(rows.map((r) => [r.login, r.active ? r.devices : []]))));
}
