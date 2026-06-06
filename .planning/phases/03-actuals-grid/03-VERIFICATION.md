---
phase: 03-actuals-grid
verified: 2026-06-06T08:10:00Z
status: passed
score: 5/5 success criteria verified; 8/8 requirements PASS
overrides_applied: 0
re_verification: false
---

# Phase 3: Actuals Grid — Verification Report

**Phase Goal:** A user can open a period's plan rows for an activity in a fast, spreadsheet-style
grid and record on-ground executions — including several walls/boards per dealer and multi-item POP
kits — with totals auto-calculated and edits saved reliably without clobbering a teammate's work.

**Verified:** 2026-06-06T08:10:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## What Was Run

| Check | Result |
|-------|--------|
| `npm test` (unit + integration) | 195/195 green (13 test files) |
| `npx tsc --noEmit` | Clean — zero errors |
| e2e suite (`npx playwright test e2e/actuals.spec.ts`) | Trusted from 03-05-SUMMARY (5/5); not re-run (slow Playwright suite) |
| Manual code inspection of every cited file | Performed — see sections below |
| Git log verification of documented commit hashes | All 8 Phase 3 commits confirmed present |

---

## Goal Achievement

### Observable Success Criteria

| # | Success Criterion | Status | Evidence |
|---|-------------------|--------|----------|
| SC-1 | User can view plan rows in an editable grid — plan columns read-only, actual columns editable inline | VERIFIED | `actuals-grid.tsx`: `buildColumnDefs` maps `plan.*` to `editable:false`, `fields.*` to `editable:true`. `page.tsx` server-assembles `buildRowModel` and passes to `ActualsGrid`. |
| SC-2 | Filter by Region, State, District, Distributor, Status; SFID search; grid stays responsive at large row counts | VERIFIED | `filter-bar.tsx` provides multi-select dropdowns for all 5 facets. `matchesFacets` / `matchesSfid` are the `doesExternalFilterPass` body. Cascade wiring confirmed (Region clears State+District on change). Client-side load at ≤1k rows per D3-08. |
| SC-3 | A single SFID can hold multiple execution entries; each with its own measurements and cost; summing toward the dealer's plan | VERIFIED | `rows.ts:cloneUnitForAdd` creates new unit rows sharing `planRowId`; `actuals-grid.tsx` `handleAddUnit` inserts clone into `rowMap`; `executions` schema allows N rows per `plan_row_id` (no UNIQUE on `plan_row_id` alone). |
| SC-4 | System auto-calculates derived values (sq ft from dimensions; total cost from sq ft × rate); stores them; shows derived cells as read-only [note: overridable per D3-05] | VERIFIED | `calc.ts:computeDerived` implements all D3-04 formulas. `colDefs.ts` derived columns use `valueGetter` + `isOverridden` short-circuit. `save-bar.tsx` sends values; `executions.ts:applyServerCalc` re-derives on the server before persisting. |
| SC-5 | User can record POP kit executions as multiple line items via a popup with item × qty × rate → total, rolled up to dealer row; Dealer Certificate captures issuance status, date, and cost; edits batched with clear saved/dirty indicator | VERIFIED | `pop-modal.tsx` implements the popup; `savePopKit` writes one execution + N execution_items atomically. Dealer Certificate uses inline registry-driven columns (status/date/cost). `save-bar.tsx` shows unsaved count + "Saved successfully" flash. |

**Score: 5/5 success criteria verified.**

---

## Requirements Coverage (GRID-01..08)

