---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Phase 04 Plan 03 COMPLETE — /dashboard route live. RSC page (force-dynamic, parseDashboardFilters Zod + status-strip per D-17, Promise.all of six 04-02 aggregators -> computeCompleteness from 04-01) + four server-rendered cards (StatStrip, ByActivity, ByRegion, Exception/D-07 amber-pill) + DashboardFilterBar client island (Region/State/District/Distributor cascade via optionsFor/D-11, URL-as-source-of-truth, NO status facet) + RefreshButton (revalidateDashboard Server Action, Pitfall 5) + redirect / -> /dashboard + Dashboard nav link. Recharts ^3.2.0 installed (overrides.react-is=$react, React-19 peer fix) with two placeholder slots pre-wired (weekly/byGeo props) for 04-04. tsc clean; npm test 248/250 (2 failures pre-existing at 390d27b, logged in deferred-items.md). Task 4 browser-verify APPROVED: % Executed live 100.0%=1/(1-0) and 0.0%=0/(2-0) (D-04 denominator wired), ?status=Done silently ignored. Next: 04-04 (Wave 3 — Recharts weekly trend + spend charts + rolling-N + Zone-Taluka drill tree + Playwright e2e; DASH-06, DASH-07)."
last_updated: "2026-06-09T11:36:00.000Z"
last_activity: 2026-06-09 -- Phase 04 Plan 03 complete (dashboard route + cards)
progress:
  total_phases: 6
  completed_phases: 3
  total_plans: 22
  completed_plans: 18
  percent: 56
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-04)

**Core value:** Spend stays inside the plan, and execution progress is always visible — only planned SFIDs can receive actuals, and "% of plan executed" is the headline metric.
**Current focus:** Phase 04 — compliance-dashboard

## Current Position

Phase: 04 (compliance-dashboard) — EXECUTING
Plan: 4 of 4 (next)
Status: Executing Phase 04 — Wave 1 (04-01, 04-02) + Wave 2 (04-03) DONE; Wave 3 (04-04) next
Last activity: 2026-06-09 -- Phase 04 Plan 03 complete (dashboard route + cards)

Phase 04 Wave structure:

- Wave 1: 04-01 (status registry + computeCompleteness — COMP-03, DASH-05) — DONE
- Wave 1: 04-02 (lib/db/dashboard.ts aggregators + PGlite tests — DASH-01..07) — DONE
- Wave 2: 04-03 (/dashboard RSC + StatStrip/ByActivity/ByRegion/Exception + FilterBar + redirect + Recharts install — DASH-01..05, DASH-07) — DONE
- Wave 3: 04-04 (Recharts weekly trend + spend charts + rolling-N + Zone-Taluka drill tree + e2e — DASH-06, DASH-07) — TODO

Phase 3 (Actuals Grid) — COMPLETE 5/5 (03-01..03-05).

Phase 3.1 Wave structure:

- Wave 1: 03_1-01 (migration 0002 + default status + Done-lock regression — GRID-10, GRID-11) — DONE
- Wave 1: 03_1-02 (GRID-09 hot-path perf refactor) — DONE
- Wave 2: 03_1-03 (COMP-04 backend: addOffPlanExecution + re-upload guard) — DONE
- Wave 2: 03_1-04 (GRID-12 top+bottom save bar + GRID-13 paste-block) — TODO
- Wave 3: 03_1-05 (COMP-04 frontend: off-plan modal + pill + e2e) — TODO

Progress: [██████░░░░] 60% (3/5 Phase 3.1 plans done)

## Performance Metrics

**Velocity:**

