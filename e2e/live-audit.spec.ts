import { test, expect, type APIRequestContext } from "@playwright/test";
import { envValue } from "./env";

/*
 * Live audit, read-only. Security probes run against the live database with
 * only the public key, exactly what anyone on the internet holds. Site checks
 * run against the published site when BASE_URL is set.
 */

const SUPABASE = envValue("VITE_SUPABASE_URL");
const ANON = envValue("VITE_SUPABASE_PUBLISHABLE_KEY");
const SITE = process.env["BASE_URL"] ?? "";
const anonHeaders = { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" };

async function rest(request: APIRequestContext, path: string, init: { method?: string; data?: unknown } = {}) {
  const res = await request.fetch(`${SUPABASE}/rest/v1/${path}`, { method: init.method ?? "GET", headers: anonHeaders, ...(init.data !== undefined ? { data: init.data } : {}), failOnStatusCode: false });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = await res.text().catch(() => ""); }
  return { status: res.status(), body };
}

test.describe("Live audit · security (public key only)", () => {
  test.skip(!SUPABASE || !ANON, "Supabase keys not available");

  test("private tables are unreadable without signing in", async ({ request }, info) => {
    const results: string[] = [];
    for (const table of ["restaurant_records", "staff_logins", "password_reset_codes", "guest_orders", "terminals", "restaurant_members", "profiles", "marketing_campaigns", "qr_scans", "accounts", "platform_admins"]) {
      const r = await rest(request, `${table}?select=*&limit=5`);
      const rows = Array.isArray(r.body) ? r.body.length : 0;
      results.push(`${table}: ${r.status} ${rows} rows`);
      expect(rows, `${table} must not be readable by the public`).toBe(0);
    }
    info.annotations.push({ type: "security", description: results.join(" · ") });
  });

  test("the public can't write bills, menu or tables, or change the restaurant", async ({ request }, info) => {
    const write = await rest(request, "restaurant_records", { method: "POST", data: { restaurant_id: "66c66ac4-efce-492b-b709-1c2b38d9cd78", kind: "menu", record_id: "audit-probe", payload: { name: "x", price: 1 } } });
    expect(write.status, "insert refused").toBeGreaterThanOrEqual(400);
    const rename = await rest(request, "restaurants?id=eq.66c66ac4-efce-492b-b709-1c2b38d9cd78", { method: "PATCH", data: { name: "hacked" } });
    const changed = Array.isArray(rename.body) ? rename.body.length : 0;
    expect(changed, "restaurant not changed").toBe(0);
    const del = await rest(request, "guest_orders?id=neq.00000000-0000-0000-0000-000000000000", { method: "DELETE" });
    expect(Array.isArray(del.body) ? del.body.length : 0, "nothing deleted").toBe(0);
    info.annotations.push({ type: "security", description: `insert ${write.status}, restaurant update changed ${changed} rows, guest order delete ${del.status}` });
  });

  test("admin and staff functions refuse the public", async ({ request }, info) => {
    const out: string[] = [];
    for (const [fn, args] of [
      ["admin_accounts", {}],
      ["set_member_role", { _restaurant_id: "66c66ac4-efce-492b-b709-1c2b38d9cd78", _user_id: "00000000-0000-0000-0000-000000000000", _role: "owner" }],
      ["create_restaurant", { _name: "Audit" }],
      ["push_menu", { _from: "66c66ac4-efce-492b-b709-1c2b38d9cd78", _to: [] }],
      ["touch_terminal", { _restaurant: "66c66ac4-efce-492b-b709-1c2b38d9cd78", _device: "audit", _series: "AUD", _app: "pos", _kind: "desktop" }],
    ] as const) {
      const r = await rest(request, `rpc/${fn}`, { method: "POST", data: args });
      const ok = r.status >= 400 || r.body === "unknown" || (typeof r.body === "string" && r.body.includes("unknown"));
      out.push(`${fn}: ${r.status}`);
      expect(ok, `${fn} must not work for the public (got ${r.status} ${JSON.stringify(r.body).slice(0, 120)})`).toBe(true);
    }
    info.annotations.push({ type: "security", description: out.join(" · ") });
  });

  test("the guest menu shares only what guests need", async ({ request }, info) => {
    const r = await rest(request, "rpc/public_storefront", { method: "POST", data: { _slug: "tab-bistro" } });
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.body);
    expect(text).toContain("TAB Bistro");
    for (const secret of ["recipe", "costPerUnit", "staff_logins", "password", "@xtsy.pos", "8837317070", "service_role"]) {
      expect(text.includes(secret), `storefront must not include "${secret}"`).toBe(false);
    }
    info.annotations.push({ type: "security", description: `storefront: ${text.length} chars, no recipes, costs, logins or phone numbers` });
  });

  test("guests can't set their own prices or order missing dishes", async ({ request }, info) => {
    // A tampered price is ignored: the server prices from the menu. Ordering is switched to a fake table so nothing reaches the kitchen.
    const fakeTable = await rest(request, "rpc/place_guest_order", { method: "POST", data: { _slug: "tab-bistro", _channel: "table", _table_id: "AUDIT-NO-SUCH-TABLE", _name: "Audit", _phone: "", _note: "", _lines: [{ itemId: "tab-black-tea", qty: 1, price: 1 }] } });
    expect(fakeTable.status, "unknown table refused").toBeGreaterThanOrEqual(400);
    const badDish = await rest(request, "rpc/place_guest_order", { method: "POST", data: { _slug: "tab-bistro", _channel: "online", _table_id: "", _name: "Audit", _phone: "9000000000", _note: "", _lines: [{ itemId: "no-such-dish", qty: 1 }] } });
    expect(badDish.status, "unknown dish or closed pickup refused").toBeGreaterThanOrEqual(400);
    const status = await rest(request, "rpc/guest_order_status", { method: "POST", data: { _id: "00000000-0000-0000-0000-000000000000", _token: "00000000-0000-0000-0000-000000000000" } });
    expect(JSON.stringify(status.body)).not.toMatch(/customer_phone|lines/);
    info.annotations.push({ type: "security", description: `fake table ${fakeTable.status}: ${JSON.stringify(fakeTable.body).slice(0, 90)} · unknown dish ${badDish.status} · order status without token: nothing returned` });
  });
});

