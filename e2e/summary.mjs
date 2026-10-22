// Turns Playwright's JSON results into a short Markdown table for the run page.
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("e2e-results.json", "utf8"));
const rows = [];
const walk = (suite, path) => {
  for (const s of suite.suites ?? []) walk(s, [...path, s.title]);
  for (const spec of suite.specs ?? []) for (const t of spec.tests ?? []) {
    const last = t.results[t.results.length - 1] ?? {};
    const errors = (last.errors ?? []).map((e) => (e.message ?? "").split("\n")[0].replace(/\x1b\[[0-9;]*m/g, "")).join(" / ");
    rows.push({ name: [...path, spec.title].filter(Boolean).slice(1).join(" › "), status: t.status, errors });
  }
};
walk(data, []);
const by = (s) => rows.filter((r) => r.status === s).length;
console.log(`## Regression: ${by("expected")} passed, ${by("flaky")} flaky, ${by("unexpected")} failed, ${by("skipped")} skipped\n`);
const bad = rows.filter((r) => r.status !== "expected" && r.status !== "skipped");
if (bad.length) {
  console.log("| Check | Result | Detail |\n|---|---|---|");
  for (const r of bad) console.log(`| ${r.name} | ${r.status} | ${r.errors.slice(0, 300).replace(/\|/g, "\\|")} |`);
}
