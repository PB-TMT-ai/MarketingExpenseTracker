---
phase: 03-actuals-grid
plan: 03
subsystem: executions-data-layer
tags: [executions, server-action, optimistic-concurrency, version, pop-kit, cross-driver, tdd, D3-11, D3-13, D3-14, GRID-05, GRID-06, GRID-07]

# Dependency graph
requires:
  - phase: 01-02
    provides: executions + execution_items schema (version column, plan_row_id FK ON DELETE RESTRICT, no sfid — structural off-plan guard)
  - phase: 03-02
    provides: (parallel sibling) lib/actuals/* pure core — NOT imported here; the action recomputes server-side independently
provides:
  - "lib/db/executions.ts → insertExecution / updateExecutionVersioned / listExecutionsByPeriodActivity / savePopKit (one kit + N items) + rowCountOf (cross-driver row-count normalizer) + ExecutionRecord / ExecPatch / ExecInsertValues / PopLine types + DbOrTx + _findExecutionForTest / _resetExecutionItemsForTest"
  - "lib/actions/executions.ts → saveExecutionsBatch Server Action + SaveBatchState ({ ok, saved[] } | { ok:false, conflicts[], error }) + SavedUnit"
  - "lib/db/__smoke__/executions.ts + npm run executions:smoke — live PGlite proof of D3-11"
affects: [03-04 (grid Save bar calls saveExecutionsBatch; reads listExecutionsByPeriodActivity), 03-05 (POP modal calls savePopKit via the action)]

# Tech tracking
tech-stack:
  patterns:
    - "Optimistic concurrency (D3-11): updateExecutionVersioned does UPDATE ... WHERE id=? AND version=? RETURNING ...; rowCountOf(result)===0 means a stale version — the unit is collected as a conflict and NEVER overwritten (no last-write-wins). version bumps atomically on success; new placeholder rows insert at version 0."
    - "Cross-driver rowCountOf normalizer: PGlite returns result.affectedRows/rowCount, postgres-js returns an array with .count (bigint) — one helper normalizes both (mirrors the isFkRestrictError cross-driver duck-typing precedent in lib/actions/plans.ts)."
    - "Server trust-recompute (security): saveExecutionsBatch re-derives/validates totals server-side from the registry computeFrom — never trusts client-sent totals."
    - "Structural off-plan guard preserved: the action accepts only plan_row_id (an existing plan_rows id) — never an sfid from the client; executions attach via the NOT NULL FK only."
    - "Empty-placeholder skip (D3-02): a placeholder unit with no entered actuals does NOT create an executions row."
    - "POP kit (D3-13/14): savePopKit writes one execution + N execution_items in a single db.transaction; replace-semantics delete prior items; item names are SNAPSHOT at entry (not an FK to item_master)."
  guards:
    - "requireSession() at saveExecutionsBatch entry (defense-in-depth; CVE-2025-29927 lesson)"
    - "Zod validation of every batch unit + POP line server-side before any write"

key-files:
  created:
    - lib/db/executions.ts
    - lib/actions/executions.ts
    - lib/actions/executions.test.ts
    - lib/db/__smoke__/executions.ts
  modified:
    - package.json

status: complete
requirements: [GRID-05, GRID-06, GRID-07]
commits:
  - "afe17e6: feat(03-03): executions data layer + rowCountOf normalizer + PGlite smoke"
  - "aed0538: feat(03-03): saveExecutionsBatch Server Action + test suite"
---

# Phase 03 · Plan 03 — Executions data layer + version-safe batch save — SUMMARY

The persistence half of the actuals grid: a thin typed data-access module over `executions` /
`execution_items` plus the `saveExecutionsBatch` Server Action that the grid's Save bar calls.

## What shipped

- **`lib/db/executions.ts`** — `insertExecution` (version 0), `updateExecutionVersioned`
  (version-checked UPDATE … RETURNING), `listExecutionsByPeriodActivity` (the grid read),
  `savePopKit` (one execution + N `execution_items` in one transaction, replace semantics,
  name snapshot), and **`rowCountOf`** — the cross-driver row-count normalizer that makes the
  optimistic-concurrency check work identically on PGlite and postgres-js. Helpers take an
  OUTER `DbOrTx` and never open their own transaction (mirrors `lib/db/plan-rows.ts`).
- **`lib/actions/executions.ts`** — `saveExecutionsBatch`: `requireSession()` → Zod-validate the
  batch → for each dirty unit, insert (placeholder) or version-checked update; collect
  version-mismatch units as **conflicts** instead of overwriting; recompute totals server-side;
  `revalidatePath`. Returns `{ ok, saved } | { ok:false, conflicts, error }` so the grid can
  flag exactly which rows to reload (D3-11/12).
- **`lib/actions/executions.test.ts`** — 16 tests (PGlite-isolated, mocked next/headers +
  next/cache + verifySession), incl. the conflict-blocking path and POP kit.
- **`lib/db/__smoke__/executions.ts`** + `npm run executions:smoke` — live PGlite proof.

## Verification

- Unit suite: **195/195 green** (16 new here; no regressions in the prior 82 or 03-02's 97).
- `npx tsc --noEmit`: clean.
- Live smoke (`executions:smoke`): **D3-11 PROVEN** — stale-version UPDATE affects 0 rows
  (`rowCountOf===0`, no clobber); fresh UPDATE bumps version atomically; `savePopKit` new + replace
  both correct; `rowCountOf` handles postgres-js bigint, PGlite rowCount, and null/empty.

## For 03-04 / 03-05 (consumers)

- Read grid rows: `listExecutionsByPeriodActivity(periodId, activity)` → `ExecutionRecord[]`
  (numeric columns are STRING from Drizzle — convert in the calc/display layer).
- Save edits: build a batch of `ExecPatch` (each carrying `id?`, `planRowId`, `version`, fields),
  call `saveExecutionsBatch`; on `{ ok:false, conflicts }` mark those rows "reload".
- POP (03-05): call the action's POP path / `savePopKit` with `PopLine[]` (itemName snapshot, qty, rate).

## Note

03-03 implementation + tests + smoke were committed (`afe17e6`, `aed0538`) and the working tree
was clean; this SUMMARY was written by the orchestrator after the executor returned post-commit
(the agent had finished all code and verification — "all green" — before writing the summary).