test.describe("Live audit · published site", () => {
  test.skip(!SITE, "Runs against the published site (set BASE_URL)");

  test("install files, icons, logo and offline worker are current", async ({ request }, info) => {
    const expected: Record<string, string> = { pos: "/tables?app=pos", waiter: "/waiter?app=waiter", manager: "/manager?app=manager", insights: "/insights" };
    const out: string[] = [];
    for (const [app, start] of Object.entries(expected)) {
      const res = await request.get(`${SITE}/manifest-${app}.webmanifest`);
      expect(res.status(), `${app} manifest`).toBe(200);
      const m = await res.json() as { start_url: string; name: string; icons: { src: string }[] };
      expect(m.start_url, `${app} opens on the right screen`).toBe(start);
      for (const icon of m.icons) {
        const i = await request.get(`${SITE}${icon.src}`);
        expect(i.status(), `${icon.src}`).toBe(200);
        expect(i.headers()["content-type"] ?? "").toContain("image/png");
      }
      out.push(`${m.name}: ${m.start_url}, ${m.icons.length} icons`);
    }
    const sw = await (await request.get(`${SITE}/sw.js`)).text();
    expect(sw, "offline worker is the latest").toContain('VERSION = "xtsy-pos-v8"');
    expect((await request.get(`${SITE}/brand/xtsy-logo.png`)).status()).toBe(200);
    expect((await request.get(`${SITE}/favicon.png`)).status()).toBe(200);
    for (const path of ["/auth", "/order/tab-bistro", "/tables", "/waiter", "/insights", "/manager"]) {
      const r = await request.get(`${SITE}${path}`);
      expect(r.status(), `${path} loads`).toBe(200);
    }
    info.annotations.push({ type: "site", description: `${out.join(" · ")} · worker v8 · logo and favicon OK · 6 pages load` });
  });
});
