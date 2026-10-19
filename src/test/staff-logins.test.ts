import * as testApi from "vitest";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The login server code against an in-memory stand-in for the database and
 * Supabase's user admin: creating the three logins, admin resets, WhatsApp codes.
 */

type Mocker = { mock?: { module?: (p: string, f: () => unknown) => void }; vi?: { doMock: (p: string, f: () => unknown) => void } };
function mockModule(path: string, factory: () => unknown) {
  const api = testApi as unknown as Mocker;
  if (typeof api.mock?.module === "function") api.mock.module(path, factory);
  else api.vi?.doMock(path, factory);
}

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const users: { id: string; email: string; password: string; confirmed: boolean }[] = [];
const keyOf: Record<string, string[]> = { staff_logins: ["login"], password_reset_codes: ["login"], profiles: ["id"], restaurant_members: ["restaurant_id", "user_id"] };

function query(table: string) {
  const filters: [string, unknown][] = [];
  let patch: Row | null = null;
  let single = false;
  const rows = () => (db[table] ??= []).filter((r) => filters.every(([c, v]) => r[c] === v));
  const q = {
    select: () => q, order: () => q, limit: () => q,
    eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
    maybeSingle: () => { single = true; return q; },
    update: (p: Row) => { patch = p; return q; },
    upsert: (row: Row) => {
      const key = keyOf[table] ?? ["id"];
      const list = (db[table] ??= []);
      const hit = list.find((r) => key.every((k) => r[k] === row[k]));
      if (hit) Object.assign(hit, row); else list.push({ ...row });
      return Promise.resolve({ error: null });
    },
    then: (resolve: (v: unknown) => void) => {
      if (patch) {
        for (const r of rows()) {
          Object.assign(r, patch);
          // Like the database trigger: linking a login adds its membership.
          if (table === "staff_logins" && r["user_id"] && r["restaurant_id"] && r["active"] !== false) {
            const members = (db["restaurant_members"] ??= []);
            if (!members.some((m) => m["user_id"] === r["user_id"])) members.push({ restaurant_id: r["restaurant_id"], user_id: r["user_id"], role: r["role"] });
          }
        }
        resolve({ error: null, data: null });
        return;
      }
      const found = rows();
      resolve({ error: null, data: single ? found[0] ?? null : found });
    },
  };
  return q;
}

const fakeAdmin = {
  from: query,
  auth: {
    admin: {
      listUsers: async () => ({ data: { users: users.map((u) => ({ id: u.id, email: u.email })) }, error: null }),
      createUser: async (o: { email: string; password: string; email_confirm: boolean }) => {
        const u = { id: `u-${users.length + 1}`, email: o.email, password: o.password, confirmed: o.email_confirm };
        users.push(u);
        return { data: { user: { id: u.id } }, error: null };
      },
      updateUserById: async (id: string, o: { password: string }) => {
        const u = users.find((x) => x.id === id);
        if (u) u.password = o.password;
        return { error: u ? null : { message: "no user" } };
      },
    },
  },
};

let server: typeof import("@/lib/staff-logins/logins.server");
const sent: { to: string; code: string }[] = [];

beforeAll(async () => {
  mockModule("@/integrations/supabase/client.server", () => ({ supabaseAdmin: fakeAdmin }));
  mockModule("@/lib/whatsapp/cloud-api.server", () => ({
    whatsappKeys: () => (process.env["WHATSAPP_ACCESS_TOKEN"] ? { token: "t", phoneId: "p" } : null),
    sendAuthCode: async (_k: unknown, input: { to: string; code: string }) => { sent.push({ to: input.to, code: input.code }); return { ok: true, id: "m" }; },
  }));
  server = await import("@/lib/staff-logins/logins.server");
});

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  users.length = 0;
  sent.length = 0;
  db["restaurants"] = [{ id: "r1" }];
  db["staff_logins"] = [
    { login: "admin", email: "admin@xtsy.pos", role: "owner", display_name: "Admin", whatsapp: "918837317070", user_id: null, restaurant_id: null, active: true },
    { login: "billdesk", email: "billdesk@xtsy.pos", role: "cashier", display_name: "Reception", whatsapp: "", user_id: null, restaurant_id: null, active: true },
    { login: "waiter", email: "waiter@xtsy.pos", role: "captain", display_name: "Waiter", whatsapp: "", user_id: null, restaurant_id: null, active: true },
  ];
  delete process.env["WHATSAPP_ACCESS_TOKEN"];
  delete process.env["WHATSAPP_OTP_TEMPLATE"];
  delete process.env["XTSY_INITIAL_PASSWORD"];
});

