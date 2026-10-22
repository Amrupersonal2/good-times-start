import { chromium, type FullConfig } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    if (name === "admin") await saveLoginDevices(page);
    await context.close();
  }
  await browser.close();
}

/** Read from a project .env file (CI has no other copy of the public Supabase keys). */
function envValue(key: string): string {
  if (process.env[key]) return process.env[key]!;
  if (!existsSync(".env")) return "";
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return (line?.slice(key.length + 1) ?? "").trim().replace(/^"|"$/g, "");
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