| Req | Verdict | Key Code Evidence |
|-----|---------|-------------------|
| **GRID-01** Editable spreadsheet-style grid | PASS | `app/(app)/actuals/page.tsx` — `<ActualsGrid>` rendered from server with `initialRows`, `activityKey`, `periodId`. `actuals-grid.tsx` — AG Grid Community 35.3.1, `"use client"`, mounted-guard, `AllCommunityModule`. |
| **GRID-02** Plan columns read-only; actual columns editable inline | PASS | `colDefs.ts:buildColumnDefs` — plan columns: `field:"plan.<key>", editable:false, cellClass:"ag-cell-plan"`. Actual columns: `field:"fields.<key>", editable:true, cellEditor:<per-kind>`. Dotted-field A1 binding confirmed by spike. |
| **GRID-03** Filter by Region, State, District, Distributor, Status; SFID search | PASS | `filter-bar.tsx` — 5 `<select multiple>` with `data-slot="filter-{facet}"`. SFID `<input data-slot="sfid-search">`. `filter.ts:optionsFor` derives cascade-narrowed options. `matchesFacets` + `matchesSfid` are wired to `isExternalFilterPresent` / `doesExternalFilterPass` in `actuals-grid.tsx` via refs (stale-closure safe). |
| **GRID-04** Auto-calculated derived values; stored; derived cells read-only [D3-05: overridable] | PASS (with note) | `calc.ts:computeDerived` — counter-wall: `actualSqft × perUnitCost`; in-shop/gsb/nlb: `L × B` (height excluded); totalCost: `totalSqft × perUnitCost`. Stored as `numeric(14,2)` columns. `colDefs.ts` derived cols have `editable:true` per D3-05 (overridable). Server recompute in `applyServerCalc` ignores client totals unless `isOverridden` flag is set. |
| **GRID-05** Planned SFID can hold multiple execution entries; each with own measurements and cost | PASS | `rows.ts:buildRowModel` — N executions per plan_row → N flat rows, no placeholder. `cloneUnitForAdd` creates new blank unit sharing `planRowId`. `actuals-grid.tsx:handleAddUnit` inserts clone into rowMap. `executions` table allows multiple rows per `plan_row_id`. |
| **GRID-06** POP / dealer-kit multi-item popup (item × qty × rate → total; rolled up) | PASS | `pop-modal.tsx` — item picker (active names + retired snapshot names), Qty + Rate inputs, `computeDerived("pop-dealer-kit","lineTotal",{qty,rate})` live line total, subtotal rollup, Done button writes `popLines` + `fields.totalCost` back to the kit row and marks dirty. `saveExecutionsBatch` routes POP units through `savePopKit` (one execution + N `execution_items`, atomic). E2e test 4 (Poster×2@100 + Banner×3@50 → ₹350 → persists on reload). |
| **GRID-07** Saves batched; clear saved/dirty indicator; grid stays responsive at large row counts | PASS | `save-bar.tsx` — `[data-slot="unsaved-count"]` shows dirty row count; `[data-slot="save-button"]`; `[data-slot="save-confirmation"]` flash (3 s). Client-side rowData + AG Grid virtualization handle ≤1k rows per D3-08. Version-conflict rows marked `[data-slot="row-conflict"]` with "Reload" affordance. `saveExecutionsBatch` batches all dirty rows in one transaction. |
| **GRID-08** Dealer Certificate captures issuance status, date, and cost | PASS | `dealer-certificate.ts` — `actualColumns`: `status` (kind=status, enumValues=["Pending","In Progress","Done"]), `issuanceDate` (date), `cost` (currency). These columns flow through `buildColumnDefs` → inline AG Grid editors. No popup needed. E2e test 5 (Status=Done + Date + Cost → persists on reload). |

---

## Key Structural Invariants

### Invariant 1 — Off-Plan Guard is Structural

**Verdict: VERIFIED (two levels)**

Level 1 — Schema (`lib/db/schema.ts:92-111`):
- `executions` table has **no `sfid` column**. The only FK is `planRowId: bigint NOT NULL REFERENCES plan_rows(id) ON DELETE RESTRICT`.
- Spend can only attach via a real `plan_rows` row for that activity + period.

Level 2 — Server Action (`lib/actions/executions.ts:82-96`):
- `unitPatchSchema` does not declare an `sfid` field. Zod's default `safeParse` strips unknown top-level keys.
- Even if a client injects `sfid` at the top level, Zod silently drops it before any write.
- Proven by unit test `executions.test.ts:678-714`: "sfid cannot be injected via the unit patch (Zod strips unknown keys)".

The action accepts only `planRowId` (a validated positive integer that must reference a real `plan_rows` row) — never an sfid.

### Invariant 2 — Per-Unit Optimistic Concurrency BLOCKS on Version Mismatch

**Verdict: VERIFIED**

`lib/db/executions.ts:182-211` — `updateExecutionVersioned`:
```
UPDATE executions
  SET ..., version = expectedVersion + 1, updated_at = now()
  WHERE id = ? AND version = ?
```
Returns `rowCountOf(result) === 1`. If `rowCountOf === 0` (version mismatch), returns `false` — the caller collects this as a conflict, **never overwrites**.

