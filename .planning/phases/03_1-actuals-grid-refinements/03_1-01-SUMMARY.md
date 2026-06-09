---
phase: 03_1-actuals-grid-refinements
plan: 01
subsystem: database
tags: [drizzle, pglite, migration, ag-grid, vitest, schema, backfill]

# Dependency graph
requires:
  - phase: 02-plan-upload-and-periods
    provides: plan_rows table + listByPeriodActivity + numeric-as-string discipline
  - phase: 03-actuals-grid
    provides: buildRowModel/cloneUnitForAdd row model, colDefs editable mapping, PlanRowRecord type
provides:
  - "plan_rows.source/exception_reason/created_via/created_at columns + source CHECK (COMP-04 schema half)"
  - "Migration 0002 owning BOTH COMP-04 DDL and the GRID-10 status backfill DML (one-file atomicity)"
  - "DEFAULT_STATUS='In Progress' seeded on placeholder rows and add-unit clones (GRID-10)"
  - "PlanRowRecord.source field surfaced through listByPeriodActivity for downstream plans"
  - "GRID-11 regression guard asserting fields.* columns are editable===true (boolean)"
  - "migrate-0002.test.ts proving NULL→In Progress backfill, non-NULL untouched, idempotency, ship-wiring"
affects: [03_1-02, 03_1-03, 03_1-04, 03_1-05, phase-4-dashboard]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-append data DML (UPDATE) to a drizzle-kit-generated migration after a --> statement-breakpoint (generate emits DDL only)"
    - "text + CHECK for low-cardinality provenance (source) instead of pgEnum — mirrors the status precedent"
    - "Single module-level DEFAULT_STATUS const referenced by both new-row injection points so they cannot drift"
    - "Pure-migration vitest spec (no vi.mock blocks) that both runs the statement semantically AND asserts the journaled .sql ships it (ship-wiring)"

key-files:
  created:
    - drizzle/0002_funny_winter_soldier.sql
    - drizzle/meta/0002_snapshot.json
    - lib/db/migrate-0002.test.ts
  modified:
    - lib/db/schema.ts
    - lib/db/plan-rows.ts
    - lib/actuals/rows.ts
    - lib/actuals/rows.test.ts
    - lib/actuals/colDefs.test.ts
    - drizzle/meta/_journal.json

key-decisions:
  - "executions.status kept nullable with NO Postgres DB default — the app (buildRowModel/cloneUnitForAdd) is the single source of truth for new-row defaults (D3.1-03); the backfill is a one-time data correction, not a schema default"
  - "Migration 0002 owns BOTH the COMP-04 plan_rows DDL and the GRID-10 backfill DML in one file for atomicity (RESEARCH §Migration Shape)"
  - "source modeled as text + CHECK ('plan-upload','exception'), not pgEnum — adding a future source value stays a one-line CHECK edit"

patterns-established:
  - "Generated-migration + hand-appended DML: run db:generate, verify, then append the data statement once; never re-run generate after appending (it clobbers the DML)"
  - "GRID-11 boolean-editability regression guard: typeof editable === 'boolean' is the teeth that fails if a status-gating predicate ever returns"

requirements-completed: [GRID-10, GRID-11]

# Metrics
duration: 21min
completed: 2026-06-08
---

# Phase 3.1 Plan 01: Schema Foundation + Default-Status + Done-Lock Regression Guard Summary

**Migration 0002 lands the four COMP-04 plan_rows provenance/audit columns plus a forward-only idempotent `executions.status` NULL→'In Progress' backfill, while rows.ts seeds 'In Progress' on new placeholder and add-unit rows and a regression guard locks in status-independent cell editability.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-06-08T12:00:22Z
- **Completed:** 2026-06-08T12:21:43Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

