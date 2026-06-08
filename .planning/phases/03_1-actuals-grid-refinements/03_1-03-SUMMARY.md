---
phase: 03_1-actuals-grid-refinements
plan: 03
subsystem: api
tags: [server-actions, drizzle, postgres, zod, jose, off-plan-guard, transactions, pglite]

# Dependency graph
requires:
  - phase: 03_1-01
    provides: "plan_rows source/exception_reason/created_via/created_at columns (migration 0002) + PlanRowRecord.source"
  - phase: 02-02
    provides: "commitPlanUpload mirror-semantics tx + isFkRestrictError shape to clone"
  - phase: 03-02
    provides: "saveExecutionsBatch (applyServerCalc, numeric promotion, try/catch-around-tx pattern); computeDerived/isOverridden calc engine"
provides:
  - "insertExceptionPlanRow(tx, args) — inserts ONE plan_row source='exception', created_via='actuals-exception', returns id"
  - "addOffPlanExecution(input) Server Action — COMP-04 off-plan-exception backend (requireSession + Zod + ONE tx)"
  - "isUniqueViolation(err) — 23505 sibling to isFkRestrictError; clean dupe-SFID message, never a 500"
  - "AddOffPlanState return type for Plan 05 (off-plan modal)"
  - "R4 re-upload guard: commitPlanUpload merge-delete scoped to source='plan-upload' (exception rows survive re-upload)"
  - "promoteExecutionColumns shared helper (one authoritative numeric/status split for batch + exception paths)"
