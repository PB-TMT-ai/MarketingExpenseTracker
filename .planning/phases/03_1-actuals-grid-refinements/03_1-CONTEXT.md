# Phase 3.1: Actuals Grid Refinements — Context

**Gathered:** 2026-06-08
**Status:** Ready for research → planning
**Source:** User request + targeted clarifying questions (see DISCUSSION-LOG below)
**Mode:** mvp (vertical-slice refinement of the live actuals grid)
**Requirements:** GRID-09, GRID-10, GRID-11, GRID-12, GRID-13, COMP-04

<domain>

## Phase Boundary

Phase 3.1 is a focused refinement of the already-shipped Phase 3 actuals grid (5/5 plans complete, GRID-01..08 delivered). It addresses operational friction surfaced after Phase 3 went into use:

1. **Input lag** in editable cells (GRID-09).
2. **Status default behaviour** — new and existing rows lack a sensible default; a "No status" stat had to be added to surface NULL-status rows (GRID-10).
3. **P3 lock-on-Done friction** — the recently added lock prevents legitimate corrections (GRID-11).
4. **Off-plan reality** — vendors paint dealers that are not in the uploaded plan, and the team currently has no way to record this (COMP-04).
5. **Save reachability** — the save bar is bottom-only; on long grids the user scrolls away from it (GRID-12).
6. **Bulk entry** — only single-cell copy/paste works today; the team wants to paste a block of cells from Excel into many rows/columns at once (GRID-13).

**IN SCOPE**
- Hot-path React/AG Grid perf fixes inside `app/(app)/actuals/*` and `lib/actuals/*`.
- Status defaulting on placeholder rows and "+ add unit" clones, plus a one-time DB backfill.
- Removal of the P3 Done-lock (revert / delete the `editable` predicate that gates non-derived cells on status === 'Done').
- A new "off-plan exception" execution affordance — UI button + Server Action + schema column on `plan_rows` (e.g. `source` enum `'plan-upload' | 'exception'` plus audit fields) + audit log.
- A sticky **top** save bar mirroring the existing bottom save bar (GRID-12).
- A custom **paste-block** clipboard handler for multi-cell/multi-row entry from Excel/Sheets (GRID-13).
- Tests that prove each criterion (unit + at least one e2e per requirement).

**OUT OF SCOPE**
- Dashboard / "% executed" math against exception spend — that lands in Phase 4 (Phase 3.1 just persists the marker correctly so Phase 4 can split exceptions from plan-uploaded spend).
- Excel-import-side off-plan-row promotion (still rejected — COMP-01/COMP-02 unchanged).
- AG Grid Enterprise features. Community-only.
- A schema-wide audit-log table — for Phase 3.1, audit fields live as columns on the exception plan_row itself (createdBy is implicit, since all users share one password; createdAt, reason are explicit). A full audit log is a Phase-4+ concern if it ever becomes needed.
- Refactoring the Phase 3 calc engine or row model beyond what perf needs.

</domain>

<decisions>

## Implementation Decisions (LOCKED)

### D3.1-00 — Code-vs-memory reconciliation (VERIFIED 2026-06-08)
**The memory log is ahead of HEAD on three items. Plan against the CODE, not the memory log.** Verified by full-file reads + repo-wide grep (researcher R1, re-confirmed by orchestrator):
- **No lock-on-Done predicate exists.** `lib/actuals/colDefs.ts` hard-codes `editable: true` for actual columns (lines 101 + 126). There is NO `resolveEditable` helper and NO `status === 'Done'` gate anywhere in `app/(app)/actuals/*` or `lib/actuals/*`. Memory items 1455/1468/1470 describe a lock that was reverted before HEAD. → **GRID-11 becomes a CONFIRM + regression test**, not a removal. The plan must add a test asserting Done rows are editable across non-derived/derived/status cells, and explicitly verify (re-grep at execution start) that no lock has reappeared.
- **No Ctrl/Cmd+S handler exists.** Memory 1447 describes a save shortcut that is not in `save-bar.tsx` at HEAD. → **GRID-12 ADDS the shortcut fresh** (don't assume it's there to preserve).
- **No GridStats / "No status" stat exists.** Memory 1482 describes a stat component that is not in the repo (Glob found nothing). → **GRID-10 has nothing to zero out**; the backfill + defaults stand on their own. If the planner wants a stat surface, that's net-new, not a fix.
- **Planner directive:** at execution start, re-grep for `resolveEditable`, `=== 'Done'`, `metaKey`/`ctrlKey` in the actuals files to confirm this reconciliation still holds on the working branch before writing the GRID-11/12 tasks.

