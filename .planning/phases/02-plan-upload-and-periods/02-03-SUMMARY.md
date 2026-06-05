---
phase: 02-plan-upload-and-periods
plan: 03
subsystem: plan-upload-ui
tags: [client-component, server-action, useActionState, sheetjs-client, file-upload, e2e, playwright, D2-06, COMP-02, PLAN-01, PLAN-02, PLAN-03]

# Dependency graph
requires:
  - phase: 02-01
    provides: readWorkbook + coerceCell + validateHeaders + buildPreview + buildPlanTemplate + TEMPLATE_FILE_NAME + ParsedRow/PreviewRow/HeaderError types (the pure client-parseable surface)
  - phase: 02-02
    provides: commitPlanUpload + commitPlanUploadForm + CommitPlanState (the JSON Server Action the UI posts to) + countByPeriodActivity grain (extended in this plan)
  - phase: 01-03
    provides: ACTIVITIES + ACTIVITY_KEYS + ActivityKey type
  - phase: 01-04
    provides: getActivePeriod (period-selector default per D-11)
provides:
  - app/(app)/plans/page.tsx → /plans Server Component, (activity × period) grid with per-cell counts, deep-links to /plans/upload
  - app/(app)/plans/upload/page.tsx → upload-page Server shell; reads listPeriods + getActivePeriod + ?activity/?periodId searchParams; defaults active period (D-11)
  - app/(app)/plans/upload/upload-form.tsx → Client Component: file → arrayBuffer → readWorkbook → validateHeaders → buildPreview entirely in browser (D2-06); 10 MB cap; commit via useActionState → commitPlanUploadForm; surfaces success + blocked-dealers (COMP-02 transient UI)
  - app/(app)/plans/upload/preview-table.tsx → Client Component, groups by classification (fieldError → duplicate → update → valid), per-class count pills, data-slot="preview-row"
  - app/(app)/plans/upload/template-button.tsx → Client Component, browser-side template download (Blob URL); reuses buildPlanTemplate (no direct xlsx import)
  - app/(app)/layout.tsx → nav strip extended with /plans link
  - app/api/test/seed-execution/route.ts → TEST-ONLY gated Route Handler (NODE_ENV !== production + session-required) for e2e seeding
  - lib/db/plan-rows.ts → +countByPeriodActivity (grid query), +_seedExecutionForTest, +_findPlanRowIdForTest
  - e2e/plans.spec.ts → 2 Playwright tests (happy path + blocked-by-actuals — COMP-02 user-facing path)
  - e2e/fixtures/build-fixtures.ts + plan-counter-wall.xlsx + plan-counter-wall-only-b.xlsx
  - npm script: fixtures:build
affects: [phase 3 — actuals grid will replace the test-only seed Route Handler with real UI; phase 4 dashboard reads countByPeriodActivity]

# Tech tracking
tech-stack:
  added: []  # ZERO new dependencies. Only the fixtures:build script.
  patterns:
    - "Client-side parse → preview → commit (D2-06): file.arrayBuffer() (native Promise) → readWorkbook → validateHeaders → buildPreview entirely in the browser; server NEVER sees an .xlsx (CVE-2023-30533 surface eliminated). Hidden <input name=\"rows\" value={JSON.stringify(toCommit)}> posts the parsed JSON, not the File."
    - "useActionState + FormData wrapper pattern (PATTERNS.md L72-73): the form's source-of-truth is three hidden inputs (periodId, activity, rows); React state is the visible mirror. Form action = commitPlanUploadForm. State is the standard CommitPlanState union from Plan 02-02."
    - "data-slot=\"...\" as the e2e selector contract — every list/cell/badge/button gets a stable data-slot AND a data-attribute carrying the discriminator (data-activity, data-period-id, data-classification, data-sfid). Mirrors the periods/items pattern."
    - "Test-only Route Handler gating (defense-in-depth): (1) early return 404 when NODE_ENV === 'production'; (2) re-check the same jose session cookie as Server Actions; (3) POST-only. Underscore-prefixed helpers (_findPlanRowIdForTest, _seedExecutionForTest) in lib/db/plan-rows.ts are the only test surface."
    - "Browser template-download (RESEARCH §2 + §7): Blob URL + <a download> click → no Route Handler, no cold start, no bandwidth. SheetJS coupling stays in lib/excel/template.ts via buildPlanTemplate; template-button.tsx imports the helper, not xlsx directly."
    - "Period selector defaults to the active period (D-11 + CONTEXT line 46 discretion item) for the common case 'upload for current period'."
    - "countByPeriodActivity = one GROUP BY query for the entire grid (O(activities × periods) cells but O(1) DB roundtrip)."

