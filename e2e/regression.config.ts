import { defineConfig } from "@playwright/test";

const local = !process.env["BASE_URL"];
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [["list"], ["github"], ["html", { outputFolder: "../e2e-report", open: "never" }], ["json", { outputFile: "../e2e-results.json" }]],
  globalSetup: "./global-setup.ts",
  use: { baseURL: process.env["BASE_URL"] ?? "http://127.0.0.1:4173", trace: "retain-on-failure", actionTimeout: 20_000, navigationTimeout: 90_000 },
  ...(local ? { webServer: { command: "bunx vite dev --port 4173 --strictPort --host 127.0.0.1", cwd: "..", url: "http://127.0.0.1:4173/auth", timeout: 240_000, reuseExistingServer: true } } : {}),
});
