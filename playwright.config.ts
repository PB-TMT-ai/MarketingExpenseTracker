import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — boots `npm run dev` against the local PGlite DB and drives Chromium.
 *
 * E2E specs live under `e2e/` and verify behavior that the type checker and vitest can't
 * (live UI flow: form submit, redirects, cookie set, page rerender). Vitest still owns the
 * unit/contract layer (lib/auth, lib/activities, lib/actions/*.test.ts) — Playwright is
 * the integration layer.
 */
export default defineConfig({
  testDir: "./e2e",
  // Single worker is the safest default given PGlite is single-connection per process and
  // the dev server is a shared instance — parallel workers would race the cookie jar and
  // the DB. We can relax this once a deploy story (separate test DB) exists.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_500 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
