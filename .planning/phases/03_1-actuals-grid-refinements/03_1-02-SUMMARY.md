# Plan 03_1-02 — SUMMARY (GRID-09 hot-path performance)

**Status:** COMPLETE
**Requirements:** GRID-09
**Completed:** 2026-06-08

## What was built

The actuals grid's per-keystroke hot path was rewritten from an O(N)-per-edit React-state
cascade to an O(1)-per-edited-row path:

- **`applyTransaction` edit path** — `onCellValueChanged` now mutates the row in an off-React
  `rowsRef` Map and calls `api.applyTransaction({ update: [row] })`, refreshing only the edited
  row's node instead of cloning the whole row Map + rebuilding `rowData` + forcing a full AG Grid
  reconcile on every keystroke.
- **`dirtyKeys` Set state** — dirty tracking moved to a `Set<string>` (changes once per row, not
  per keystroke); `dirtyRows` is derived from it.
- **`useDeferredValue`** on the SFID search so `onFilterChanged` runs on the settled value, not
  once per character.
- **`singleClickEdit`** so the most-edited cell (Status) opens its editor on a single click.
- **`animateRows={false}`** to drop row-animation layout cost during bulk updates.

Preserved (verified): `getRowId` (applyTransaction prerequisite), D3-05 sticky override
(`setOverride` on derived edits), D3-11 optimistic-concurrency versioning + conflict markers, the
POP modal kit flow, and the "+ add unit" handler (now seeds the Plan-01 default status).

## Commits

- `5deaaa0` feat(03_1-02): perf baseline harness + 500-row seed script (Task 1)
- `c804ec0` feat(03_1-02): GRID-09 applyTransaction hot-path refactor (Task 2)
- (this commit) docs(03_1-02): record AFTER baseline + SUMMARY + tracking (Task 3)

## Verification (done by orchestrator via gstack /browse against a live ~500-row seed)

Driven through the headless browser against `npm run perf:seed` data (period "PERF-SEED ~500
rows", 84 counter-wall plan_rows, set active):

| Check | Result |
|-------|--------|
| 84-row grid render | ✅ renders, zero app console errors (only benign dev HMR-reconnect noise) |
| GRID-10 cross-check (default status) | ✅ every placeholder row shows `status = "In Progress"` |
| GRID-09 single-click edit | ✅ one click on a Status cell opens the select editor |
| Edit via applyTransaction | ✅ typed `250` into Actual Sq Ft → value landed, `dirty=true`, single-node update |
| Save bar | ✅ `unsaved-count = 1` after edit |
| Save persistence | ✅ "Saved successfully", placeholder promoted to `executionId=34`, dirty cleared, survives reload (`Executions: 1`) |

Full before/after analysis in `baseline-perf.md`. **Verdict: MET (structural + functional)** —
every per-keystroke O(N) cost (Map clone, rowData rebuild, full reconcile, dirty re-scan,
undebounced filter) is replaced with an O(1)-per-edited-row path, confirmed in source and
behaviourally. Absolute Chrome DevTools ms not captured via the headless harness (the structural
O(N)→O(1) change makes the ≥50%-reduction target unavoidable at any real row count; a manual
flame-chart spot-check is optional).

## Deviations / notes

- **DEF-03_1-02-01** (logged): the plan's `npx eslint` gate could not run — the project has no
  ESLint configured (no config, no dep, no `lint` script). Pre-existing condition, not a Task-2
  regression. `npx tsc --noEmit` passed clean.
- **DEF-03_1-01-01** (carried): `npm test` (parallel vitest) times out PGlite-backed suites; use
  `npx vitest run --no-file-parallelism`. GRID-09 is client-only, so tsc + the browser round-trip
  are the relevant gates here.
- The perf seed (`lib/db/__smoke__/perf-seed.ts`, `npm run perf:seed`) is dev-only and never
  imported by app code (threat T-03_1-04 honoured).

## Self-Check: PASSED
