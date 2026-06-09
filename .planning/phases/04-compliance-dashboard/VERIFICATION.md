# Phase 04 — Compliance & Dashboard — VERIFICATION

**Date:** 2026-06-09
**Branch:** gsd/phase-4-compliance-dashboard
**Method:** Goal-backward — each requirement mapped to delivering code, gates run, plus live headless-browser verification on a seeded September period (16 geo plan rows, 6 Done + 2 Cancelled executions seeded via the test API).

**Overall verdict: PASS** — all 8 requirements (COMP-03, DASH-01..DASH-07) delivered and verified end-to-end.

## Gates

| Gate | Result |
|------|--------|
| `tsc --noEmit` | ✅ clean (exit 0) |
| `vitest run lib/compliance lib/db/dashboard.test.ts` | ✅ 23/23 pass (completeness + tree + dashboard DAL) |
| `buildGeoTree` unit | ✅ 8/8 |
| Playwright `e2e/dashboard.spec.ts` | ✅ 4/4 (DASH-01/04/06/07) |
| Live browser walk-through | ✅ see per-requirement evidence |

## Per-requirement verdicts

| Req | Verdict | Delivering code | Evidence |
|-----|---------|-----------------|----------|
| **COMP-03** — % of plan executed, per activity & per filter scope | ✅ PASS | `lib/compliance/completeness.ts` `computeCompleteness` (single source of truth, D-05); fed per-scope by `lib/db/dashboard.ts` aggregators | Live: % Executed 100% = 12/(16−4) recomputed per scope; narrows with Region filter |
| **DASH-01** — dashboard on login with % executed + counts | ✅ PASS | `app/(app)/dashboard/page.tsx` (RSC) + `stat-strip.tsx`; `/` → `/dashboard` redirect in `app/(app)/page.tsx` | Live: authed `/` redirects; StatStrip shows % + planned/done/cancelled/pending |
| **DASH-02** — breakdown by activity and by region | ✅ PASS | `aggregateByActivity`, `aggregateByRegion` + `by-activity-card.tsx`, `by-region-card.tsx` | Live: Counter Wall 16/12/4; North 8/12/4, South 8/0/0 |
| **DASH-03** — planned budget vs actual spend | ✅ PASS | `aggregateScopeTotals` (planned ₹/actual ₹) + StatStrip + `weekly-spend-chart.tsx` | Live: Actual ₹19,500; weekly spend chart with planned flat reference |
| **DASH-04** — respects active period + Region/State/Distributor filters | ✅ PASS | `dashboard-filter-bar.tsx` (URL searchParams) + filter predicates in DAL | Live: Region North → `?region=North`, planned 16→8 |
| **DASH-05** — distinct Cancelled counter; excluded from % executed denominator | ✅ PASS | `STATUS_VALUES`/`TERMINAL_STATUSES` (`lib/activities/status.ts`); D-03 in `computeCompleteness` (denominator = planned − cancelled) | Live: % Executed 100% AND % Cancelled 25% simultaneously — proves the two denominators differ (12 vs 16) |
| **DASH-06** — week-wise trend (planned/executed/cancelled) + weekly spend; rolling-N view | ✅ PASS | `weekly-trend-chart.tsx`, `weekly-spend-chart.tsx`, `rolling-n-toggle.tsx`; `aggregateWeeklyBuckets` (buckets on `executions.executionDate`) | Live: stacked-area trend across ISO weeks; toggle → `?mode=rolling&weeks=4`; server clamps to {4,8,12} |
| **DASH-07** — Zone→State→District→Taluka drill with counts + expense | ✅ PASS | `lib/compliance/tree.ts` `buildGeoTree` + `geo-drill-tree.tsx` (native `<details>`); `aggregateByGeo` | Live: expandable tree; upward aggregation verified (North plan 8 = StateA 4 + StateB 4; exec/canc/₹ sum) |

## Key design decisions confirmed in code

- **D-03/D-04 asymmetric denominators** — `% executed = executed/(planned − cancelled)`; `% cancelled = cancelled/planned`. Implemented once in `computeCompleteness`, unit-tested, consumed by the RSC.
- **D-06/D-07/D-08 exception isolation** — `lib/db/dashboard.ts` defines module-level predicates `PLAN_UPLOAD_ONLY` (every headline aggregate) and `EXCEPTION_ONLY` (only `aggregateExceptionTotals`). Exception rows are excluded from StatStrip, cards, charts, and the drill tree; they surface only in the Exception Spend card.
- **D-17 status-param ignored** — dashboard FilterBar exposes no status facet; a crafted `?status=Done` is silently ignored (verified live: no facet, stats unchanged).

## Carried-over debt (NOT Phase 4 failures)

Two pre-existing unit-test failures, confirmed failing at commit `390d27b` (before any Phase 4 work) and documented in `deferred-items.md`:
- `lib/db/migrate-0002.test.ts` — hardcodes the `0002` filename for a status backfill that the design-pass PRs renumbered to `0003`.
- `lib/actuals/colDefs.test.ts` — one stale assertion.

Neither touches Phase 4 code; both are tracked for a separate fix.

## Environment note

A pre-existing dev-DB migration-journal drift (the `./.pglite` had columns but a stale Drizzle journal) caused `/actuals` to 500. Root-caused as an environment issue, not Phase 4 code (no executor commit touched actuals runtime; `dashboard.ts` avoids the affected columns). Dev DB was reset during verification (backup at `.pglite.bak-20260609`) and reseeded; `/actuals` returns 200.