affects: [03_1-05, 04-compliance-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Off-plan-exception path: insert exception plan_row FIRST, then FK the execution to it — both in ONE db.transaction; sfid written ONLY to plan_rows (structural off-plan guard COMP-01 preserved)"
    - "isUniqueViolation(23505) duck-typed on err.cause?.code ?? err.code — sibling to isFkRestrictError(23001/23503), cross-driver (PGlite/postgres-js)"
    - "source-scoped merge-delete: re-upload deletes only source='plan-upload' orphans"
    - "vi.spyOn(namespaceImport, 'fn').mockRejectedValueOnce to force a SECOND-insert failure and prove tx atomicity distinct from the FIRST-insert (dupe) rollback"

key-files:
  created: []
  modified:
    - "lib/db/plan-rows.ts — added insertExceptionPlanRow + ExceptionPlanRowInsert type"
    - "lib/actions/executions.ts — added addOffPlanExecution + isUniqueViolation + AddOffPlanState + promoteExecutionColumns; refactored saveExecutionsBatch to reuse the shared helper"
    - "lib/actions/plans.ts — R4 guard: snapshot SELECT now includes source; toDeleteIds filtered to source==='plan-upload'"
    - "lib/actions/executions.test.ts — 6 addOffPlanExecution cases"
    - "lib/actions/plans.test.ts — R4 re-upload regression test"

key-decisions:
  - "addOffPlanExecution signature is (input: unknown) — a single-arg action (NOT the (prevState, input) useActionState shape of saveExecutionsBatch/commitPlanUpload). Plan 05's modal calls it directly; if it needs useActionState a thin form adapter can wrap it then."
  - "The exception plan_row's `fields` is written as {} (empty jsonb) — plan-side extras are not collected on the exception path; the actuals blob lives on the execution. Plan-side fields can be added later if a use case emerges."
  - "promoteExecutionColumns extracted to keep the batch and exception numeric/status split identical (Pitfall 9 — one authoritative calc path); saveExecutionsBatch refactored to use it (16 prior tests still green)."

patterns-established:
  - "Exception-row provenance: source='exception' + created_via='actuals-exception' stamped by insertExceptionPlanRow; plan upload never sets source='exception'"
  - "Cross-phase guard tagging: R4 edit to the Phase-2 commitPlanUpload is comment-tagged 'R4 GUARD (Phase 3.1 / COMP-04 — cross-phase edit)'"

requirements-completed: [COMP-04]

# Metrics
duration: 10min
completed: 2026-06-08
---

# Phase 3.1 Plan 03: COMP-04 Off-Plan-Exception Backend Summary

**`addOffPlanExecution` Server Action records an audited off-plan exception as ONE plan_row (`source='exception'`) + one FK'd execution in a single transaction, with a 23505 dupe-SFID clean error and a re-upload guard that preserves exception rows — the off-plan guard (COMP-01) stays structurally intact (executions still has no sfid column).**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-08T18:10:15Z
- **Completed:** 2026-06-08T18:19:45Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments

- `insertExceptionPlanRow(tx, args)` in plan-rows.ts — inserts a `source='exception'`, `created_via='actuals-exception'` plan_row and returns its id (numeric-stringify discipline mirrored from `bulkInsertPlanRows`; accepts the OUTER tx, never opens its own).
- `addOffPlanExecution(input)` Server Action — `requireSession()` FIRST (auth boundary, ASVS V2), Zod validate (`exceptionReason` required), ONE `db.transaction` inserting the exception plan_row THEN the execution FK'd to it, with `applyServerCalc` server trust-recompute (R12), `revalidatePath("/actuals")`, and the try/catch AROUND the transaction.
- `isUniqueViolation(23505)` helper — sibling to `plans.ts`'s `isFkRestrictError`; on a dupe SFID it returns a clean `{ok:false}` message ("...already exists...use \"+ add unit\"...") instead of a 500 (R3).
- R4 cross-phase guard in `commitPlanUpload` — snapshot SELECT now includes `source`; `toDeleteIds` filtered to `source === 'plan-upload'`, so a plan re-upload never deletes (or FK-blocks) off-plan-exception rows (D3.1-02).
- 7 new tests (6 action cases + 1 re-upload regression), all green; full action suite 31/31 via `--no-file-parallelism`.

## Task Commits

Each task was committed atomically:

1. **Task 1: insertExceptionPlanRow + addOffPlanExecution + isUniqueViolation** - `348cf03` (feat)
2. **Task 2: addOffPlanExecution unit tests** - `3152dd2` (test)
3. **Task 3: R4 re-upload guard + regression test** - `bfee5c7` (fix)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified

- `lib/db/plan-rows.ts` - Added `insertExceptionPlanRow` + `ExceptionPlanRowInsert` type (the exception-row writer).
- `lib/actions/executions.ts` - Added `addOffPlanExecution` Server Action, `isUniqueViolation` helper, `AddOffPlanState` return type, and `promoteExecutionColumns` shared helper; refactored `saveExecutionsBatch` to reuse the helper.
- `lib/actions/plans.ts` - R4 guard: `commitPlanUpload` snapshot SELECTs `source` and the merge-delete is scoped to `source === 'plan-upload'`.
- `lib/actions/executions.test.ts` - 6 `addOffPlanExecution` cases (2 happy paths across activity types, dupe-SFID 23505, tx atomicity via forced execution-insert failure, auth-rejected, missing-reason).
- `lib/actions/plans.test.ts` - R4 regression: upload {A,B} + add exception X + re-upload {A} → B deleted, X survives, A kept.

## Decisions Made

- **`addOffPlanExecution(input: unknown)` is a single-arg action** (not the `(prevState, input)` useActionState shape the other two actions use). Plan 05's modal can call it directly; a thin form adapter can wrap it later if `useActionState` ergonomics are wanted. (D3.1-08 note: no `createdBy` — v1 uses a single shared password, so there is no per-user identity to record; a future auth phase can add it.)
- **Exception plan_row `fields` written as `{}`** — plan-side extras aren't collected on the exception path; the actuals blob lives on the execution. Extendable later.
- **`promoteExecutionColumns` extracted** so the batch and exception numeric/status split can never drift (Pitfall 9). `saveExecutionsBatch` refactored to use it; its 16 prior tests stayed green.

## Deviations from Plan

None - plan executed exactly as written. (The numeric/status split was extracted into a small shared helper rather than copy-pasted, but this implements the plan's explicit "promote ... exactly like saveExecutionsBatch" instruction with zero behavioral change — confirmed by the 16 unchanged batch tests passing.)

## Issues Encountered

- **`vi.spyOn(executionsDb, "insertExecution")` interception risk:** the action imports `insertExecution` as a direct named binding, so it was not certain the namespace spy would intercept the action's call. Verified empirically — the tx-atomicity test passes, confirming Vitest's module system makes the named import and namespace property the same live binding. No code change needed.

## User Setup Required

None - no external service configuration required. (eslint is not configured in this project per DEF-03_1-02-01; the verification gate is `npx tsc --noEmit` + the two test files, both green.)

## Next Phase Readiness

- **Plan 05 (COMP-04 frontend)** can now build the off-plan modal against `addOffPlanExecution(input)` → `AddOffPlanState` (`{ok:true, planRowId, executionId}` | `{ok:false, error}`). The grid-surfacing `planContext.source` addition and the SFID-column exception pill remain Plan 05's job (not done here — backend only).
- **Phase 4 (dashboard)** can distinguish off-plan spend via `plan_rows.source = 'exception'`.
- Off-plan guard verified structurally intact: `executions` has no sfid column (schema.ts lines 105-124); the exception path inserts a plan_row first then FKs the execution.

## TDD Gate Compliance

Task 1 was marked `tdd="true"`. The plan deliberately decomposes the feature into an implementation task (Task 1, `feat`) and a separate test task (Task 2, `test`) — its Task 1 `<done>` explicitly states "executions.test.ts passes (cases added in Task 2)". The gate sequence therefore lands as `feat` (348cf03) → `test` (3152dd2), rather than the canonical test-first `test` → `feat` order. This is per the plan's own task structure, not a skipped RED gate: Task 2's tests fail against any earlier state lacking the action and pass against Task 1's implementation. Recorded here for transparency.

## Self-Check: PASSED

- FOUND: lib/db/plan-rows.ts (insertExceptionPlanRow present)
- FOUND: lib/actions/executions.ts (addOffPlanExecution + isUniqueViolation present)
- FOUND: lib/actions/plans.ts (source-scoped merge-delete present)
- FOUND commit 348cf03 (Task 1)
- FOUND commit 3152dd2 (Task 2)
- FOUND commit bfee5c7 (Task 3)
- tsc --noEmit: exit 0; executions.test.ts + plans.test.ts: 31/31 passing

---
*Phase: 03_1-actuals-grid-refinements*
*Completed: 2026-06-08*
