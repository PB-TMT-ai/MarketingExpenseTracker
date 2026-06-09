---
phase: 04-compliance-dashboard
plan: 04
subsystem: ui
tags: [recharts, dashboard, charts, drill-tree, playwright, e2e, react-19, nextjs]

# Dependency graph
requires:
  - phase: 04-compliance-dashboard (04-02)
    provides: aggregateByGeo (GeoRow[]) + weekly bucket aggregator + WeekBucket shape
  - phase: 04-compliance-dashboard (04-03)
    provides: /dashboard RSC, StatStrip + cards, FilterBar island, Recharts ^3.2.0 install, two placeholder slots (weekly + byGeo)
provides:
  - Weekly execution trend chart (Recharts stacked AreaChart) — DASH-06
  - Weekly spend chart (Recharts LineChart, actual ₹ + flat planned reference line) — DASH-06
  - Rolling-N toggle (Period / 4w / 8w / 12w) writing to URL searchParams — DASH-06
  - Zone → State → District → Taluka geo drill tree (native <details>) with upward-aggregating metrics — DASH-07
  - lib/compliance/tree.ts pure buildGeoTree(GeoRow[]) → nested GeoTreeNode[] transform
  - Playwright e2e locking DASH-01 / DASH-04 / DASH-06 / DASH-07