### D3.1-01 — Phase routing
**Inserted as Phase 3.1** (urgent insertion between Phase 3 and Phase 4, per ROADMAP.md "Decimal phases" convention). Not folded into Phase 4 because the work touches Phase-3 surface area, not dashboard math.

### D3.1-02 — Over-plan provision: off-plan-exception path
The "painted beyond the plan" requirement means **a dealer was painted who is NOT in the uploaded plan at all**, not "extra walls on a planned SFID" (which "+ add unit" already covers) and not "spend exceeded budget" (a Phase-4 visual concern).

**Solution shape:**
- Add a `source` column to `plan_rows` (e.g. `text` with check constraint or pg enum `'plan-upload' | 'exception'`, default `'plan-upload'`).
- Add audit fields on `plan_rows` for exception rows: `created_at` (already implicit if we add it), `exception_reason text NULL`, `created_via text` (e.g. `'plan-upload' | 'actuals-exception' | 'manual'`).
- Add a Server Action `addOffPlanExecution` that, in a single transaction, INSERTs the plan_row with `source='exception'` AND the execution.
- UI affordance: a "+ off-plan execution" button in the actuals page (location TBD by planner — likely below the grid or in the page header, NOT inline in the AG Grid row toolbar).
- Excel plan-upload's off-plan-rejection is **unchanged** — the only way to introduce an off-plan SFID is through the explicit UI affordance.
- All exception rows survive a future plan re-upload (the merge logic in PLAN-06 must NOT delete `source='exception'` rows).

### D3.1-03 — Default status: In Progress (all three branches)
- New placeholder rows (loaded from a plan_row with zero executions): the Status cell defaults to `"In Progress"` in `buildRowModel` placeholder branch.
- "+ add unit" clones (`cloneUnitForAdd`): the new row's `fields.status` is set to `"In Progress"`.
- Existing executions with `status IS NULL` are backfilled to `"In Progress"` via a one-time Drizzle migration (forward-only, documented). The "No status" stat row should be removable (or stays at zero by definition) after the migration runs.
- Status remains a `text` column — the registry's `enumValues: ["Pending", "In Progress", "Done"]` controls the editor; no schema enum change.

### D3.1-04 — Done-row edits: fully unlocked
- Remove the predicate that returns `false` from `editable` when `status === 'Done'` (introduced in memory items 1455/1470/1468 as "P3 lock-on-Done").
- Every cell on a Done execution behaves like any other editable cell: edit lands, dirty flag fires, save batches normally.
- The `resolveEditable` test helper (introduced in 1468) can stay or be removed depending on whether anything else uses functions for `editable`. Default: simplify back to `editable: true` boolean.
- No confirm dialog, no audit log — the user asked for the simplest variant.

### D3.1-05 — Perf scope: targeted hot-path fixes
The planner researcher should look at (non-exhaustive — the researcher decides specifics):
- `setRowMap` is called on every keystroke with `new Map(prev)` + spread — this is O(N) per edit. Consider Immer-style structural sharing OR using AG Grid's `applyTransactionAsync` to mutate row data in place.
- `rowData = useMemo(() => Array.from(rowMap.values()), [rowMap])` rebuilds on every `setRowMap` — fine if the Map churn is reduced, but a transaction-based path would avoid this entirely.
- The `useEffect` that calls `apiRef.current?.onFilterChanged()` on every `[facetSelections, sfidSearch]` change does not debounce — typing in the SFID search box re-runs the external filter once per keystroke. Add a small debounce (e.g. 100ms).
- `dirtyRows = useMemo(() => Array.from(rowMap.values()).filter(...), [rowMap])` recomputes on every Map churn. Track dirty rowKeys in a separate Set state.
- Status cells use the default `agSelectCellEditor` which requires double-click to enter edit mode. Consider single-click activation via a custom renderer/editor for status specifically (the most-frequently-edited cell).
- **NOT in scope:** rewriting to AG Grid's row-store model, switching to TanStack Table, custom canvas renderer, server-side row model. Community AG Grid stays.

