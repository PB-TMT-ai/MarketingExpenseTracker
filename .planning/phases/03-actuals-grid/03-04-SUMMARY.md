---
phase: 03-actuals-grid
plan: 04
subsystem: actuals-grid-ui
tags: [actuals, ag-grid, filter, save-bar, conflict, e2e, D3-01, D3-02, D3-03, D3-05, D3-06, D3-07, D3-08, D3-10, D3-11, D3-12, GRID-01, GRID-02, GRID-03, GRID-05, GRID-07]

# Dependency graph
requires:
  - phase: 03
    plan: 01
    provides: "AG Grid GO verdict + integration recipe (A1-A6)"
  - phase: 03
    plan: 02
    provides: "lib/actuals/* pure core (buildColumnDefs, buildRowModel, computeDerived, isOverridden/setOverride/clearOverride, optionsFor, matchesFacets, matchesSfid)"
  - phase: 03
    plan: 03
    provides: "saveExecutionsBatch Server Action + listExecutionsByPeriodActivity + _findExecutionForTest"
provides:
  - "/actuals route — editable AG Grid for one (period, activity) slice; the daily-use core of the product"
  - "Actuals nav link in app/(app)/layout.tsx"
  - "app/(app)/actuals/page.tsx — Server Component, force-dynamic, active-period gate, activity selector, server-side buildRowModel"
  - "app/(app)/actuals/ag-grid-setup.ts — AllCommunityModule registration (A2 recipe)"
  - "app/(app)/actuals/actuals-grid.tsx — use client, mounted-guard, dotted plan./fields. binding, derived valueGetters, dirty tracking, + add unit, conflict row markers, dev window.__actualsGridApi"
  - "app/(app)/actuals/filter-bar.tsx — cascading Region/State/District + independent Distributor/Status + SFID search (D3-06/07/08)"
  - "app/(app)/actuals/save-bar.tsx — unsaved count, saveExecutionsBatch, savedId version update, conflict detection, save-confirmation (D3-10/11/12)"
  - "app/api/test/seed-execution/route.ts — extended to return executionId + version (all 3 gates preserved)"
  - "e2e/actuals.spec.ts — 3 tests: edit→Save→reload, derived totalCost live, stale-version conflict"
affects:
  - "03-05 (POP modal + Dealer-Certificate polish — reuses this page's props contract and data-slot selectors)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mounted-guard SSR (A3 confirmed): useState+useEffect in 'use client' grid; no next/dynamic({ssr:false}) needed. AllCommunityModule registered once at module scope in ag-grid-setup.ts."
    - "themeQuartz default (A4): NO CSS import. Auto-injects into <head>. No Tailwind collision. Container needs explicit height (600px used)."
    - "Dotted field paths (A1): plan.* binds read-only plan columns, fields.* binds editable actuals. Works with nested row shape { plan: {...}, fields: {...} }."
    - "v35 API: api.getCellValue({rowNode,colKey}) / api.setGridOption(...) — getValue() is gone. ensureColumnVisible used for column-virtualization e2e."
    - "Column virtualization e2e: window.__actualsGridApi exposed in dev mode; e2e calls ensureColumnVisible before interacting with off-screen columns."
    - "Conflict row markers: __conflict flag in row.fields; rendered as [data-slot=row-conflict] banners outside the grid; window.location.reload() on 'Reload' click."
    - "SaveBar uses useActionState with an inline async wrapper function (not a Server Action import directly) to capture the current dirtyRows closure."

key-files:
  created:
    - app/(app)/actuals/page.tsx
    - app/(app)/actuals/ag-grid-setup.ts
    - app/(app)/actuals/actuals-grid.tsx
    - app/(app)/actuals/filter-bar.tsx
    - app/(app)/actuals/save-bar.tsx
    - e2e/actuals.spec.ts
  modified:
    - app/(app)/layout.tsx
    - app/api/test/seed-execution/route.ts
    - app/(app)/actuals/actuals-grid.tsx
  deleted:
    - app/(app)/spike-grid/page.tsx
    - app/(app)/spike-grid/spike-grid.tsx

decisions:
  - "D3-01 flat one-row-per-unit grid honored: page assembles buildRowModel server-side, passes initialRows[] to client grid."
  - "D3-02 zero-execution dealer = placeholder row: buildRowModel from 03-02 handles this; placeholder flag propagated through grid state."
  - "D3-05 derived cells auto-compute via valueGetter (override short-circuit); setOverride called in onCellValueChanged when a derived colDef's valueGetter is detected."
  - "D3-06/07/08 filter bar: multi-select dropdowns cascade via optionsFor; SFID search uses matchesSfid (plan.sfid only, not quickFilter)."
  - "D3-10/11/12 Save bar: useActionState wrapper captures dirtyRows closure at click time; onSaveResult updates version on savedIds, marks __conflict on conflicts; no last-write-wins."
  - "Spike cleanup: app/(app)/spike-grid/ deleted; real /actuals grid supersedes it per 03-01-SUMMARY cleanup note."
  - "Dev grid API: window.__actualsGridApi exposed in dev mode for e2e column-virtualization handling (ensureColumnVisible). Not exposed in production."