- **COMP-04 schema half:** added `source` (NOT NULL default 'plan-upload', CHECK IN ('plan-upload','exception')), `exception_reason`, `created_via`, `created_at` to `plan_rows`. Migration `0002_funny_winter_soldier.sql` journaled by drizzle-kit; the `source` default backfills every existing plan_row as plan-uploaded with no separate UPDATE.
- **GRID-10 backfill:** hand-appended `UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;` to the same migration after a `--> statement-breakpoint` (forward-only, idempotent, no rollback — D3.1-07). Verified to apply cleanly to in-memory PGlite.
- **GRID-10 defaults:** `DEFAULT_STATUS = "In Progress"` module const in `rows.ts`, referenced by both the `buildRowModel` placeholder branch and `cloneUnitForAdd`; placeholders and add-unit clones now seed `fields.status = "In Progress"` while copying no execution measurement data.
- **PlanRowRecord.source:** added so `listByPeriodActivity`'s `select()` surfaces the new column to downstream plans (Plan 03 backend, Plan 05 pill).
- **GRID-11 confirm + guard:** re-grep at execution start found ZERO source hits for `resolveEditable`, `=== 'Done'`/`=== "Done"`, `metaKey`, `ctrlKey` in `lib/` and `app/` — the D3.1-00/R1 reconciliation holds, no lock to remove. Added a regression block asserting every `fields.*` column on counter-wall is `editable === true` AND `typeof === "boolean"`.
- **Migration backfill test:** new `migrate-0002.test.ts` (PGlite `memory://`, executions.test.ts harness) proves NULL→'In Progress', non-NULL ('Done') untouched, idempotency (second pass affects 0 rows), and ship-wiring (the journaled 0002 .sql literally carries the statement after a breakpoint alongside the source DDL).

## Re-grep Result (R1 / D3.1-00)

Run at execution start against `lib/` and `app/`:

| Pattern | Hits |
|---------|------|
| `resolveEditable` | 0 |
| `=== 'Done'` / `=== "Done"` | 0 |
| `metaKey` | 0 |
| `ctrlKey` | 0 |

Confirmed: no lock-on-Done predicate exists in source. `colDefs.ts` `editable` is a static boolean (`true` for actuals). GRID-11 is a regression guard, not a removal — nothing was removed.

## Generated Migration

`drizzle/0002_funny_winter_soldier.sql` — 4 `ALTER TABLE plan_rows ADD COLUMN` (source/exception_reason/created_via/created_at) + `plan_rows_source_check` CHECK (drizzle-kit generated) + hand-appended backfill `UPDATE` after a `--> statement-breakpoint`. Journaled as entry idx 2 in `drizzle/meta/_journal.json`.

## Task Commits

Each task was committed atomically:

1. **Task 1: schema columns + migration 0002 + GRID-10 backfill** - `a6b89e0` (feat)
2. **Task 2: GRID-10 default status in rows.ts (both branches) + PlanRowRecord.source + rows.test.ts (R8)** - `f84b1a3` (feat, TDD: RED confirmed before GREEN)
3. **Task 3: GRID-11 regression guard + migrate-0002.test.ts** - `4555fcc` (test)

**Plan metadata:** _(this commit)_ (docs: complete plan)

## Files Created/Modified

- `lib/db/schema.ts` - added 4 plan_rows provenance/audit columns + source CHECK; `check` import; executions untouched
- `lib/db/plan-rows.ts` - `PlanRowRecord.source: string`
- `lib/actuals/rows.ts` - `DEFAULT_STATUS` const; placeholder branch + cloneUnitForAdd seed `fields:{status:DEFAULT_STATUS}`
- `lib/actuals/rows.test.ts` - updated 2 R8-breaking assertions; added 2 GRID-10 default-status assertions; fixed `makePlanRow` fixture (source)
- `lib/actuals/colDefs.test.ts` - GRID-11 status-independent-editability regression block
- `lib/db/migrate-0002.test.ts` - **new** PGlite backfill spec (4 tests)
- `drizzle/0002_funny_winter_soldier.sql` - **new** DDL + hand-appended backfill DML
- `drizzle/meta/0002_snapshot.json` - **new** drizzle snapshot
- `drizzle/meta/_journal.json` - 0002 journal entry

## Decisions Made

