# Phase 04 — Deferred / Out-of-Scope Items

Items discovered during execution that are NOT caused by the current plan's changes
(SCOPE BOUNDARY rule). Logged, not fixed, by the 04-03 executor.

## Pre-existing test failures (confirmed at commit 390d27b, before any 04-03 work)

Verified by checking out `390d27b` (the wave-1 docs commit, prior to Recharts install and
the dashboard build) in a detached worktree and running the two files: both fail there too.
They do not import or depend on any dashboard / Plan 04-03 code.

1. **`lib/actuals/colDefs.test.ts:319`** — expects `c.editable` to be `true` (a static
   boolean) for actual columns, but it is now `[Function editableUnlessDone]`. A Phase 3.1
   change made `editable` a gating function; the test was not updated. Phase 3/3.1 territory.

2. **`lib/db/migrate-0002.test.ts:160`** — expects the journaled `0002` `.sql` migration to
   contain `UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL` after a
   statement-breakpoint, but the journaled file only carries the two `ADD COLUMN` statements
   (`notes`, `overrides_log`). The status backfill appears to live in a different/renumbered
   migration. Phase 3.1 migration-journaling territory.

Both should be triaged by a Phase 3.1 follow-up or a dedicated `/gsd-debug` pass — they are
outside the Phase 4 dashboard scope.