status: complete
requirements: [GRID-01, GRID-02, GRID-03, GRID-05, GRID-07]
commits:
  - "fe3cc42: feat(03-04): actuals grid page + AG Grid wiring + nav link + spike cleanup"
  - "ad2e5d9: feat(03-04): e2e actuals grid + extend seed route + dev grid API hook"
---

# Phase 03 · Plan 04 — Actuals Grid UI Integration — SUMMARY

## One-liner

Working /actuals route: editable AG Grid (plan read-only, actuals editable, derived totalCost live via valueGetter) + cascading filter bar + version-safe Save bar with conflict surfacing — proven end-to-end by 3 Playwright tests.

## What shipped

### Page contract (`app/(app)/actuals/page.tsx`)

Server Component, `export const dynamic = "force-dynamic"`. Mirrors `/plans/page.tsx` shape:
- `getActivePeriod()` first; if null → "create a period" empty state.
- Activity selector rendered as Link pills (`?activity=<key>`) with data-slot="activity-select".
- `listByPeriodActivity` + `listExecutionsByPeriodActivity` + `listItems()` in parallel.
- `buildRowModel(planRows, executions)` assembled server-side → `initialRows: UnitRow[]` passed to client.
- `activeItems` passed as items prop (stable contract for 03-05 POP modal).

**Props contract for 03-05:**
```typescript
<ActualsGrid
  initialRows={UnitRow[]}     // server-assembled flat row model
  activityKey={string}        // e.g. "counter-wall"
  periodId={number}           // active period id
  items={ItemRow[]}           // active item master rows (for 03-05 POP modal)
/>
```

### AG Grid wiring (`actuals-grid.tsx`)

**Integration recipe (verbatim from 03-01, confirmed working in production build):**
- `import "./ag-grid-setup"` at module top — runs `ModuleRegistry.registerModules([AllCommunityModule])` once.
- Mounted-guard: `const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), [])` — renders placeholder until client-side. NO `next/dynamic({ssr:false})` needed.
- `getRowId={(p) => p.data.rowKey}` for stable AG Grid identity.
- `defaultColDef.cellClassRules: { "ag-cell-dirty": (p) => p.data?.dirty }` for yellow-tint dirty rows.
- `isExternalFilterPresent` + `doesExternalFilterPass` wired to FilterBar state via refs (stale-closure safe).
- `onCellValueChanged`: updates `rowMap` (Map<rowKey, UnitRow>), marks `dirty: true`, calls `setOverride` if a derived column was edited manually (D3-05).
- `__actualsGridApi` exposed on `window` in dev mode for e2e `ensureColumnVisible` (column virtualization).

### Filter bar (`filter-bar.tsx`)

- Multi-select `<select multiple>` for Region → State → District (cascade) + Distributor + Status (independent).
- Options derived from `optionsFor(allRows, col, upstream)` — no server round-trip needed at ≤1k rows (D3-08).
- SFID search: dedicated `<input>` bound to `matchesSfid` (plan.sfid only — A6 finding).
- Clear per-facet button and "Clear all".
- `data-slot` inventory: `filter-bar`, `filter-region`, `filter-state`, `filter-district`, `filter-distributor`, `filter-status`, `sfid-search`.

### Save bar (`save-bar.tsx`)

- `useActionState` with an inline async wrapper that captures the `dirtyRows` closure at click time.
- `UnitPatch[]` built from `dirtyRows`: `{ rowKey, planRowId, executionId, version, fields, isPlaceholder }` (never sfid).
- `onSaveResult(result: SaveBatchState)` callback: clear dirty + update executionId+version from `savedIds`; mark `fields.__conflict = true` from `conflicts[]` (D3-11 — no last-write-wins).
- Transient "Saved successfully" flash (3 s) after a clean save with no conflicts.
- `data-slot` inventory: `save-bar`, `unsaved-count`, `save-button`, `save-confirmation`.

### Conflict row markers

- Rendered outside the grid as banners (not in AG Grid cells) with `data-slot="row-conflict"`.
- "Reload" button calls `window.location.reload()` to fetch fresh server state.
- D3-11 block-not-overwrite: conflict rows keep their client-edited value until the user reloads.

### Seed route extension (`app/api/test/seed-execution/route.ts`)

Extended to return `{ planRowId, executionId, version }` after seeding (was `{ planRowId }`). All 3 gates preserved:
1. `NODE_ENV !== "production"` → 404.
2. Session cookie required → 401.
3. POST-only → 405 on GET.

Uses `_findExecutionForTest(planRowId)` (from 03-03) to read back the inserted row's id+version.

### E2E (`e2e/actuals.spec.ts`)

3 tests, all green:

| Test | Assertion |
|------|-----------|
| edit→Save→reload | wallShopNo="WALL-001" persists through page.reload() |
| derived totalCost | 100×50=5000 visible in totalCost cell before Save |
| stale-version conflict | [data-slot="row-conflict"] appears; SF-A has page2's value (PAGE2-SAVE), not page1's stale (STALE-ATTEMPT); SF-B sibling saves (SIBLING-OK) |