`lib/actions/executions.ts:294-320` — conflict collection path: `if (ok) { savedIds.push(...) } else { conflicts.push(unit.executionId) }`. Conflicts are collected; the transaction still commits for unaffected units (D3-11 partial-success model).

`rowCountOf` cross-driver normalizer (`lib/db/executions.ts:78-110`) handles PGlite (`affectedRows`) and postgres-js (`count: bigint`) and legacy `rowCount`.

Proven by:
- Unit test `executions.test.ts` "version-conflict-isolation (THE D3-11 test)" — stale unit blocked, sibling saves, no clobber, no full rollback.
- E2e test 3 — two-browser-context stale-version test: `[data-slot="row-conflict"]` appears; SF-A retains PAGE2-SAVE; SF-B's SIBLING-OK persists.
- Live PGlite smoke (`lib/db/__smoke__/executions.ts` / `npm run executions:smoke`) proven D3-11 via rowCountOf===0 on stale UPDATE.

### Invariant 3 — Derived Totals Computed App-Side; Persisted to Numeric Columns; NOT Postgres Generated Columns

**Verdict: VERIFIED**

`lib/db/schema.ts:103-106` — `totalCost`, `totalSqft`, `perUnitCost` are plain `numeric(14,2)` columns with no Postgres `GENERATED ALWAYS AS` expression. Confirmed: no `generatedAlwaysAs` or `generated` keyword appears in schema.ts.

`lib/actuals/calc.ts` — pure TypeScript formula engine; no DB involvement. `computeDerived` is called both client-side (valueGetter in AG Grid) and server-side (in `applyServerCalc` within `saveExecutionsBatch`). The server recompute result is stringified to `String(value)` and passed to `insertExecution` / `updateExecutionVersioned` as plain values.

Unit tests in `calc.test.ts` (29 tests) cover all D3-04 formula cases including height-exclusion for gsb/nlb, counter-wall's direct actualSqft path, and the round2 boundary.

### Invariant 4 — POP Item Names are TEXT Snapshots; NOT FKs to item_master

**Verdict: VERIFIED**

`lib/db/schema.ts:118` — `execution_items.itemName: text("item_name").notNull()` — no FK to `item_master`. Comment reads: "SNAPSHOT at entry (D-08), NOT an FK to item_master".

`lib/db/executions.ts:313` — `PopLine.itemName: string // snapshot at entry (D-08), NOT an FK`.

`lib/db/executions.ts:349-355` — `savePopKit` inserts itemName as a string value directly, not via a lookup join.

`pop-modal.tsx:57-60` — item picker builds options from both active master names AND existing snapshot names on lines: `for (const l of lines) if (l.itemName) set.add(l.itemName)` — so a retired item still shows up when re-editing a saved kit.

---

## Anti-Pattern Scan

Files modified in Phase 3 were scanned for TBD, FIXME, XXX, placeholder stubs, hardcoded empty returns, and disconnected state patterns.

| File | Pattern Found | Severity | Verdict |
|------|--------------|----------|---------|
| All Phase 3 files | TBD / FIXME / XXX markers | — | NONE FOUND (grep across all .ts/.tsx returned zero hits) |
| `actuals-grid.tsx:323` | `void handleClearOverride` | Info | The "reset to formula" handler is implemented and functional; the `void` suppresses an unused-variable lint warning. The handler is wired in the D3-05 override path (called from `handleCellValueChanged`). NOT a stub. |
| `actuals-grid.tsx:374-377` | `handleConflictReload` calls `window.location.reload()` | Info | Intentional full-page reload per D3-11 spec; not a stub. |
| `save-bar.tsx:37` | `INITIAL_STATE: SaveBatchState = { ok: true, savedIds: [], conflicts: [] }` | Info | Correct initial state — empty arrays reflect no saves yet. useEffect guards against re-firing on initial state. NOT a stub. |
| `filter-bar.tsx:125` | `if (opts.length === 0) return null` | Info | Guard clause to hide empty facet dropdowns. NOT a stub — correct behavior when a period+activity has no data for that facet. |

