---
phase: 01-foundation
plan: 02
subsystem: database
tags: [drizzle, drizzle-kit, pglite, postgres, schema, migration, jsonb, off-plan-guard, instrumentation]

# Dependency graph
requires:
  - phase: 01-01
    provides: Dual-driver Drizzle db seam (lib/db/index.ts), DATABASE_URL branch, globalThis cache
provides:
  - Period-scoped schema (periods, plan_rows, executions, execution_items, item_master + period_type enum)
  - Structural off-plan guard (COMP-01) — NOT NULL FK ON DELETE RESTRICT + composite UNIQUE, no sfid on executions
  - One generated SQL migration source (drizzle/0000_abnormal_magneto.sql) applied to live PGlite
  - Programmatic migrator (lib/db/migrate.ts ensureMigrated) + boot-time instrumentation.ts + db:migrate:local CLI
  - Smoke proof that all five tables physically exist in the live DB
affects: [plan-upload, actuals-grid, dashboard, export, deploy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One drizzle-kit generate SQL source applied to PGlite (migrate()) and Supabase (drizzle-kit migrate) — identical DDL both sides"
    - "Boot-time migration via Next instrumentation.ts register() (Node runtime only, dynamic import)"
    - "Live-DB smoke harness under lib/db/__smoke__/ proves physical table existence the type system can't"

key-files:
  created:
    - lib/db/schema.ts
    - drizzle.config.ts
    - lib/db/migrate.ts
    - lib/db/migrate-cli.ts
    - instrumentation.ts
    - lib/db/__smoke__/tables.ts
    - drizzle/0000_abnormal_magneto.sql
    - drizzle/meta/0000_snapshot.json
    - drizzle/meta/_journal.json
  modified:
    - lib/db/index.ts

key-decisions:
  - "Off-plan guard is a DB invariant: executions has NO sfid + NOT NULL plan_row_id FK ON DELETE RESTRICT; plan_rows UNIQUE(period_id,activity,sfid)"
  - "Money/measures numeric(14,2); totals persisted plain (computed app-side later) — no float, no Postgres generated columns"
  - "ensureMigrated() no-ops on postgres:// so Supabase is migrated by `drizzle-kit migrate` at deploy, not at runtime"
  - "Smoke proves tables via raw db.execute(select … from <table>) — direct existence check, driver-agnostic"

patterns-established:
  - "Single migration source of truth in drizzle/, applied identically to PGlite and Supabase"
  - "Schema changes are proven against the running DB (smoke), not just the type checker"

requirements-completed: [COMP-01]

# Metrics
duration: ~20 min
completed: 2026-06-05
---

# Phase 1 Plan 02: Period-Scoped Schema + Structural Off-Plan Guard Summary

**Five-table period-scoped Drizzle schema where the off-plan guard is a database invariant (NOT NULL FK ON DELETE RESTRICT + composite UNIQUE, no sfid on executions), generated to one SQL source and proven live on PGlite.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-06-04T19:12Z
- **Completed:** 2026-06-04T19:35Z
- **Tasks:** 2 (both auto; Task 2 was the [BLOCKING] live-DB proof)
- **Files modified:** ~10

## Accomplishments
- `lib/db/schema.ts`: periods, plan_rows, executions, execution_items, item_master + `period_type` enum
- COMP-01 off-plan guard structural: `executions.plan_row_id` NOT NULL FK `ON DELETE RESTRICT`, NO `sfid` column; `plan_rows` composite `UNIQUE(period_id, activity, sfid)`
- Generated `drizzle/0000_abnormal_magneto.sql` (verified: 2× ON DELETE RESTRICT, 0× CASCADE, 0× GENERATED, numeric(14,2) money, version integer)
- Applied to live PGlite via `ensureMigrated()`; wired to boot via `instrumentation.ts` and to CLI via `db:migrate:local`
- Smoke proof: all five tables physically exist in the running PGlite DB (`npx tsx lib/db/__smoke__/tables.ts` → exit 0)

## Task Commits

1. **Task 1: Drizzle schema with structural off-plan guard** — `18a5423` (feat)
2. **Task 2: Generate + apply migration, prove 5 tables exist** — `2682aba` (feat)

**Plan metadata:** this SUMMARY commit (docs).

## Files Created/Modified
- `lib/db/schema.ts` — the five tables + enum, with the guard baked in
- `lib/db/index.ts` — wired `import * as schema` into both drivers
- `drizzle.config.ts` — drizzle-kit config (postgresql / pglite driver)
- `lib/db/migrate.ts` — `ensureMigrated()` (no-op on postgres://)
- `instrumentation.ts` — boot-time migration (Node runtime only)
- `lib/db/migrate-cli.ts` — `db:migrate:local` entry
- `lib/db/__smoke__/tables.ts` — live-DB existence proof
- `drizzle/0000_abnormal_magneto.sql` (+ meta) — the migration source of truth

## Decisions Made
See `key-decisions`. The headline is structural COMP-01: no app code can record spend against an unplanned SFID because there is no `sfid` on `executions` and the only path is a NOT NULL FK to a real `plan_rows` row.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Cast `db` in the PGlite migrator call**
- **Found during:** Task 2
- **Issue:** `db` is the `PgliteDatabase | PostgresJsDatabase` union; `migrate()` from `drizzle-orm/pglite/migrator` wants the PGlite type, and the `postgres://` guard doesn't narrow the union for TS.
- **Fix:** `migrate(db as Parameters<typeof migrate>[0], …)` after the early `postgres://` return — the runtime object is the PGlite instance on that branch.
- **Verification:** `tsc --noEmit` clean; `db:migrate:local` applies successfully.
- **Committed in:** `2682aba`

**2. [Rule 1 - Bug] Smoke proves existence via raw `db.execute`**
- **Found during:** Task 2
- **Issue:** A query-builder select would couple the proof to the schema-typed db; a direct existence check is simpler and driver-agnostic.
- **Fix:** `db.execute(sql.raw('select 1 from <table> limit 1'))` per table (fixed const list, no user input).
- **Verification:** Smoke prints all five ✓ and exits 0 against the live DB.
- **Committed in:** `2682aba`

---

**Total deviations:** 2 auto-fixed (both bug-class, type/robustness)
**Impact on plan:** Minor; both improve correctness. No scope creep.

## Issues Encountered
None — schema generated, migrated, and proved on the first pass after the guard greps confirmed the invariants.

## User Setup Required
None for local. **Deploy note (carry to deploy phase):** apply the same migration to Supabase with `drizzle-kit migrate` against the **direct** (`:5432`, non-pooled) connection string; the app runtime then uses the **pooled** (`:6543`, `prepare:false`) string. `ensureMigrated()` intentionally no-ops on `postgres://` so the runtime never migrates production.

## Next Phase Readiness
- Phase 1 schema is live and proven; the off-plan guard (COMP-01) holds at the DB level.
- Ready for Phase 2 (Plan Upload): plan_rows become the allowed-SFID master list per (period, activity); `ON DELETE RESTRICT` already makes non-destructive re-upload (PLAN-06) a structural guarantee.
- Period CRUD UI, item-master management UI, and the "exactly one active period" rule (D-11) are app-layer work for the remaining Phase-1 success criteria (ROADMAP #3, #5) — not yet built; flag for verification.

---
*Phase: 01-foundation*
*Completed: 2026-06-05*