**e2e helpers for 03-05 reuse:**
- `ensureColumnVisible(page, colId)` — calls `window.__actualsGridApi.ensureColumnVisible(colId)` to scroll off-screen columns into DOM before interacting.
- `editCell(page, rowIndex, colId, value)` — dblclick + Control+a + type + Tab.
- `getCellText(page, rowIndex, colId)` — ensureColumnVisible + textContent.
- `waitForGrid(page)` — waits for `.ag-root-wrapper` + first `.ag-row`.

## data-slot selector inventory for /actuals (03-05 reuse)

| Slot | Element | Purpose |
|------|---------|---------|
| `actuals-page` | page root div | Page-level presence assertion |
| `activity-select` | nav link container | Activity selector |
| `actuals-grid` | ActualsGrid root div | Grid presence |
| `filter-bar` | FilterBar root | Filter UI presence |
| `filter-region` | Region multi-select | Geographic cascade |
| `filter-state` | State multi-select | Geographic cascade |
| `filter-district` | District multi-select | Geographic cascade |
| `filter-distributor` | Distributor multi-select | Independent facet |
| `filter-status` | Status multi-select | Independent facet |
| `sfid-search` | SFID input | Dedicated SFID search |
| `save-bar` | SaveBar root | Save bar presence |
| `unsaved-count` | Count span | Dirty row count |
| `save-button` | Save submit button | Trigger save |
| `save-confirmation` | Success span | Post-save flash |
| `row-conflict` | Conflict banner | Stale-version conflict marker |

## Verification

| Check | Result |
|-------|--------|
| `npm run build` | Passes — /actuals is `ƒ Dynamic` |
| `npx tsc --noEmit` | Clean (zero errors) |
| `npm test` | 195/195 tests pass (no regressions) |
| `npx playwright test e2e/actuals.spec.ts` | 3/3 tests pass |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] AG Grid col-id selector vs. column virtualization**
- **Found during:** Task 3 (first e2e run)
- **Issue:** AG Grid column virtualization — columns outside the viewport are not in the DOM. `scrollIntoViewIfNeeded` on a non-existent element timed out for `fields.actualSqft`, `fields.wallShopNo`, `totalCost`.
- **Fix:** Exposed `window.__actualsGridApi` (dev-only) in `onGridReady`; e2e calls `api.ensureColumnVisible(colId)` before interacting with any potentially off-screen column.
- **Files modified:** app/(app)/actuals/actuals-grid.tsx, e2e/actuals.spec.ts

**2. [Rule 1 - Bug] getCellText during cell-edit mode returns empty string**
- **Found during:** Task 3 (test 2 — derived totalCost)
- **Issue:** After editing perUnitCost, Tab moved focus into the totalCost derived cell (opening its editor). `textContent()` on a cell in edit mode returns the editor input's value, which `page.evaluate` sees as empty.
- **Fix:** After perUnitCost edit, press Escape to close any open editor; click grid header to deselect; then use `page.locator(...).toContainText("5000")` which waits and retries.
- **Files modified:** e2e/actuals.spec.ts

**3. [Rule 2 - Missing] `saveExecutionsBatch` second argument typing**
- **Found during:** Task 2 implementation
- **Issue:** The SaveBar needed to call `saveExecutionsBatch(undefined, payload)` — the first arg is `_prev: unknown` per Server Action signature. The `useActionState` wrapper was written as an inline async function so it captures the correct `dirtyRows` closure. This pattern is different from the plans form but is correct for the grid's stateful Save flow.
- **Fix:** Used an inline async wrapper in `useActionState` rather than referencing the Server Action directly (which would not see the current `dirtyRows` closure).
- **Files modified:** app/(app)/actuals/save-bar.tsx

### Spike cleanup
Deleted `app/(app)/spike-grid/` (2 files) per 03-01-SUMMARY cleanup note. The `window.__spikeApi` hook is gone; replaced by `window.__actualsGridApi` in the real grid.

## Known Stubs

**POP modal (03-05):** The `items` prop is passed from the page but `ActualsGrid` does not yet render a multi-item POP modal. The prop is received and forwarded through the component tree but not consumed. This is intentional — 03-05 will wire the POP modal without changing the page's props contract.

## Threat Flags

None beyond what the plan's threat model covers. No new network endpoints added. The `window.__actualsGridApi` hook is guarded by `process.env.NODE_ENV !== "production"` — it does not exist in the production build.

## Self-Check: PASSED

Files exist:
- app/(app)/actuals/page.tsx ✓
- app/(app)/actuals/ag-grid-setup.ts ✓
- app/(app)/actuals/actuals-grid.tsx ✓
- app/(app)/actuals/filter-bar.tsx ✓
- app/(app)/actuals/save-bar.tsx ✓
- e2e/actuals.spec.ts ✓
- app/api/test/seed-execution/route.ts ✓ (extended)
- app/(app)/spike-grid/ — confirmed deleted ✓

Commits exist:
- fe3cc42 ✓
- ad2e5d9 ✓