- Total plans completed: 8
- Average duration: ~30 min
- Total execution time: 4.1 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 5 | 145 min | 29 min |
| 02 | 3 | 100 min | 33 min |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 35 min | 4 tasks | 20 files |
| Phase 01 P02 | 20 min | 2 tasks | 10 files |
| Phase 01 P03 | 15 min | 3 tasks | 11 files |
| Phase 01 P04 | 45 min | 3 tasks | 13 files |
| Phase 01 P05 | 30 min | 3 tasks | 7 files |
| Phase 02 P01 | 25 min | 3 tasks | 9 files |
| Phase 02 P02 | 30 min | 3 tasks | 5 files |
| Phase 02 P03 | 45 | 3 tasks | 13 files |
| Phase 03 P01 | 15 min | 1 task | 2 files |
| Phase 03 P02 | 16 min | 3 tasks | 13 files |
| Phase 03 P03 | 12 min | 3 tasks | 4 files |
| Phase 03 P04 | 30 min | 3 tasks | 9 files |
| Phase 03_1 P01 | 21 min | 3 tasks | 9 files |
| Phase 03_1 P03 | 10 min | 3 tasks | 5 files |
| Phase 04 P03 | 55 min | 4 tasks | 12 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Dependency-driven 5-phase order — Foundation → Plan Upload → Grid → Compliance/Dashboard → Export. The hardest-to-retrofit guarantees (off-plan FK, UNIQUE match key, numeric money, version column, RESTRICT, pooled Neon connection) all land in Phase 1.
- [Roadmap]: Confirmed — executions are many-per-plan-row (multi-unit per SFID, e.g. multiple walls); plans carry a planned-cost/budget column (enables budget-vs-actual on the dashboard).
- [02-01]: SheetJS CE 0.20.3 installed from CDN tarball verbatim (no caret range) — D2-06 enforced; CVE-2023-30533 surface eliminated.
- [02-01]: lib/excel/* pure-module convention established — only imports xlsx + ../activities/types + sibling files; no next/react/drizzle/lib/db. Tagged-union returns instead of throws; coerceCell dependency-injected into buildPreview.
- [02-01]: Date kind REJECTS ISO YYYY-MM-DD input on purpose — DD/MM is canonical Indian input; silent ISO acceptance would mask vendor template drift.
- [02-02]: commitPlanUpload uses isFkRestrictError checking BOTH SQLSTATE 23001 (restrict_violation) AND 23503 (foreign_key_violation), duck-typed on err.cause?.code ?? err.code for cross-driver compat (PGlite obfuscates DatabaseError class).
- [02-02]: PLAN_ROW_SCHEMAS built ONCE at module load from ACTIVITIES — NOT z.discriminatedUnion, preserving ACTV-03 (7th activity = registry-only change).
- [02-02]: D2-01 invariant proven via live PGlite smoke (plan-upload:smoke). FK RESTRICT fires on removal of SFID with executions, rollback wipes ALL pending writes (delete + would-be update both undone), blockedDealers re-query returns the offending SFID.
- [02-03]: Plan UI ships end-to-end with client-side parse (D2-06) and useActionState commit; COMP-02 transient blocked-dealers surface proven via Playwright; test-only Route Handler gated triply (NODE_ENV + session + POST).
- [02-03]: Test-only /api/test/seed-execution Route Handler chosen over npm pre-test script because Playwright wipes .pglite/ before every run; defense-in-depth (NODE_ENV !== production + jose session cookie + POST-only) keeps it from being a back door.
- [02-03]: countByPeriodActivity added to lib/db/plan-rows.ts (not a new lib/db/queries/plans.ts) — keeps Phase 2's plan_rows DA in one module per the periods.ts/items.ts shape.
- [03-02]: counter-wall totalCost uses actualSqft directly (entered, not derived) — computeDerived's totalSqft branch for counter-wall returns null; totalCost needs separate actualSqft read.
- [03-02]: num() treats empty string as null (Number("") === 0 in JS, silently finite) — explicit guard `if (s === "") return null` added.
- [03-02]: Dotted-field binding (plan.*, fields.*) confirmed A1 from spike; colDefs also sets colId=key on derived cols for lookup stability.
- [03-02]: matchesSfid is a dedicated plan.sfid predicate (not AG Grid quickFilterText) per A6 finding — prevents false matches on region/dealer columns.
- [03-04]: SaveBar uses useActionState with an inline async wrapper (not a direct Server Action reference) to capture the current dirtyRows closure at click time.
- [03-04]: window.__actualsGridApi exposed in dev mode for e2e column-virtualization (ensureColumnVisible); production-gated by NODE_ENV check.
- [03-04]: Conflict rows marked via __conflict flag in row.fields; rendered as banners outside the AG Grid (data-slot=row-conflict); reloads full page to fetch server state.
- [03_1-01]: D3.1-00/R1 reconciliation re-confirmed at execution start — ZERO source hits for resolveEditable / ==='Done' / metaKey / ctrlKey in lib/ + app/. No lock-on-Done exists; GRID-11 shipped as a regression guard (typeof editable === 'boolean'), nothing removed.
- [03_1-01]: Migration 0002 owns BOTH the COMP-04 plan_rows DDL (source/exception_reason/created_via/created_at + source CHECK) AND the GRID-10 status backfill DML in ONE file — drizzle-kit generate emits DDL only, so the UPDATE was hand-appended after a --> statement-breakpoint (forward-only, idempotent). Downstream plans must NOT generate competing migrations against this DDL.
- [03_1-01]: executions.status kept nullable with NO Postgres DB default — app (buildRowModel/cloneUnitForAdd via DEFAULT_STATUS const) is the single source of truth for new-row defaults (D3.1-03); backfill is a one-time data correction.
- [03_1-01]: source modeled as text + CHECK ('plan-upload','exception'), NOT pgEnum — mirrors the status precedent; adding a future source value stays a one-line CHECK edit.
- [03_1-03]: addOffPlanExecution inserts the exception plan_row FIRST (with sfid) then FKs the execution to its id, both in ONE db.transaction — the off-plan guard (COMP-01) is never weakened: sfid is written ONLY to plan_rows, executions still has no sfid column.
- [03_1-03]: isUniqueViolation(23505) is a sibling helper to plans.ts isFkRestrictError (which explicitly does NOT cover 23505); dupe-SFID on the exception path returns a clean {ok:false} message ("use + add unit"), never a 500 (R3). Duck-typed on err.cause?.code ?? err.code for PGlite/postgres-js parity.
- [03_1-03]: R4 cross-phase guard — commitPlanUpload's merge-delete is scoped to source='plan-upload' (snapshot now SELECTs source), so a plan re-upload never deletes/FK-blocks source='exception' rows (D3.1-02). Regression test proves exception X survives re-upload while plan-upload orphan B is deleted.
- [03_1-03]: addOffPlanExecution signature is single-arg (input: unknown) returning AddOffPlanState, NOT the (prevState, input) useActionState shape — Plan 05's modal calls it directly. No createdBy (single shared password, D3.1-08) — deferred to a future auth phase.
- [03_1-03]: promoteExecutionColumns extracted as a shared helper so saveExecutionsBatch and addOffPlanExecution use ONE authoritative numeric/status split (Pitfall 9 — no calc-path drift).
- [04-03]: Recharts ^3.2.0 installed via npm (npm-safe, unlike xlsx) with overrides.react-is=$react for the React 19 peer-dep fix (Recharts issue #4558); --legacy-peer-deps explicitly NOT used.
- [04-03]: Dashboard FilterBar omits the Status facet entirely (D-17) — the dashboard SHOWS status breakdowns so status faceting is circular; parseDashboardFilters silently strips ?status=... (verified live: ?status=Done ignored, stats unchanged).
- [04-03]: URL is the single source of truth for dashboard filter state — no useState lift; router.replace(scroll:false) on each facet change. Cascade reuses optionsFor from lib/actuals/filter (D-11, not the FilterBar component).
- [04-03]: Dashboard cards are pure RSC presentation — each receives its pre-aggregated slice as a typed prop; zero DB/SQL access inside card components. Every number flows through lib/db/dashboard (04-02) -> computeCompleteness (04-01).
- [04-03]: % Executed and % Cancelled use ASYMMETRIC denominators (D-04): executed/(planned-cancelled) vs cancelled/planned. Verified live (1/(1-0)=100.0%, 0/(2-0)=0.0%); contrast on a single dataset blocked only by AG-Grid headless-edit limitation, math covered by completeness.test.ts.
- [04-03]: Plan-04-04 placeholder slots (weekly-trend-chart, geo-drill-tree) pre-wired with weekly={weekly} and rows={byGeo} props so next-plan chart/tree islands plug in with no further server work.

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

Open questions to resolve in the relevant phase's discuss step (NOT blockers for planning):

- ~~[Phase 1] Plan-row grain for multi-unit activities — multi-unit is confirmed YES~~ — resolved D-03.
- ~~[Phase 2] Non-destructive re-upload semantics~~ — resolved D2-01 (mirror + block on actuals via FK RESTRICT).
- [Phase 4] Exact completeness math for partial / in-progress actuals.
- ~~[Phase 1] Budget/planned-cost column confirmed PRESENT~~ — landed in schema as numeric(14,2).
- ~~[Wave 2 blocker] DEF-02-01-01 — PGlite WASM "Aborted" in `lib/actions/{periods,items}.test.ts`~~ — RESOLVED by commit `5213277` (vitest.config.ts sets `env.DATABASE_URL = process.env.DATABASE_URL ?? "memory://"`). Plan 02-02 ran cleanly; full sweep 82/82 green including the new `lib/actions/plans.test.ts`.

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Test-infra | DEF-02-01-01 — PGlite WASM Aborted in periods.test.ts + items.test.ts | RESOLVED (5213277) | 2026-06-05 / Plan 02-01 |
| Test-infra | DEF-03_1-01-01 — vitest file-parallelism vs PGlite single-connection: `npm test` (parallel) times out DB-backed suites (incl. untouched plans.test.ts); `--no-file-parallelism` is green (14 files / 202 tests). Recommend pinning `test.fileParallelism:false` in vitest.config.ts. | OPEN | 2026-06-08 / Plan 03_1-01 |

## Session Continuity

Last session: 2026-06-09T11:36:00Z
Stopped at: Phase 04 Plan 03 COMPLETE — /dashboard route + four RSC cards + URL-driven FilterBar (no status facet, D-17) + RefreshButton (revalidateDashboard) + redirect / -> /dashboard + Dashboard nav link. Recharts ^3.2.0 installed (overrides.react-is=$react) with placeholder slots pre-wired for 04-04. tsc clean; npm test 248/250 (2 pre-existing failures logged in deferred-items.md). Task 4 browser-verify APPROVED (% Executed live 100.0%/0.0%, ?status=Done ignored). Dev-DB migration-journal drift root-caused as ENVIRONMENT issue (not Phase 4 code), dev DB reset+reseeded (.pglite.bak-20260609). Next: 04-04 (Wave 3 — Recharts charts + rolling-N + Zone-Taluka drill tree + Playwright e2e; DASH-06, DASH-07).
Resume file: 