key-files:
  created:
    - app/(app)/plans/page.tsx
    - app/(app)/plans/upload/page.tsx
    - app/(app)/plans/upload/upload-form.tsx
    - app/(app)/plans/upload/preview-table.tsx
    - app/(app)/plans/upload/template-button.tsx
    - app/api/test/seed-execution/route.ts
    - e2e/plans.spec.ts
    - e2e/fixtures/build-fixtures.ts
    - e2e/fixtures/plan-counter-wall.xlsx
    - e2e/fixtures/plan-counter-wall-only-b.xlsx
  modified:
    - app/(app)/layout.tsx (nav: added /plans link between Periods and Items)
    - lib/db/plan-rows.ts (added countByPeriodActivity + _seedExecutionForTest + _findPlanRowIdForTest)
    - package.json (added fixtures:build script ONLY; no dep change)

key-decisions:
  - "Test-only seed via gated /api/test/seed-execution Route Handler — chosen over npm-script-before-tests because Playwright config wipes .pglite/ before EVERY test run; a pre-test script would lose the seed. Defense-in-depth: NODE_ENV !== production AND session-required AND POST-only."
  - "Underscore-prefixed test helpers in lib/db/plan-rows.ts (_seedExecutionForTest, _findPlanRowIdForTest) — surface is explicit-but-hidden; lints/greps can flag any app-code reference. Same convention as _resetExecutionsForTest from Plan 02-02."
  - "Programmatic fixture build (e2e/fixtures/build-fixtures.ts) + checked-in .xlsx — CI doesn't rebuild; fixtures are 16 KB binary blobs the planner specified as the deterministic path. Run via npm run fixtures:build only on column-shape changes."
  - "Hidden <input> source-of-truth pattern for FormData — React state drives the visible UI; the three hidden inputs (periodId, activity, rows) are what the Server Action receives. Avoids the FormData/JSON impedance mismatch the planner called out."
  - "Reuse buildPlanTemplate from lib/excel — template-button.tsx contains ZERO xlsx imports. SheetJS coupling stays entirely inside lib/excel/* per D2-06."
  - "force-dynamic on both /plans and /plans/upload — they both read DB state on every request (period list + plan counts + active period). Matches the periods/items page pattern."
  - "countByPeriodActivity added to lib/db/plan-rows.ts (not lib/db/queries/plans.ts) — file structure of Phase 2 keeps all plan_rows query helpers in one module; mirrors how lib/db/periods.ts is one file. PATTERNS.md L33 'lib/db/queries/plans.ts' was an early-planning name; the actual landed file is lib/db/plan-rows.ts (Plan 02-02)."

patterns-established:
  - "Client-side file-parse pipeline in Next 16 + React 19: native File.arrayBuffer() (NOT FileReader), useActionState with FormData wrapper for the commit step, hidden JSON inputs as the source of truth."
  - "Test-only Route Handler under app/api/test/* — every file in that subtree must early-return 404 on NODE_ENV === 'production' AND require the session cookie."
  - "data-slot/data-attribute selector contract for Playwright — keeps tests stable across UI restyling."