### D3.1-06 — Performance baseline measurement
Before any perf fix lands, capture a baseline:
- Realistic dataset (e.g. seed a period with ~500 plan rows across activities).
- Record a Chrome Performance profile of (a) typing 10 chars in an actual-cell, (b) scrolling the grid, (c) toggling a status. Capture frames / time-to-paint.
- Save the profile as `phases/03_1-.../baseline-perf.md` with screenshots / numbers, NOT to git LFS — markdown notes only.
- After fixes, repeat. Improvement must be observable (e.g. 50%+ reduction in scripting time per edit, or "<16ms per keystroke" target).
- Acceptance: a side-by-side note in the SUMMARY.md showing before/after numbers. This is what makes GRID-09 verifiable.

### D3.1-07 — Backfill migration semantics
- Forward-only migration: `UPDATE executions SET status = 'In Progress' WHERE status IS NULL;`
- Runs once; subsequent INSERTs respect the new default (which is set by `buildRowModel` / `cloneUnitForAdd`, not by a Postgres column default, to keep registry enumValues as the single source of truth).
- No rollback script — once In-Progress is the floor, reverting to NULL has no operational meaning.

### D3.1-08 — Audit/identity for exception rows
- Since the app uses ONE shared password (no per-user identity in v1), audit fields are limited to `created_at`, `exception_reason text`, `created_via text` on plan_rows.
- No "createdBy" field — there's no user identity to record. Capture this limitation in SUMMARY.md so Phase 4 / a future auth phase knows where to extend.

### D3.1-09 — Test-first discipline (per project CLAUDE.md TDD posture)
- Backfill migration: unit test against PGlite (verify NULL-status rows become 'In Progress'; non-NULL untouched).
- Done-lock removal: unit test in `colDefs.test.ts` proves Done rows are now editable across all cell kinds (resolves the test added in memory 1470).
- Off-plan exception: unit test for `addOffPlanExecution` action (transaction integrity — both rows commit or neither); e2e test for the UI affordance.
- Perf: a *manual* baseline + after profile is sufficient (no automated perf regression test in v1).

### D3.1-10 — Save bar placement: BOTH top and bottom
- Keep the existing bottom save bar (`save-bar.tsx`, currently `sticky bottom-0`).
- Add a **sticky top** save bar that mirrors it: same dirty count, same Save button, same action result handling, and the existing Ctrl/Cmd+S shortcut (memory 1447) keeps working.
- Both bars must reflect the SAME state — there is ONE source of truth for `dirtyRows` and ONE `onSaveResult`. Do NOT instantiate two independent `useActionState` flows that could diverge (e.g. show different dirty counts or double-submit). The planner should lift the save action into the grid (or a shared hook) and render two presentational bars, OR render a second `<SaveBar>` that shares the same submit handler — the planner picks, but the single-source-of-truth invariant is LOCKED.
- The top bar should appear ABOVE the AG Grid container, below the FilterBar.

