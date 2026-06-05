import { defineConfig } from "vitest/config";

/**
 * Vitest owns the unit/contract layer (lib/**). Playwright owns the E2E layer (e2e/**) —
 * its `test()` is a different runtime and throws if vitest collects it.
 */
export default defineConfig({
  test: {
    include: ["lib/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**", "playwright/**"],
  },
});