requirements-completed: [PLAN-01, PLAN-02, PLAN-03, COMP-02]

# Metrics
duration: ~45 min
completed: 2026-06-05
---

# Phase 2 Plan 03: Plan Upload UI + E2E Summary

**Plans UI ships end-to-end: /plans grid (activity × period × count), client-side parse → preview → commit upload form (D2-06: server never sees an .xlsx), browser-side template download, COMP-02 blocked-dealers transient surface, and a Playwright suite proving both the happy path AND the FK-restrict rollback through the live UI. 82/82 vitest + 11/11 Playwright green, zero new deps.**

## Performance
- **Duration:** ~45 min
- **Completed:** 2026-06-05
- **Tasks:** 3 auto (1 grid+template+nav, 1 form+preview, 1 e2e+fixtures)
- **Files created:** 10 (5 UI files, 1 test-only Route Handler, 1 e2e spec, 1 fixture-build script, 2 .xlsx fixtures)
- **Files modified:** 3 (app/(app)/layout.tsx, lib/db/plan-rows.ts, package.json — script only)
- **Test results:** 82 / 82 vitest pass (unchanged from baseline — UI work doesn't add unit tests; e2e covers it)
- **E2E results:** 11 / 11 Playwright pass — 9 pre-existing + 2 new in `e2e/plans.spec.ts` (happy path 10.1s, blocked-by-actuals 7.7s)

## Accomplishments

### Task 1 — `/plans` grid + template button + nav (`17ce7ee`)
- **`app/(app)/plans/page.tsx`** — Server Component, `force-dynamic`. Reads `listPeriods()` and `countByPeriodActivity()` in parallel; builds a `Map<"periodId:activity", count>` for O(1) cell lookup. Renders ACTIVITY_KEYS × periods as a Tailwind grid of clickable cards. Each card is a `<Link>` to `/plans/upload?activity=X&periodId=Y` so the form lands pre-selected. Header carries a prominent "Upload a plan" button (no query) that hits the form defaults. Empty-state shows "No periods yet — create one in /periods" with a link. `data-slot="plan-grid"` on the container; `data-slot="plan-cell"` + `data-activity` + `data-period-id` on every cell (e2e selectors).
- **`app/(app)/plans/upload/template-button.tsx`** — `"use client"`. Props: `{ activity: ActivityKey }`. Click handler runs the RESEARCH §2 snippet: `buildPlanTemplate(activity)` → `Blob` → `URL.createObjectURL` → ephemeral `<a>` → `click()` → cleanup. Reuses `buildPlanTemplate` + `TEMPLATE_FILE_NAME` from `lib/excel/template`; contains ZERO `import * as XLSX` — D2-06 invariant: SheetJS coupling stays in `lib/excel/*`.
- **`app/(app)/layout.tsx`** — added `<Link href="/plans">Plans</Link>` to the nav strip between Periods and Items (deterministic order: Periods → Plans → Items → Logout). No other layout change.
- **`lib/db/plan-rows.ts`** — added `countByPeriodActivity(): Promise<{ periodId, activity, count }[]>` — single GROUP BY query for the whole grid.

### Task 2 — upload form + preview-table + upload page shell (`168588d`)
- **`app/(app)/plans/upload/page.tsx`** — Server Component, `force-dynamic`. Reads `listPeriods()` + `getActivePeriod()` + `searchParams` (Next 16's awaitable Promise shape) in parallel. Validates `?activity` against `ACTIVITY_KEYS` and `?periodId` against the real period list before treating them as defaults. Passes `{ periods, defaultActivity, defaultPeriodId }` to the Client form. Falls back to the active period when no querystring is present (D-11 + CONTEXT line 46).
- **`app/(app)/plans/upload/upload-form.tsx`** — `"use client"`, the heart of the plan.
  - `useState<ActivityKey>(defaultActivity)`, `useState<number>(periodId)`, `useState<PreviewRow[] | null>(preview)`, `useState<string | null>(parseError)`. Activity change clears `preview` (per-activity schema changed).
  - `onFile`: 10 MB cap before `file.arrayBuffer()` (RESEARCH §6 — native Promise API, not FileReader). On success: `readWorkbook(buf)` → `validateHeaders` (surfaces missing/extra/mismatch as parseError) → `buildPreview(rows, planColumns, coerceCell)` → `setPreview(...)`. All inside try/catch.
  - `useActionState<CommitPlanState, FormData>(commitPlanUploadForm, ...)` drives the commit. Three hidden inputs (`periodId`, `activity`, `rows`) are the source-of-truth FormData; React state mirrors them visually.
  - `toCommit` (memoized): every preview row with classification `valid` OR `update` and a non-null `parsed`. Posted as `JSON.stringify(toCommit)` in the hidden `rows` field.
  - On `state.ok === true`: clears preview + file input via ref, renders a success block with insert/update/delete counts and a "Back to /plans" link (`data-slot="commit-success"`).
  - On `state.ok === false` AND `state.blockedDealers` non-empty: renders the COMP-02 transient surface — `data-slot="blocked-dealers"` containing one `<li data-slot="blocked-dealer-row" data-sfid={sfid}>` per blocker with the SFID, execution count, and "Fix the source Excel … or retire its actuals" message.
  - Generic error path: `data-slot="commit-error"` + `role="alert"`.
- **`app/(app)/plans/upload/preview-table.tsx`** — `"use client"`, presentation-only. Iterates the 4 classifications in priority order (fieldError → duplicate → update → valid per CONTEXT line 118) and renders one table per non-empty group with a colored pill at the header. Per-classification count pills at the top; per-row `data-slot="preview-row"` + `data-classification` + `data-sfid` for e2e filtering. No virtualisation in v1 (CONTEXT line 45).

### Task 3 — Playwright e2e + fixtures + gated seed Route Handler (`29b6449`)
- **`e2e/fixtures/build-fixtures.ts`** — one-off generator. Reads `getActivity("counter-wall").planColumns` for the header row so the fixture's contract is identical to what `validateHeaders` will see at runtime. Writes two deterministic `.xlsx` files (~16 KB each) via SheetJS `aoa_to_sheet` + `XLSX.write({ type: "buffer" })`. The Node 24 quirk that `writeFileSync` no longer accepts raw `ArrayBuffer` was handled by asking SheetJS for `type: "buffer"` directly.
- **`e2e/fixtures/plan-counter-wall.xlsx`** — 2 rows (SF-A, SF-B). 16,683 bytes.
- **`e2e/fixtures/plan-counter-wall-only-b.xlsx`** — 1 row (SF-B only) for the blocked test. 16,387 bytes.
- **`app/api/test/seed-execution/route.ts`** — TEST-ONLY Route Handler. Defense-in-depth: (1) NODE_ENV !== "production" → 404; (2) `verifySession` against the same jose cookie as Server Actions → 401 otherwise; (3) POST only (GET → 405; 404 in prod). Body `{ periodId, activity, sfid }` → looks up the plan_row id via `_findPlanRowIdForTest` → inserts an execution via `_seedExecutionForTest`. The new helpers in `lib/db/plan-rows.ts` are underscore-prefixed; never called from app code.
- **`e2e/plans.spec.ts`** — 2 tests, both using the verbatim `login(page)` helper from periods.spec.ts.
  - **Happy path:** login → create active period (Date.now() label) → /plans/upload → select counter-wall → verify period-select option:checked contains "(active)" — D-11 default verified → setInputFiles with `plan-counter-wall.xlsx` → preview shows exactly 2 rows, both `data-classification="valid"` → click commit → `data-slot="commit-success"` visible containing "2" and "inserted" → /plans cell for counter-wall + period shows "2" and "rows".
  - **Blocked-by-actuals (COMP-02 user-facing path):** login → create active period → upload+commit `plan-counter-wall.xlsx` (2 rows) → grab `periodId` from the form's period-select `option:checked` value → POST `/api/test/seed-execution` with cookie jar copied from `page.context().cookies()` → re-upload `plan-counter-wall-only-b.xlsx` (drops SF-A) → preview shows exactly 1 row → click commit → `data-slot="blocked-dealers"` visible containing "SF-A" and "execution"; no `commit-success` rendered → /plans cell STILL shows "2 rows" (rollback held — no destructive write; D2-01 surfaced through the UI).

## Task Commits
1. **Task 1 (feat): /plans grid + template button + nav link** — `17ce7ee`
2. **Task 2 (feat): upload form (client parse) + preview-table + page shell** — `168588d`
3. **Task 3 (test): Playwright e2e — happy path + blocked-by-actuals (COMP-02)** — `29b6449`

## Files Created/Modified
- **Created** (10): 
  - UI: `app/(app)/plans/page.tsx`, `app/(app)/plans/upload/page.tsx`, `app/(app)/plans/upload/upload-form.tsx`, `app/(app)/plans/upload/preview-table.tsx`, `app/(app)/plans/upload/template-button.tsx`
  - Test seam: `app/api/test/seed-execution/route.ts`
  - E2E: `e2e/plans.spec.ts`, `e2e/fixtures/build-fixtures.ts`, `e2e/fixtures/plan-counter-wall.xlsx`, `e2e/fixtures/plan-counter-wall-only-b.xlsx`
- **Modified** (3): `app/(app)/layout.tsx` (nav link), `lib/db/plan-rows.ts` (+countByPeriodActivity, +_seedExecutionForTest, +_findPlanRowIdForTest), `package.json` (+fixtures:build script)

## Decisions Made
See `key-decisions` frontmatter. Headlines:
1. **Test-only seed via gated Route Handler** (not an npm pre-test script) because Playwright wipes `.pglite/` before every run; pre-test seed would be lost. Three independent gates: NODE_ENV check + session cookie + POST-only.
2. **Underscore-prefixed test helpers** in `lib/db/plan-rows.ts` keep the test surface explicit and greppable.
3. **Programmatic fixture build, fixtures committed** — `npm run fixtures:build` regenerates only on column-shape changes; CI uses the checked-in binaries.
4. **Hidden `<input>` source-of-truth pattern** — keeps FormData/JSON impedance clean while preserving useActionState ergonomics.
5. **Reuse `buildPlanTemplate`** — template-button.tsx contains ZERO direct xlsx import (D2-06 invariant maintained even though this is a Client Component where xlsx would be permitted).
6. **`countByPeriodActivity` lives in `lib/db/plan-rows.ts`** (not a separate `queries/plans.ts` file) — Phase 2's data-access for plan_rows is one module, matching how `lib/db/periods.ts` works.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Node 24 `writeFileSync` rejects raw `ArrayBuffer`**
- **Found during:** Task 3, first `npm run fixtures:build` run.
- **Issue:** `XLSX.write({ type: "array" })` returns an `ArrayBuffer`; Node 24's `writeFileSync` only accepts `string | Buffer | TypedArray | DataView` — not `ArrayBuffer`. Caused `TypeError [ERR_INVALID_ARG_TYPE]`.
- **Fix:** Switched the fixture builder to `XLSX.write({ type: "buffer" })`, which returns a Node `Buffer` directly. The browser path (upload-form / template-button) still uses `{ type: "array" }` because `Blob` and `URL.createObjectURL` accept `ArrayBuffer`.
- **Files modified:** `e2e/fixtures/build-fixtures.ts`
- **Commit:** `29b6449`

**2. [Rule 2 - Missing functionality] Test-only Route Handler needed `_seedExecutionForTest` and `_findPlanRowIdForTest` helpers**
- **Found during:** Task 3, drafting the Route Handler.
- **Issue:** The plan said "expose `_seedExecutionForTest(planRowId)` … mirroring `_resetPlanRowsForTest`". The Route Handler also needs to resolve the integer plan_row id from `(periodId, activity, sfid)` — the only identifier the e2e owns. Without a lookup helper, the Route Handler would need to import Drizzle + planRows directly, leaking DB internals.
- **Fix:** Added both helpers underscore-prefixed in `lib/db/plan-rows.ts` (alongside `_resetExecutionsForTest`). The Route Handler stays thin: parse JSON → look up id → seed → return JSON.
- **Files modified:** `lib/db/plan-rows.ts`
- **Commit:** `29b6449`

### Scope-Boundary Deviations
None. All work scoped to `app/(app)/plans/**`, `app/(app)/layout.tsx`, `app/api/test/**`, `lib/db/plan-rows.ts` (added helpers only — did not rewrite existing exports per scope_guard), `e2e/plans.spec.ts`, `e2e/fixtures/**`, `package.json` (script only).

---
**Total deviations:** 2 auto-fixed (Rule 1 + Rule 2), 0 deferred, 0 architectural.
**Impact on plan:** None. All success criteria met. COMP-02 user-facing path proven end-to-end through the UI.

## Issues Encountered
- The `writeFileSync` / `ArrayBuffer` ARG_TYPE incompatibility was the only friction — fixed in seconds by switching to SheetJS `type: "buffer"` for the Node-side fixture builder. The browser side is unaffected because Blob accepts ArrayBuffer.
- Port 3000 needed clearing between the targeted (`--grep "plans"`) and the full Playwright runs because Playwright's webServer is configured with `reuseExistingServer: false`. Not a code issue.
- Build emits `RuntimeError: Aborted()` from PGlite during the static-page-generation pass on `/plans` and `/plans/upload` — pre-existing behavior on this stack (same noise appears on `/periods` and `/items` in prior waves). Build exits 0; routes are present.

## User Setup Required
None. All verification runs cleanly via:
```bash
npm test                          # 82 / 82 green
npm run build                     # compiles; /plans + /plans/upload + /api/test/seed-execution all present
npm run e2e -- --grep "plans"     # 2 / 2 plans tests pass
npm run e2e                       # full suite 11 / 11 pass
npm run fixtures:build            # regenerates e2e/fixtures/plan-counter-wall{,-only-b}.xlsx
```

## Next Phase Readiness
- **Phase 2 closes here.** All four targeted requirements (PLAN-01 template, PLAN-02 header validate UI, PLAN-03 preview UI, COMP-02 transient surface) are shipped and proven via Playwright. Plan 02-02's [BLOCKING] D2-01 smoke is the structural proof; this plan's blocked-by-actuals e2e is the user-facing proof.
- **Phase 3 (Actuals UI / Grid) inputs:**
  - The test-only `/api/test/seed-execution` Route Handler will be **deleted** once the real actuals UI exists (it's noted in code comments). Phase 3 should add the real flow first, then remove the Route Handler in the same wave that wires the e2e to use the new UI.
  - `countByPeriodActivity` is general enough for the Phase 4 dashboard's plan-coverage summary; if it becomes hot, add a covering index (`plan_rows.period_id, activity` is already part of `plan_rows_filter_idx`).
  - The Client Component pattern (file → arrayBuffer → parse → preview → commit) is reusable for any future Phase-3 import surfaces (actuals bulk-paste, etc.).

## Self-Check: PASSED

**Created files exist:**
- `app/(app)/plans/page.tsx` — FOUND
- `app/(app)/plans/upload/page.tsx` — FOUND
- `app/(app)/plans/upload/upload-form.tsx` — FOUND
- `app/(app)/plans/upload/preview-table.tsx` — FOUND
- `app/(app)/plans/upload/template-button.tsx` — FOUND
- `app/api/test/seed-execution/route.ts` — FOUND
- `e2e/plans.spec.ts` — FOUND
- `e2e/fixtures/build-fixtures.ts` — FOUND
- `e2e/fixtures/plan-counter-wall.xlsx` — FOUND (16,683 bytes)
- `e2e/fixtures/plan-counter-wall-only-b.xlsx` — FOUND (16,387 bytes)
- `app/(app)/layout.tsx` — MODIFIED (nav link added)
- `lib/db/plan-rows.ts` — MODIFIED (+3 helpers)
- `package.json` — MODIFIED (fixtures:build script only)

**Commits exist:**
- `17ce7ee` (Task 1) — FOUND
- `168588d` (Task 2) — FOUND
- `29b6449` (Task 3) — FOUND

**Acceptance gates verified:**
- `app/(app)/plans/page.tsx` contains `force-dynamic`, `ACTIVITY_KEYS`, `countByPeriodActivity`, `data-slot="plan-grid"`, `data-slot="plan-cell"`.
- `app/(app)/plans/upload/template-button.tsx` line 1 = `"use client"`; contains `buildPlanTemplate`, `TEMPLATE_FILE_NAME`, `URL.createObjectURL`; ZERO `from "xlsx"` matches.
- `app/(app)/layout.tsx` contains `href="/plans"` AND existing `href="/periods"` + `href="/items"` + `<form action={logout}>` lines unchanged.
- `app/(app)/plans/upload/upload-form.tsx` line 1 = `"use client"`; contains `readWorkbook`, `validateHeaders`, `buildPreview`, `file.arrayBuffer`, `useActionState`, `commitPlanUploadForm`, hidden `name="rows"`, `data-slot="blocked-dealers"`.
- `app/(app)/plans/upload/preview-table.tsx` contains `data-slot="preview-row"` AND all 4 classifications (fieldError/duplicate/update/valid).
- 10 MB cap (`10 * 1024 * 1024`) present in upload-form.tsx.
- ZERO `from "xlsx"` matches in `lib/db/**/*.ts` or `lib/actions/**/*.ts` (D2-06).
- `app/api/test/seed-execution/route.ts` contains `NODE_ENV.*production` check.
- `git diff package.json` shows only the `fixtures:build` script added.
- `npm test` → 82 / 82 green.
- `npm run build` → compiles; routes `/plans`, `/plans/upload`, `/api/test/seed-execution` all present.
- `npm run e2e -- --grep "plans"` → 2 / 2 pass.
- `npm run e2e` → 11 / 11 pass (full suite).

## Threat Flags
None. All new surface is covered by the plan's `<threat_model>` register:
- T-02-03-01 (crafted .xlsx in browser parser): accepted — SheetJS CE 0.20.3 has the CVE-2023-30533 fix; D2-06 keeps the parser client-side so server blast radius is zero; 10 MB cap bounds memory.
- T-02-03-02 (future server-side xlsx import): mitigated — acceptance gate `grep "from \"xlsx\""` returns ZERO matches in `lib/db/**` and `lib/actions/**`.
- T-02-03-03 (test-only Route Handler reachable in production): mitigated — explicit `if (process.env.NODE_ENV === "production") return NOT_FOUND` AND session-required AND POST-only.
- T-02-03-04 (browser bypasses preview to post dirty data): mitigated by Plan 02-02's server-side Zod re-check (`parseCommitInput` runs `PLAN_ROW_SCHEMAS[activity]` with `.strict()` on every row).
- T-02-03-05 (blockedDealers exposes SFIDs): accepted — intended COMP-02 surface; no PII.
- T-02-03-06 (100 MB .xlsx DoS): mitigated — 10 MB hard cap before `arrayBuffer()`.
- T-02-03-SC (npm installs): mitigated — `git diff package.json` shows ONLY the `fixtures:build` script.

---
*Phase: 02-plan-upload-and-periods*
*Completed: 2026-06-05*