affects: [05-excel-export, phase-4-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure compliance-side tree builder (lib/compliance/tree.ts) — framework-free, import type only, O(N) single grouping pass; honors lib/actuals/filter cascade SPIRIT (region→state→district→taluka) without reusing literal optionsFor (GeoRow ≠ UnitRow, RESEARCH Pattern 4 option a)"
    - "Recharts client islands fed pre-aggregated props from RSC (no client fetch); server file (page.tsx) never imports recharts directly"
    - "Native <details>/<summary> collapsible drill tree — DOM materializes lazily, no client cascade re-computation"
    - "Rolling-N toggle as URL-as-source-of-truth client island (router.replace scroll:false); server clamps weeks to {4,8,12} via Plan 04-03 parseDashboardFilters"

key-files:
  created:
    - lib/compliance/tree.ts
    - lib/compliance/tree.test.ts
    - app/(app)/dashboard/weekly-trend-chart.tsx
    - app/(app)/dashboard/weekly-spend-chart.tsx
    - app/(app)/dashboard/rolling-n-toggle.tsx
    - app/(app)/dashboard/geo-drill-tree.tsx
    - e2e/dashboard.spec.ts
    - e2e/fixtures/build-fixtures.ts
    - e2e/fixtures/plan-counter-wall-geo.xlsx
    - app/api/test/seed-execution/route.ts
  modified:
    - app/(app)/dashboard/page.tsx
    - lib/db/plan-rows.ts

key-decisions:
  - "Open Question #4 resolved per planner option (c): weekly TREND chart shows recorded executions only — NO fabricated planned baseline; honest caption 'Trend shows recorded executions only'. The weekly SPEND chart renders planned ₹ as a single flat reference line (period planned ₹ / N weeks), captioned to disclose that plan rows carry no per-week planning cadence."
  - "Geo drill tree kept as a client island ('use client') despite native <details> working without it — preserves the aria-expanded / future inline-edit upgrade path and keeps prop drilling straightforward."
  - "buildGeoTree is a NEW pure module (RESEARCH Pattern 4 option a), not a shoehorn of GeoRow into UnitRow — metrics sum upward at every level (parent.planned === Σ child.planned), the literal guarantee behind DASH-07 success criterion #7."

patterns-established:
  - "Pure tree builder pattern: Map-based single-pass accumulation, alphabetical sibling sort, '(unassigned)' for empty levels, [] for empty input"
  - "Pre-aggregated RSC → Recharts island prop contract: chart components receive buckets/tree, never query the DB"

requirements-completed: [DASH-06, DASH-07]

# Metrics
duration: ~48min
completed: 2026-06-09
---

# Phase 4 Plan 04: Weekly Charts + Geo Drill Tree Summary

**Recharts weekly execution-trend + spend charts, a URL-driven rolling-N toggle, and a native-`<details>` Zone→Taluka geo drill tree with upward-aggregating metrics — closing DASH-06 and completing DASH-07, plus Playwright e2e locking the four headline dashboard behaviors.**

## Performance

- **Duration:** ~48 min
- **Started:** 2026-06-09 (Wave 3)
- **Completed:** 2026-06-09
- **Tasks:** 4 (3 auto + 1 blocking browser-verify checkpoint, APPROVED)
- **Files modified:** 12 (10 created, 2 modified)

## Accomplishments

- **DASH-06 landed:** weekly execution trend chart (stacked Cancelled / Executed / Pending areas by ISO Monday-start week) + weekly spend chart (actual ₹ line + flat planned reference line) + rolling-N toggle (Period / 4w / 8w / 12w) writing `?mode=rolling&weeks=N` to the URL with server clamping to {4,8,12}.
- **DASH-07 completed:** Zone → State → District → Taluka drill tree via nested native `<details>`; each level shows planned / executed / cancelled counts + planned ₹ / actual ₹, with metrics aggregating upward (parent === Σ children, verified live).
- **lib/compliance/tree.ts:** pure `buildGeoTree(GeoRow[]) → GeoTreeNode[]` transform — framework-free, `import type` only, single O(N) grouping pass, alphabetical sibling sort, `(unassigned)` handling.
- **Playwright e2e (e2e/dashboard.spec.ts):** 4 tests covering DASH-01 (StatStrip non-zero + `/`→`/dashboard` redirect), DASH-04 (region filter narrows stats), DASH-06 (trend chart SVG renders + 4w toggle updates URL), DASH-07 (zone expands to states + planned counts aggregate upward).

## Task Commits

1. **Task 1: Pure tree builder + unit tests (TDD)**
   - RED — `9c26f68` (test: failing tests for buildGeoTree)
   - GREEN — `37b157d` (feat: implement pure buildGeoTree drill-tree builder)
2. **Task 2: Four client islands + page.tsx swap** - `30deb13` (feat: weekly charts, rolling-N toggle, geo drill tree islands)
3. **Task 3: Playwright e2e DASH-01/04/06/07** - `a8b3f4d` (test: Playwright e2e + seed-route knobs)
4. **Task 4: Browser-verify charts/toggle/drill tree** - checkpoint, gate=blocking — **APPROVED** by orchestrator (no code commit; verification gate)

**Plan metadata:** this SUMMARY + tracking — `docs(04-04)`

_TDD Task 1 used the test → feat cadence (RED `9c26f68` → GREEN `37b157d`); no separate refactor commit was needed._

## Files Created/Modified

- `lib/compliance/tree.ts` - Pure `buildGeoTree` / `GeoTreeNode` — flat `GeoRow[]` → nested region→state→district→taluka tree, metrics summed upward
- `lib/compliance/tree.test.ts` - Unit tests: hierarchy (4 levels from a 2×2×2×2 = 16-row input), upward sum, alphabetical sort, `(unassigned)`, empty input — 8/8 passing
- `app/(app)/dashboard/weekly-trend-chart.tsx` - Recharts stacked `AreaChart` client island (executed / pending+wip / cancelled by ISO week)
- `app/(app)/dashboard/weekly-spend-chart.tsx` - Recharts `LineChart` client island (actual ₹ + flat planned reference line)
- `app/(app)/dashboard/rolling-n-toggle.tsx` - Period / 4w / 8w / 12w segmented toggle writing to URL searchParams via `router.replace`
- `app/(app)/dashboard/geo-drill-tree.tsx` - Native `<details>` Zone→Taluka drill tree consuming `buildGeoTree(byGeo)`
- `app/(app)/dashboard/page.tsx` - Swapped the two Plan 04-03 placeholder slots for the real islands; wired `buildGeoTree(byGeo)` and `plannedBaseline` (surgical edit only)
- `e2e/dashboard.spec.ts` - Playwright e2e for DASH-01 / DASH-04 / DASH-06 / DASH-07
- `e2e/fixtures/build-fixtures.ts` + `e2e/fixtures/plan-counter-wall-geo.xlsx` - Geo-spread seed fixture (2 zones × 2 states × 2 districts × 2 talukas)
- `lib/db/plan-rows.ts` - Seed knobs for geo-spread test data
- `app/api/test/seed-execution/route.ts` - Test-only execution seed Route Handler (3 security gates: NODE_ENV ≠ production + jose session + POST-only)

### Recharts surface imported (for v2 bundle audit)

- **weekly-trend-chart.tsx:** `AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend`
- **weekly-spend-chart.tsx:** `LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend` (flat planned reference line drawn via synthetic constant series / ReferenceLine)
- 7 Recharts SVGs render on the seeded September page with no console errors.

### e2e seed sizes used

- **DASH-01:** one period + plan rows + a Done execution (asserts non-zero `<dd>`).
- **DASH-04:** two regions with equal counts; selecting one region narrows at least one stat.
- **DASH-06:** executions on 2 distinct ISO weeks; asserts trend-chart SVG present + 4w toggle → `?mode=rolling&weeks=4`.
- **DASH-07:** plan rows across 2 zones × 2 states × 2 districts × 2 talukas (16 geo rows); asserts zone expands to states and zone planned === Σ visible state planned.

## Decisions Made

- **Open Question #4 (planned baseline) — option (c):** trend chart shows recorded executions only, no fabricated planned series; spend chart shows planned ₹ as a single flat reference line (period planned ₹ / N weeks) with an honest disclosure caption. Implemented and captioned exactly as planned.
- **Geo drill tree as a client island** to preserve the `aria-expanded` / future inline-edit upgrade path even though native `<details>` would work server-side.
- **`buildGeoTree` as a new pure module** (RESEARCH Pattern 4 option a) rather than reusing `optionsFor` — `GeoRow` ≠ `UnitRow`; upward metric summation is the literal mechanism behind DASH-07 #7.

## Deviations from Plan

None - plan executed exactly as written.

The two pre-existing out-of-scope test failures (`migrate-0002.test.ts`, `colDefs.test.ts`) were already logged in `deferred-items.md` at `390d27b` and were correctly left untouched per the scope boundary.

## aggregateByGeo ↔ tree-builder shape note

No drift. `aggregateByGeo` (Plan 04-02) returns the flat `GeoRow[]` shape (`region / state / district / taluka` + `plannedUnits / executedUnits / cancelledUnits / plannedCost / actualCost`) that `buildGeoTree` consumes directly; the tree builder uses `import type { GeoRow }` only and recomputes nothing at render time.

## Verification

- `npx tsc --noEmit` — clean.
- `buildGeoTree` unit tests — 8/8 passing (`lib/compliance/tree.test.ts`).
- Playwright e2e — 4/4 green (DASH-01 / DASH-04 / DASH-06 / DASH-07).
- **Task 4 browser-verify (gate=blocking) — APPROVED.** Orchestrator drove `/browse` on a seeded September period (16 geo plan rows) and confirmed: stacked execution-trend chart by ISO week; weekly spend actual ₹ line + flat planned reference; rolling-N toggle URL behavior + server clamp to {4,8,12}; Zone→State→District→Taluka tree with upward aggregation (North plan 8 = StateA 4 + StateB 4); region filter narrows StatStrip + charts + tree consistently; StatStrip D-03/D-04 asymmetry proven live (% Executed 100% = 12/(16−4) AND % Cancelled 25% = 4/16 simultaneously, different denominators); actual ₹19,500 cost aggregation; 7 Recharts SVGs, no console errors.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. The `app/api/test/seed-execution` Route Handler is test-only and triply-gated (NODE_ENV ≠ production + jose session + POST-only).

## Next Phase Readiness

- **Phase 4 (Compliance & Dashboard) is COMPLETE — 4/4 plans.** All eight requirements (COMP-03, DASH-01 through DASH-07) shipped and Playwright-asserted.
- Ready for Phase 4 verification, then Phase 5 (Excel Export), which reuses the filtered query and activity column order already built.

## Self-Check: PASSED

- Commits verified present: `9c26f68`, `37b157d`, `30deb13`, `a8b3f4d`.
- All created files tracked in git (tree.ts/.test.ts, four dashboard islands, e2e spec/fixtures, seed-execution route).
- SUMMARY.md written.

---
*Phase: 04-compliance-dashboard*
*Completed: 2026-06-09*
