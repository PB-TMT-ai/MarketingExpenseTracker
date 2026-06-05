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
    // Wipe .pglite/ BEFORE `next dev` launches so PGlite's WASM FS and the on-disk
    // data dir start aligned. instrumentation.ts then re-migrates into the fresh dir
    // on first request. Doing the wipe inside the same shell as `next dev` makes the
    // ordering deterministic (no race with Turbopack's lazy module loading).
    command:
      "node -e \"require('fs').rmSync('.pglite',{recursive:true,force:true});require('fs').mkdirSync('.pglite',{recursive:true})\" && npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: false,
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
