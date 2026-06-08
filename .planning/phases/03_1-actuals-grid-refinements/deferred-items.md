# Deferred Items — Phase 03_1 (Actuals Grid Refinements)

Out-of-scope discoveries logged during execution. NOT fixed in the plan that found them.

## DEF-03_1-02-01 — No ESLint configured in the project

- **Found during:** Plan 03_1-02, Task 2 (GRID-09 hot-path refactor) verification.
- **Issue:** The plan's `<verify>` command runs `npx eslint "app/(app)/actuals/actuals-grid.tsx"`, but the project has no ESLint wired up: no `lint` npm script, no `eslint`/`eslint-config-next` devDependency, and no `eslint.config.*` / `.eslintrc*` at the repo root. `npx eslint` therefore downloads a bare global eslint@10 and fails with "ESLint couldn't find an eslint.config file."
- **Impact:** The eslint gate cannot run. The TypeScript gate (`npx tsc --noEmit`) DID pass clean on the refactor, which is the meaningful correctness check for this client-only change. `next build` (which runs Next's own lint+typecheck) remains available as a fuller gate.
- **Disposition:** Out of scope for Task 2 (pre-existing project condition, not a regression introduced by the refactor). Adding an ESLint config is a tooling task for a future chore, not part of GRID-09.
- **Suggested fix (future chore):** `npm i -D eslint eslint-config-next` and add a flat `eslint.config.mjs` extending `next/core-web-vitals` + a `"lint": "next lint"` (or `eslint .`) script.

## DEF-03_1-04-01 — Dealer Certificate `cost` (currency) does not persist after reload

- **Found during:** Plan 03_1-04, Task 3 (`npx playwright test e2e/actuals.spec.ts`) — the pre-existing Test 5 "Dealer Certificate: Status + Date + Cost persist inline (no popup)".
- **Issue:** After setting Status=Done, Date=2026-09-15, Cost=1500 via the grid API and Saving (save-confirmation shows, post-reload page snapshot reports "Executions: 1"), the reloaded row has Status=Done and Date=2026-09-15 but the **Cost cell is empty**. The save assertion (`save-confirmation`) and the status/date round-trip pass; only the `cost` (kind `currency`) value is lost across the save→reload boundary.
- **Root cause (characterized, not fixed):** lives in the server save/load path for the `currency` `cost` field on the `dealer-certificate` (type `status`) activity — i.e. `lib/actions/executions.ts` (numeric/currency promotion on save) and/or the actuals page loader that reconstructs `fields.*` on reload. Status (a status column) and date round-trip fine; only currency drops. NONE of these files are in Plan 03_1-04's `files_modified`.
- **Proof it is NOT a 03_1-04 regression:** the `getDirtyUnits` payload built by this plan's `useSaveExecutions` hook (`{rowKey, planRowId, executionId, version, fields: row.fields, isPlaceholder, popLines}`) is byte-identical to the OLD SaveBar's `units.map(...)` at the pre-plan baseline `edeb3eb` — `fields: row.fields` carries `cost` unchanged in both. Task 1 refactored only WHERE the `useActionState` lives (presentational split + single source of truth), not the units shape. The failure point (line 515, a post-reload `getCellText` read) is downstream of the save and on a line this plan never edited.
- **Disposition:** Out of scope for Plan 03_1-04 (client-only save-bar/paste plan). Pre-existing defect in the currency persistence path for status-type activities.
- **Suggested fix (future):** trace `cost` through `saveExecutionsBatch` → `promoteExecutionColumns`/`applyServerCalc` and the actuals loader for `dealer-certificate`; confirm the currency column is written to (and re-read from) the right column/jsonb key. Add a server-side unit test asserting a `currency` actual round-trips for a `status`-type activity.

## DEF-03_1-04-02 — Stale-version e2e flakes on the second-browser-context grid load

- **Found during:** Plan 03_1-04, Task 3 run — the pre-existing Test 3 "stale-version Save surfaces row-conflict…".
- **Issue:** The test times out (45s) at line ~292 `sfACell2.scrollIntoViewIfNeeded()` — waiting for `.ag-row[row-index="0"]` to appear in the **second browser context** (`page2`). The first-context save (page1) — including this plan's re-scoped `save-bar-bottom` selectors — succeeds and the test progresses past it; the hang is the page2 AG-grid never rendering a data row in time.
- **Root cause (characterized, not fixed):** second-`browserContext` + fresh PGlite single-connection dev server timing; the page2 grid load races the shared server / cookie jar (the very reason `playwright.config.ts` pins `workers:1` + `reuseExistingServer:false`). Unrelated to the save-bar selectors (which are upstream and worked) and to GRID-12/GRID-13.
- **Proof it is NOT a 03_1-04 regression:** this plan's only edits inside Test 3 were re-scoping the page1 + page2 `save-button`/`save-confirmation` selectors to `save-bar-bottom`; those resolved and fired correctly. The timeout is on an AG-row locator (never edited) in page2.
- **Disposition:** Out of scope for Plan 03_1-04. Pre-existing multi-context timing fragility.
- **Suggested fix (future):** add an explicit `await page2.waitForLoadState("networkidle")` + a longer grid-ready wait (or a retry) before interacting with the page2 grid; consider a dedicated test DB so the two contexts don't share one PGlite connection.