describe("internal logins on the server", () => {
  it("creates the three logins once, confirmed, with the first password, and links them with their roles", async () => {
    expect(await server.ensureLogins()).toEqual({ created: 3 });
    expect(users.map((u) => [u.email, u.password, u.confirmed])).toEqual([
      ["admin@xtsy.pos", "Xtsy123$$", true], ["billdesk@xtsy.pos", "Xtsy123$$", true], ["waiter@xtsy.pos", "Xtsy123$$", true],
    ]);
    expect(db["restaurant_members"]?.map((m) => m["role"])).toEqual(["owner", "cashier", "captain"]);
    // Calling again changes nothing, and never resets a password.
    users[0]!.password = "Changed-by-admin1";
    expect(await server.ensureLogins()).toEqual({ created: 0 });
    expect(users).toHaveLength(3);
    expect(users[0]!.password).toBe("Changed-by-admin1");
  });

  it("links an account that already exists instead of creating a second one", async () => {
    users.push({ id: "old-admin", email: "admin@xtsy.pos", password: "Mine-1234", confirmed: true });
    expect(await server.ensureLogins()).toEqual({ created: 2 });
    expect(db["staff_logins"]?.[0]?.["user_id"]).toBe("old-admin");
    expect(users[0]!.password).toBe("Mine-1234");
  });

  it("lets only the admin reset passwords, and only to a sound password", async () => {
    await server.ensureLogins();
    const adminId = users[0]!.id;
    const waiterId = users[2]!.id;
    await server.resetPassword(adminId, "waiter", "Waiter-2026");
    expect(users[2]!.password).toBe("Waiter-2026");
    await expect(server.resetPassword(waiterId, "billdesk", "Hacked-123")).rejects.toThrow(/Only the admin/);
    await expect(server.resetPassword(adminId, "waiter", "short")).rejects.toThrow(/8 characters/);
  });

  it("explains when WhatsApp codes aren't available", async () => {
    await server.ensureLogins();
    expect(await server.requestCode("waiter")).toEqual({ sent: false, reason: expect.stringMatching(/No WhatsApp number.*Ask the admin/) });
    expect(await server.requestCode("admin")).toEqual({ sent: false, reason: expect.stringMatching(/aren't switched on yet/) });
  });

  it("resets with a WhatsApp code: right code works once, wrong codes are limited", async () => {
    await server.ensureLogins();
    process.env["WHATSAPP_ACCESS_TOKEN"] = "t";
    process.env["WHATSAPP_OTP_TEMPLATE"] = "login_code";
    expect(await server.requestCode("admin")).toEqual({ sent: true, to: "+91 ••••• •7070" });
    const code = sent[0]!.code;
    expect(sent[0]!.to).toBe("918837317070");
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(db["password_reset_codes"])).not.toContain(code); // only a hash is stored

    const wrong = code === "000000" ? "111111" : "000000";
    await expect(server.confirmCode("admin", wrong, "New-pass-2026")).rejects.toThrow(/isn't right/);
    await server.confirmCode("admin", code, "New-pass-2026");
    expect(users[0]!.password).toBe("New-pass-2026");
    await expect(server.confirmCode("admin", code, "Again-2026x")).rejects.toThrow(/expired/);
  });

  it("stops guessing after five wrong codes, and limits codes per hour", async () => {
    await server.ensureLogins();
    process.env["WHATSAPP_ACCESS_TOKEN"] = "t";
    process.env["WHATSAPP_OTP_TEMPLATE"] = "login_code";
    await server.requestCode("admin");
    const code = sent[0]!.code;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i += 1) await expect(server.confirmCode("admin", wrong, "New-pass-2026")).rejects.toThrow(/isn't right/);
    await expect(server.confirmCode("admin", code, "New-pass-2026")).rejects.toThrow(/Too many wrong codes/);
    await server.requestCode("admin");
    await server.requestCode("admin");
    expect(await server.requestCode("admin")).toEqual({ sent: false, reason: expect.stringMatching(/Too many codes/) });
  });
});
