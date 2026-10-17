import { TAB_MENU } from "../../src/data/tab-bistro";
const outlets = Number(process.argv[2] ?? 50);
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
let out = "INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111','owner@x.in', now()) ON CONFLICT DO NOTHING;\n";
out += "INSERT INTO accounts (id, name, owner_id, plan_id, status, trial_ends_at) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','Load','11111111-1111-1111-1111-111111111111','chain','active',null);\n";
for (let o = 0; o < outlets; o++) {
  const rid = `00000000-0000-0000-0000-${String(o).padStart(12, "0")}`;
  out += `INSERT INTO restaurants (id, name, created_by, account_id, slug, ordering) VALUES ('${rid}', 'Outlet ${o}', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000000', 'outlet-${o}', '{"table":true,"online":true,"upi":true}');\n`;
  out += `INSERT INTO restaurant_records (restaurant_id, kind, record_id, payload) VALUES ('${rid}','settings','restaurant', ${q(JSON.stringify({ name: `Outlet ${o}`, upiVpa: "tab@upi" }))})`;
  for (const m of TAB_MENU) out += `,\n ('${rid}','menu',${q(m.id)},${q(JSON.stringify(m))})`;
  for (let t = 1; t <= 100; t++) out += `,\n ('${rid}','table','t${t}',${q(JSON.stringify({ id: `t${t}`, label: `T${t}`, section: "Main" }))})`;
  out += ";\n";
}
console.log(out);
