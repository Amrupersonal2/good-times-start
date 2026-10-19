// Collects failing checks (messages + screenshots) from Playwright's JSON into e2e-out/.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("e2e-results.json", "utf8"));
mkdirSync("e2e-out/shots", { recursive: true });
const failures = [];
const all = [];
let shots = 0;
const clean = (s) => (s ?? "").replace(/\x1b\[[0-9;]*m/g, "");
const walk = (suite, path) => {
  for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
  for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
    const name = [...path, spec.title].filter(Boolean).slice(1).join(" › ");
    const last = t.results[t.results.length - 1] ?? {};
    all.push({ name, status: t.status, ms: last.duration });
    if (t.status === "expected" || t.status === "skipped") continue;
    const errors = (last.errors ?? []).map((e) => clean(e.message).split("\n").slice(0, 6).join("\n"));
    const pngs = [];
    for (const a of last.attachments ?? []) {
      if (a.contentType !== "image/png" || !a.body || shots >= 80) continue;
      const file = `${String(shots).padStart(2, "0")}-${a.name.replace(/[^a-z0-9.-]+/gi, "_")}`;
      writeFileSync(`e2e-out/shots/${file}`, Buffer.from(a.body, "base64"));
      pngs.push(file);
      shots += 1;
    }
    failures.push({ name, status: t.status, errors, screenshots: pngs, annotations: (t.annotations ?? []).map((x) => x.description) });
  }
};
walk(data, []);
writeFileSync("e2e-out/failures.json", JSON.stringify(failures, null, 2));
writeFileSync("e2e-out/all.json", JSON.stringify(all));
