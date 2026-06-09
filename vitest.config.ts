import { defineConfig } from "vitest/config";

/**
 * Vitest owns the unit/contract layer (lib/**). Playwright owns the E2E layer (e2e/**) —
 * its `test()` is a different runtime and throws if vitest collects it.
 *
 * `DATABASE_URL=memory://` isolates vitest's PGlite from the dev server's `./.pglite`
 * directory. PGlite is single-connection (real Postgres postmaster locking under
 * Emscripten/WASM), so opening `./.pglite` while `next dev` already holds it aborts
 * the WASM runtime on first query (`CREATE SCHEMA IF NOT EXISTS "drizzle"`). An
 * in-memory instance gives each `vitest run` its own ephemeral DB; the user's local
 * dev DB is left alone. CI also gets in-memory by default. Override via the shell
 * (`DATABASE_URL=postgres://... vitest run`) to test against a real Postgres.
 */
export default defineConfig({
  test: {
    include: [
      "lib/**/*.{test,spec}.{ts,tsx}",
      "app/**/*.{test,spec}.{ts,tsx}",
    ],
    exclude: ["node_modules/**", ".next/**", "e2e/**", "playwright/**"],
    // `globals: true` lets @testing-library/react auto-register its `afterEach(cleanup)`
    // hook, which unmounts the React tree between tests. Without it, the jsdom body
    // accumulates components and `getByRole("button", { name: /Region/i })` finds
    // multiple matches across tests in multi-select-popover.test.tsx.
    globals: true,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? "memory://",
    },
  },
});