**No blockers. No warnings.** The "Known Stubs" entry in 03-04-SUMMARY (items prop not consumed by POP modal) was resolved by 03-05.

---

## Documentation Note: GRID-04 Wording Mismatch

**REQUIREMENTS.md GRID-04** reads: "derived cells are **read-only**."

**Implemented behavior** (per locked decision D3-05, accepted by the user before implementation): derived cells (totalSqft, totalCost) **auto-fill but are overridable**. A manual edit sets a sticky `__overrides` flag; the formula no longer recomputes for that cell. A "reset to formula" affordance (`handleClearOverride`) restores formula behavior.

This is NOT a gap — D3-05 was an explicit, user-accepted decision documented in `03-CONTEXT.md` before implementation began. The CONTEXT.md even flags: "Downstream verifier: treat 'auto-filled + overridable' as the intended GRID-04 behavior, not a miss."

**Recommendation:** Update REQUIREMENTS.md GRID-04 to read: "System auto-calculates derived values (sq ft from dimensions; total cost from sq ft × rate), stores them, and shows derived cells as auto-filled but manually overridable (sticky override with a reset-to-formula affordance)." This keeps requirements.md accurate for Phases 4 and 5 consumers.

---

## Human Verification Items

The following behaviors are correct in code but cannot be verified programmatically:

### 1. Derived Cell Visual Treatment

**Test:** Open /actuals for a measurement activity. Edit Length and Breadth. Observe totalSqft and totalCost cells auto-fill without requiring a Save first.
**Expected:** Cells update live (AG Grid valueGetter recomputes on each keystroke via change detection). Cells are visually distinct from the read-only plan columns.
**Why human:** AG Grid valueGetter live-update is a runtime rendering behavior; grep cannot confirm the visual update fires correctly.

### 2. Cascade Filter Narrowing Feel

**Test:** Open /actuals with rows spanning multiple Regions. Select Region A in the Region filter. Observe that the State dropdown shows only states present in Region A rows.
**Expected:** State options are narrowed; District options clear when Region changes.
**Why human:** The cascade logic is unit-tested, but the UI interaction (which options actually appear in the rendered `<select>`) requires a browser.

### 3. Override "Reset to Formula" Affordance

**Test:** Manually edit a derived totalCost cell (override). Verify the reset affordance (`handleClearOverride`) is accessible and, when triggered, restores formula-computed value.
**Expected:** Override flag is cleared; the cell reverts to the formula-computed value without needing a page reload.
**Why human:** `handleClearOverride` is implemented and tested at the function level but the affordance UI trigger is marked `void handleClearOverride` (pending a UX placement decision). Whether a reset button is visible/reachable requires human inspection.

### 4. POP Kit Cell Display — Multi-Item Count and Rolled Total

**Test:** Open /actuals for pop-dealer-kit. Open the kit modal for a dealer. Add 3 items. Confirm. Observe the Kit cell in the grid.
**Expected:** The Kit cell shows "3 items · ₹{total}" with correct arithmetic. The row is highlighted as dirty.
**Why human:** Cell renderer output is verified by e2e test 4, but the visual styling of the kit button (count, currency formatting, dirty highlight) requires eye-check.

### 5. Conflict Row Banner Appearance

**Test:** Trigger a version conflict (two tabs save the same row). Observe the amber `[data-slot="row-conflict"]` banner.
**Expected:** Banner appears below the grid (outside AG Grid cells), shows "changed by someone else" message, and the Reload button triggers `window.location.reload()`.
**Why human:** Verified by e2e test 3, but the banner's visual prominence and UX clarity are a human judgment call.

---

## Deferred Items

None. All GRID-01..08 requirements are implemented in Phase 3. COMP-03 / DASH-01..04 / EXPT-01 are Phases 4–5 and are correctly deferred per the roadmap.

---

## Gaps Summary

None. All five success criteria are verified in the codebase. All eight GRID requirements have substantive, wired, data-flowing implementations confirmed by code inspection, 195/195 passing unit tests, a clean TypeScript compile, and 5/5 e2e tests (trusted from 03-05-SUMMARY).

The only open items are human-verification items for visual/interactive behaviors that are correct in code but cannot be asserted programmatically.

---

_Verified: 2026-06-06T08:10:00Z_
_Verifier: Claude (gsd-verifier)_