### D3.1-11 — Bulk entry: custom paste-block handler (Excel → grid)
- The team's chosen workflow (AskUserQuestion answer): **"Paste a block from Excel"** — copy a rectangular range from Excel/Sheets, click an anchor cell in the grid, paste, and have it fill across columns and down rows.
- AG Grid **Community has NO range selection, NO fill handle, NO multi-cell clipboard** — those are Enterprise. So this is a **custom handler**:
  - Attach a `paste` listener (on the grid container or document) that reads `clipboardData.getData('text/plain')`, splits on `\n` (rows) and `\t` (columns) to get a 2-D array (standard Excel/Sheets clipboard TSV).
  - Determine the anchor: the currently-focused cell (`api.getFocusedCell()` gives row index + column).
  - Map the pasted 2-D block onto the grid starting at the anchor: pasted column `j` → the `j`-th editable column at/after the anchor column; pasted row `i` → the `i`-th grid row at/after the anchor row (respecting current sort/filter — use displayed rows).
  - **Skip read-only columns** (`plan.*`) — the mapping walks only editable (`fields.*`) columns. Decide (planner) whether a read-only column in the path consumes a pasted column or is skipped; default: **skip** (paste lands only in editable columns, left-to-right).
  - **Derived/override cells:** pasting a value into a derived cell sets the override flag (consistent with `handleCellValueChanged`'s existing `setOverride` behaviour). LOCKED: reuse the existing override path; do NOT special-case derived cells out of paste.
  - Each written cell goes through the SAME update path as a manual edit (mark row dirty, promote placeholder → real, server trust-recompute on save). Do NOT write directly to the DB from the paste handler.
  - **Overflow:** if the pasted block has more columns than there are remaining editable columns (or more rows than remaining grid rows), the overflow is **silently dropped** (don't error, don't wrap). Surface a small toast/inline note: "Pasted N×M block into the grid (X cells outside the editable area were ignored)." — planner decides exact copy.
  - Type coercion: pasted strings are coerced per the target column kind (number/currency → numeric parse; date → DD/MM/YY per the existing date discipline; text → as-is). Reuse any existing coercion from `lib/excel/*` or `lib/actuals/*` if one fits; otherwise a small local coercer is fine.
- **Security/guard invariants preserved:** paste only writes to `fields.*` on EXISTING grid rows (which already have a `planRowId`). It can NEVER introduce a new SFID or bypass the off-plan guard — off-plan entry is exclusively the D3.1-02 exception affordance.
- Pasting into placeholder rows promotes them to real rows on save (same as a manual edit) and applies the default-status rule (D3.1-03) if status wasn't part of the paste.

### Claude's Discretion
- Exact file layout for the off-plan affordance (separate modal vs inline form).
- Whether the top save bar is a second `<SaveBar>` instance with a shared handler or a new lifted-state design (single-source-of-truth invariant is the only hard rule).
- Paste handler: attach to grid `div` vs `document`; whether to use AG Grid's `processDataFromClipboard`/`onPasteStart` hooks (note: some clipboard hooks are Enterprise — verify) vs a plain DOM `paste` listener (the safe Community path).
- Whether read-only columns in the paste path consume or skip a pasted column (default: skip).
- Toast/inline-note styling for paste overflow.
- Whether to introduce `pgEnum('source')` or use `text` + check constraint (planner picks).
- Debounce duration (planner picks; 100ms is a sane default).
- Whether to drop the `resolveEditable` helper or keep it (planner picks based on whether anything else needs functional `editable`).
- Whether status cells get a custom single-click editor or stay as `agSelectCellEditor` (research call — depends on whether single-click activation is feasible without breaking AG Grid keyboard nav).
- Schema change strategy: one migration with all changes (add `source`, `exception_reason`, `created_via`, `created_at` to plan_rows + backfill executions.status) vs split into two.

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 3 (closed, immediate predecessor)
- `.planning/phases/03-actuals-grid/03-CONTEXT.md` — locked decisions for the actuals grid (D3-01..D3-15), most of which Phase 3.1 must preserve.
- `.planning/phases/03-actuals-grid/03-RESEARCH.md` — AG Grid Community findings, the spike GO verdict, the chosen patterns (mounted-guard, themeQuartz, external filter, valueGetter, dotted fields).
- `.planning/phases/03-actuals-grid/03-VERIFICATION.md` — what shipped Green for Phase 3.
- `.planning/phases/03-actuals-grid/03-04-PLAN.md` and `03-04-SUMMARY.md` — the ActualsGrid component, FilterBar, SaveBar, e2e wiring.
- `.planning/phases/03-actuals-grid/03-05-PLAN.md` and `03-05-SUMMARY.md` — POP modal + Dealer Certificate wiring.

### Project-level
- `.planning/PROJECT.md` — core value (off-plan guard, % executed) — MUST NOT weaken.
- `.planning/STATE.md` — recent decisions (D3-12 dirty highlighting, D3-11 conflict handling, D3-05 sticky override).
- `CLAUDE.md` — tech stack (Next 16, React 19, Drizzle, Neon, AG Grid Community 35.x).

### Existing implementation (read before touching)
- `app/(app)/actuals/actuals-grid.tsx` — main React component; the hot path lives here.
- `app/(app)/actuals/page.tsx` — Server Component, data loader (plan_rows + executions + items).
- `app/(app)/actuals/filter-bar.tsx` — controlled filter component (recent refactor: 1460, 1461).
- `app/(app)/actuals/save-bar.tsx` — useActionState wrapper around `saveExecutionsBatch`.
- `lib/actuals/colDefs.ts` — the ColDef builder; the lock-on-Done predicate lives here.
- `lib/actuals/calc.ts` — derived-field engine (D3-04 / D3-05); read-only for Phase 3.1.
- `lib/actuals/rows.ts` — `buildRowModel`, `cloneUnitForAdd`; the default-status change lives here.
- `lib/actions/executions.ts` — `saveExecutionsBatch` (D3-11 conflict handling, server trust-recompute); the new `addOffPlanExecution` action goes alongside.
- `lib/db/schema.ts` — schema migrations land here.
- `lib/db/plan-rows.ts` — data access for plan_rows; add an "insert exception" helper.
- `lib/activities/registry.ts` + per-activity configs — status enumValues live here; Phase 3.1 reads but does not modify.

### Memory cross-references (claude-mem observations that inform this phase)
- 1455, 1467, 1468, 1469, 1470 — the P3 lock-on-Done that GRID-11 reverses.
- 1463, 1466, 1479-1482 — clickable Pending stat, "No status" stat, and the status-blank-row issue that GRID-10 closes out.
- 1460, 1461, 1462 — the recent FilterBar controlled-component refactor (informs perf research because filter changes already drive `onFilterChanged`).
- 1491, 1492 — execution audit trail notes + single-row conflict refetch (informs COMP-04 audit shape).
- 1485, 1486, 1487 — most recent Phase 3 commits (P1/P2/P3 CEO review features).

</canonical_refs>

<specifics>

## Specific Examples

- **Hot-path lag, reproduction**: open `/actuals`, pick the Counter Wall tab on a period with >50 plan_rows, focus the "Actual Sq Ft" cell, type quickly. Each character triggers a `setRowMap → new Map → useMemo rebuild rowData → AG Grid setRowData → onFilterChanged()` cycle. On lower-end hardware, the perceptible lag is real.
- **Off-plan exception affordance shape** (one possible layout — planner may diverge):
  - A "+ off-plan execution" button in the actuals page header, next to the activity selector.
  - Clicking opens a modal with: SFID (required, text), Dealer (required), Region/State/District (optional, free-text), Reason (required, textarea), then the standard execution-entry fields for the selected activity.
  - On submit, calls `addOffPlanExecution` action which: inserts `plan_rows` with `source='exception', exception_reason=…, created_via='actuals-exception'`, then inserts `executions` referencing that new plan_row id, all in one transaction.
- **Backfill migration**: a Drizzle migration with a single SQL statement plus a unit test that seeds 3 NULL-status executions, runs the migration, asserts they all became 'In Progress'.

</specifics>

<deferred>

## Deferred Ideas

- "createdBy" on exception rows — requires per-user auth (out of v1 scope per PROJECT.md "Out of Scope").
- Audit log table for ALL changes (not just exception creation) — defer; not requested.
- Automated perf regression test — defer; manual baseline is enough for v1.
- Bulk-import path for exceptions (e.g. uploading an Excel of off-plan dealers) — defer; if the team finds the single-row affordance too slow, revisit in v2.
- Exception spend visualization on the dashboard (planned vs executed vs exception spend split) — explicitly Phase 4 work; Phase 3.1 only persists the marker.
- Configurable status defaults per activity (e.g. Dealer Certificate might default differently) — defer; the same default works across all six activities in v1.

</deferred>

---

## Discussion log (2026-06-08)

User invoked `/gsd-plan-phase` with four bullets describing actuals-grid pain points. Four clarifying questions were asked via AskUserQuestion:

1. **Over-plan scope** — user picked: "Painted at an SFID not in the plan" (off-plan exception path) — schema change accepted.
2. **Done-edit policy** — user picked: "Fully unlocked (Recommended)".
3. **Default-status scope** — user picked ALL THREE: new placeholders + "+ add unit" clones + backfill existing NULL-status rows.
4. **Perf scope** — user picked: "Targeted (Recommended)" — hot-path fixes only, no rewrite.

These four answers are the LOCKED decisions captured in `<decisions>` above (D3.1-02, D3.1-03, D3.1-04, D3.1-05). The researcher and planner should treat them as final.

**Follow-up (mid-session, same day):** user added two more requirements and answered two more questions:

5. **Save placement** — user picked: "Both top and bottom (Recommended)" → D3.1-10.
6. **Bulk entry** — user picked: "Paste a block from Excel" → D3.1-11. (AG Grid Community has no native range/clipboard, so this is a custom handler.)

GRID-12 and GRID-13 added to REQUIREMENTS.md and ROADMAP.md to cover these. All six decisions (D3.1-02/03/04/05/10/11) are LOCKED.

---

*Phase: 03_1-actuals-grid-refinements*
*Context gathered: 2026-06-08 via AskUserQuestion (4 questions) + codebase exploration*