- `executions.status` kept nullable with NO Postgres DB default — app is the source of truth (D3.1-03); the registry `enumValues` + the two rows.ts injections own new-row defaults; the migration is a one-time correction.
- ONE migration file owns both the COMP-04 DDL and the GRID-10 backfill DML (atomicity; RESEARCH §Migration Shape).
- `source` as text + CHECK, not pgEnum (matches `status` precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated `makePlanRow` fixture to include `source`**
- **Found during:** Task 2 (GRID-10 default status + PlanRowRecord.source)
- **Issue:** Adding `source: string` to `PlanRowRecord` made the `makePlanRow` test fixture in `rows.test.ts` fail typecheck (TS2741: Property 'source' is missing). This blocked the task's own verification.
- **Fix:** Added `source: "plan-upload"` to the fixture. Grepped all 17 PlanRowRecord references — confirmed this fixture is the only object-literal construction needing the field (plans.test.ts reads records from the DB `select()`, which now returns `source` automatically; no other source literals exist).
- **Files modified:** lib/actuals/rows.test.ts
- **Verification:** `npx tsc --noEmit` clean; `npx vitest run lib/actuals/rows.test.ts` 22/22 green.
- **Committed in:** f84b1a3 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was a direct, in-scope consequence of the planned `PlanRowRecord.source` addition. No scope creep; off-plan guard untouched.

## Issues Encountered

- **Full-suite parallel test timeouts (test-infra, pre-existing — NOT a regression).** `npm test` (default parallel file execution) shows `beforeAll` hook timeouts (10000ms) in DB-touching suites — including the untouched Phase 2 file `lib/actions/plans.test.ts`. This is PGlite's single-connection-under-WASM contention when multiple in-memory PGlite instances + the migrator run concurrently across vitest workers. **Resolution:** `npx vitest run --no-file-parallelism` runs all 14 files / 202 tests GREEN (28.8s). The three files touched by this plan also pass individually and in the sequential run. Logged to Deferred Issues below for a future test-infra fix (e.g. `poolOptions.singleThread` or `fileParallelism:false` in vitest.config.ts). This affects how the suite is invoked, not correctness of the code.

## Deferred Issues

- **DEF-03_1-01-01 — vitest file-parallelism vs PGlite single-connection.** `npm test` (parallel) times out DB-backed suites; `--no-file-parallelism` is green. Pre-existing (affects Phase 2 files too). Recommend pinning `test.fileParallelism: false` (or `poolOptions.threads.singleThread: true`) in `vitest.config.ts` so the default `npm test` invocation is reliable. Out of scope for this schema/lib plan.

## Known Stubs

None. The four new `plan_rows` columns have no app-writable path in THIS plan by design (D3.1-02 / threat T-03_1-02 — `source` is only written via the Plan 03 `addOffPlanExecution` Server Action, which is a later plan). `exception_reason`/`created_via`/`created_at` are intentionally NULL/default until Plan 03 wires the exception affordance; this is the planned schema-half-first sequencing, documented in the plan objective, not an unresolved stub.

## User Setup Required

None - no external service configuration required. (Migration 0002 applies to local PGlite via `ensureMigrated()` at boot / `npm run db:migrate:local`; to Supabase via `npm run db:migrate:prod` at deploy.)

## Next Phase Readiness

- **Plan 03 (COMP-04 backend)** can build `addOffPlanExecution` + `insertExceptionPlanRow` on the now-existing `source`/`exception_reason`/`created_via`/`created_at` columns and the `PlanRowRecord.source` field.
- **Plan 04 (paste) / Plan 05 (modal + pill)** can rely on the `DEFAULT_STATUS` rule and `PlanRowRecord.source` surfacing.
- The single shared migration `0002` is owned exclusively by this plan — downstream plans must NOT generate competing migrations against the same DDL (journal/snapshot conflict).
- Off-plan guard structurally untouched: `executions` still has no `sfid` column; the NOT NULL FK with ON DELETE RESTRICT is unchanged.

## Self-Check: PASSED

- FOUND: drizzle/0002_funny_winter_soldier.sql
- FOUND: drizzle/meta/0002_snapshot.json
- FOUND: lib/db/migrate-0002.test.ts
- FOUND: .planning/phases/03_1-actuals-grid-refinements/03_1-01-SUMMARY.md
- FOUND commit: a6b89e0 (Task 1)
- FOUND commit: f84b1a3 (Task 2)
- FOUND commit: 4555fcc (Task 3)

---
*Phase: 03_1-actuals-grid-refinements*
*Completed: 2026-06-08*
