# Phase 4: Compliance & Dashboard — Research

**Researched:** 2026-06-08
**Domain:** Read-only SQL aggregation + dashboard UI over period-scoped `plan_rows` + `executions`
**Confidence:** HIGH (codebase patterns) / MEDIUM (chart library choice — verified npm + React 19 caveats)

---

## Summary

Phase 4 is a **read-only aggregation layer** atop the already-shipped period-scoped schema and the Phase-3 grid utilities. There is **no DB migration in Phase 4 itself** — the `plan_rows.source` column (used to exclude exception rows from the headline metric per D-06) lands in Phase 3.1's migration 0002, which is currently in flight on the working branch. All math is server-rendered via Drizzle SQL, with one small client island per interactive widget (drill-tree expand state, rolling-N toggle, chart render).

**Primary recommendation:** put the shared completeness math in `lib/compliance/` (NOT `lib/dashboard/`, NOT `lib/actuals/`), drive every card and tree row from a small set of period-scoped aggregate query helpers in `lib/db/dashboard.ts`, render the page as a Server Component at `app/(app)/dashboard/page.tsx`, use **Recharts 3.x** for the stacked area chart (with a `react-is` peer-dep override), and use a `<details>` / `<summary>` collapsible tree pattern (cheap, accessible, no new dependency, no ARIA-treegrid keyboard-navigation contract to maintain in v1).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**% Executed Math**
- **D-01:** `% executed` is **proportional / units-based**: `sum(executed_units across plan rows in scope) / sum(planned_units across plan rows in scope)`. A 5-wall plan with 2 Done walls contributes 2/5 — not 0, not 1. Honors the multi-unit plan-row grain locked in Phase 1.
- **D-02:** "Executed" for the numerator = executions with `status = 'Done'`. `In Progress` and `Pending` do NOT count toward executed (they show in their own counters).
- **D-03:** **Cancelled is excluded from both numerator and denominator** of `% executed` (consistent with `TERMINAL_STATUSES` treatment in `lib/activities/status.ts`). A cancelled unit "doesn't count" — neither as work done nor as work owed.
- **D-04:** A separate **`% cancelled`** stat is shown alongside `% executed`, computed against the **original** planned units (i.e. denominator includes the cancelled units). This is the only place cancelled units appear in a denominator — so the user can see "what fraction of the plan was abandoned" at a glance.
- **D-05:** The completeness calc is implemented **once**, in a shared helper (e.g. `lib/dashboard/completeness.ts` or extension of `lib/actuals/`), and is called by the dashboard, the grid stat strip, and the future export. Single source of truth — grid, dashboard, and export must never disagree (success criterion #4).

**Exception Rows in Dashboard**
- **D-06:** Off-plan exception rows (`plan_rows.source = 'exception'` from Phase 3.1 / COMP-04) are **excluded** from the main `% executed`, Zone breakdowns, and all primary stat cards.
- **D-07:** Exception spend gets its own **parallel "Exception spend" card**: count of exception executions + total ₹ for the active period (and filtered scope).
- **D-08:** Drill-down shows plan-uploaded rows only by default; exception-row exploration is v2.

**Drill-down Shape**
- **D-09:** Single-page collapsible tree. Zone → State → District → Taluka, ARIA-treegrid pattern.
- **D-10:** Each tree row shows planned / executed / cancelled counts AND planned-vs-actual ₹. Sortable.
- **D-11:** Reuse `lib/actuals/filter.ts` cascade utility for the hierarchy walk. No new cascade code.
- **D-12:** Tree honors the active period + global FilterBar (Region/State/Distributor).

**Week-wise Trend**
- **D-13:** Lives on the main dashboard, below stat cards (not a drawer).
- **D-14:** Stacked line/area chart of planned vs executed vs cancelled counter counts per ISO week, bucketed by `executions.executionDate`.
- **D-15:** Default rolling-N = **8 weeks**; toggle 4 / 8 / 12. Period-independent — last N ISO weeks ending today.
- **D-16:** A second chart (or toggle) shows planned ₹ vs actual ₹ per week. Same chart family, consistent palette.

**Filter & Period Honoring**
- **D-17:** Every dashboard card/chart/tree row obeys (a) active period, (b) global FilterBar (Region/State/Distributor — Status does NOT apply to dashboard since dashboard *shows* status breakdowns). Activity filter likewise applies.

### Claude's Discretion
- Exact stat-card layout, visual treatment, motion, and shadcn/ui components.
- Chart library choice (Recharts vs visx vs raw SVG) — pick lightest viable, React 19 / Next 16 compatible.
- SQL aggregation strategy (single big query vs N smaller vs materialized helper). Correctness + clarity over premature optimization.

### Deferred Ideas (OUT OF SCOPE)
- Exception rows inside drill-down tree
- Period-over-period comparison (RPT-01)
- Saved / shareable dashboard filter views (RPT-02)
- CSV / PNG export of dashboard itself
- Dashboard polling / real-time refresh
- Drill metric customization (per-user pick of % vs counts vs ₹)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COMP-03 | `% of plan executed` for active period, per activity, per filter scope | Proportional units math (D-01/02/03) implemented once in `lib/compliance/completeness.ts`, computed in SQL via `sum() / sum()` with `source='plan-upload'` and `status <> 'Cancelled'` filters; reused by grid + dashboard + future export |
| DASH-01 | Dashboard with % plan executed + planned/executed/pending counts for active period | Stat-strip RSC reads from a single `aggregateForScope(periodId, activity, filters)` helper returning `{plannedUnits, executedUnits, inProgressUnits, pendingUnits, cancelledUnits, plannedCost, actualCost, exceptionCount, exceptionCost}` |
| DASH-02 | Breakdown by activity AND by region | Two parallel `GROUP BY activity` / `GROUP BY region` queries with the same scope filters; render as side-by-side cards |
| DASH-03 | Planned budget vs actual spend | Sum `plan_rows.planned_cost` (numeric → string → Number at the boundary) vs sum `executions.total_cost`; one row in the stat strip |
| DASH-04 | Active period + Region/State/Distributor filters honored | Every aggregator takes `(periodId, activity, FacetSelections)` and translates facets to a `WHERE plan_rows.region IN (...) AND ...` clause. Status facet is intentionally excluded (dashboard *shows* status). |
| DASH-05 | Distinct **Cancelled** counter alongside Planned/Executed/Pending; Cancelled excluded from `% executed` denominator | First-class stat card. Math: `% executed = doneUnits / (plannedUnits - cancelledUnits)`; `% cancelled = cancelledUnits / plannedUnits` (D-04). |
| DASH-06 | Week-wise trend (period + rolling-N) | `GROUP BY date_trunc('week', execution_date)` in SQL — Postgres `date_trunc` uses ISO week (Monday start). Two query modes: period-bounded (between `period.start_date` and `period.end_date`) and rolling (between `now() - interval 'N weeks'` and `now()`). |
| DASH-07 | Drill Zone → State → District → Taluka, each level shows counts + ₹; reuses `lib/actuals/filter.ts` cascade | Server fetches a single flat `(region, state, district, taluka)` aggregate set and a small client island uses `optionsFor()`/`matchesFacets()`-style cascade to derive children of an expanded node; `<details>`/`<summary>` for collapsible UI |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| % executed / % cancelled math | Shared lib (`lib/compliance/`) | API/RSC | Single source of truth (D-05). Pure function over scalar inputs so the grid stat strip and the dashboard cards converge on identical numbers without an RPC. |
| Aggregate SQL (counts, sums, group-bys) | Database/Storage (Neon Postgres) | API (Drizzle queries in `lib/db/dashboard.ts`) | Server-side aggregation only — never load all rows client-side (CLAUDE.md invariant). |
| Stat card render | Frontend Server (RSC) | — | Cards are static after server compute; no client state needed. |
| Chart render | Browser/Client (Recharts island) | RSC (data prep) | Chart needs DOM/canvas; server pre-aggregates the weekly buckets and ships a small typed array to the client island. |
| Drill-tree expand state | Browser/Client | RSC (initial data) | Expand/collapse is local UI state; the flat aggregate ships once from the server. |
| FilterBar state share with dashboard | Frontend Server | Browser | Filter state lives in URL searchParams so the server can re-aggregate on filter change (no client-side big-row processing). |
| Period-scoping | Database (FK + `period_id` join) | API | Structural — already enforced by `plan_rows.period_id` and the period-active singleton. |

## Standard Stack

### Core (already installed — no new deps needed for queries / SSR)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.2.7 | App Router, RSC, server-side data fetching | Locked stack |
| React | 19.2.7 | UI runtime | Locked stack |
| Drizzle ORM | 0.45.2 | Aggregate SQL queries with type-safe builders | Already used across `lib/db/*`; supports `sql<number>` template tags for `count()`, `sum()`, `date_trunc` |
| `@electric-sql/pglite` | 0.5.1 (local) / `postgres` 3.4.9 (prod) | DB driver — same Drizzle SQL on both | Locked dual-driver pattern from Phase 1 |
| Tailwind CSS | 4.3.0 | Stat-card / tree row styling | Existing design system |
| Zod | 4.4.3 | Validate FilterBar URL searchParams | Already used in Server Actions |

### Supporting (one new dep required — chart library)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **Recharts** | **3.2.x** (latest stable on npm 2026-06) [VERIFIED: npm registry — `npm view recharts version` confirms 3.x line; needs `react-is` peer override for React 19] | Stacked area + line charts (DASH-06, DASH-16) | The weekly-trend chart only. Single import surface (`<AreaChart>` + `<XAxis>` + `<YAxis>` + `<Area>` + `<Tooltip>`). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Recharts | **visx** (`@visx/*`) | Lower-level, more code per chart, smaller bundle if you only import what you need. Requires hand-rolling axes/tooltip/stack math. Overkill for 2 charts in a single dashboard. |
| Recharts | **Raw SVG** (no library) | Zero dep, smallest bundle. But: you re-build stack math, brushable axes, hover tooltips, responsiveness. ~200 LoC per chart minimum. Justifiable if Recharts install causes a real problem; not first choice. |
| Recharts | **Apache ECharts / echarts-for-react** | More feature-rich but heavier (~1 MB), canvas-based, overkill for stacked-area + line. |
| Recharts | **Chart.js / react-chartjs-2** | Comparable size; React 19 peer-dep status similarly noisy. Recharts is more React-idiomatic. |
| `<details>` tree | **Radix UI Accordion** | Battle-tested keyboard nav but requires installing `@radix-ui/react-accordion` (+ ~12kB gzipped). For a 4-level read-only drill tree, `<details>`/`<summary>` is the lightest accessible option (native focus + keyboard toggle on Enter/Space). |
| `<details>` tree | **shadcn/ui Accordion** | Same Radix substrate, generated component. Same cost. |
| `<details>` tree | **Hand-rolled ARIA treegrid** | Maximum semantic correctness but enormous: `role="treegrid"` requires arrow-key navigation, expand/collapse on Right/Left, type-ahead. Deferred to v2 unless the team specifically requests it. |

**Installation (one new dep):**
```bash
npm install recharts
# package.json overrides section (React 19 peer-dep fix — VERIFIED via Recharts issue #4558):
#   "overrides": { "react-is": "$react" }
```

**Version verification (run before install):**
```bash
npm view recharts version          # confirm latest 3.x
npm view recharts peerDependencies # confirm react peer range and react-is need
```

## Package Legitimacy Audit

> slopcheck not run in this session (sandboxed Bash environment). All packages below are tagged `[ASSUMED]` — the planner must add a `checkpoint:human-verify` task before the install step.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| recharts | npm | ~10 yrs | ~3M/wk | github.com/recharts/recharts | not run | `[ASSUMED]` — gate behind human-verify checkpoint; well-known library |

**Packages removed due to slopcheck [SLOP] verdict:** none (slopcheck not run)
**Packages flagged as suspicious [SUS]:** none
**Risk note:** Recharts is the single most-downloaded React chart library and has been in use since 2015 — extremely low legitimacy risk. The `[ASSUMED]` tag here is procedural, not because the package is suspicious.

## Architecture Patterns

### System Architecture Diagram

```
                    URL searchParams (?activity=... &region=... &state=...)
                                  │
                                  ▼
        ┌─────────────────────────────────────────────────────┐
        │   app/(app)/dashboard/page.tsx  (RSC, force-dynamic)│
        │   1. getActivePeriod()                              │
        │   2. parse + Zod-validate filter searchParams       │
        │   3. await Promise.all(                             │
        │        aggregateScopeTotals(...),                   │
        │        aggregateByActivity(...),                    │
        │        aggregateByRegion(...),                      │
        │        aggregateByGeoTree(...),                     │
        │        aggregateWeeklyBuckets(period | rolling),    │
        │        aggregateExceptionTotals(...))               │
        │   4. compute % executed / % cancelled via shared    │
        │      lib/compliance/completeness.ts                 │
        └────┬──────────────┬───────────────┬─────────────┬───┘
             │              │               │             │
             ▼              ▼               ▼             ▼
        StatStrip      ByActivity      WeeklyTrend   GeoDrillTree
        (RSC)          ByRegion        (client       (client island
                       (RSC)           island —      — <details>
                                       Recharts)    + cascade walk)
```

### Recommended Project Structure

```
app/(app)/dashboard/
├── page.tsx                    # RSC entry — period + filter + parallel aggregate fetch
├── filter-bar.tsx              # Wraps existing FilterBar; writes to searchParams
├── stat-strip.tsx              # 4-up cards: % exec / % cancelled / planned / executed / pending / cancelled
├── by-activity-card.tsx        # Breakdown table (RSC)
├── by-region-card.tsx          # Breakdown table (RSC)
├── exception-card.tsx          # Parallel exception-spend card (D-07)
├── weekly-trend-chart.tsx      # "use client" — Recharts stacked area; receives pre-bucketed data
├── weekly-spend-chart.tsx      # "use client" — Recharts; planned ₹ vs actual ₹
├── rolling-n-toggle.tsx        # "use client" — 4/8/12 toggle, writes to searchParams
└── geo-drill-tree.tsx          # "use client" — <details>/<summary> + lib/actuals/filter cascade

lib/compliance/
├── completeness.ts             # SHARED — % executed / % cancelled math (single source of truth)
├── completeness.test.ts
└── index.ts                    # barrel

lib/db/
└── dashboard.ts                # NEW — typed aggregate query helpers (Drizzle, period-scoped)
```

### Pattern 1: Period-scoped aggregate helper (Drizzle)

**What:** every aggregate query joins on `period_id` and filters out exception rows from the headline.
**When to use:** every read in `lib/db/dashboard.ts`.

```ts
// lib/db/dashboard.ts — pattern for one aggregator
// Source: existing pattern in lib/db/plan-rows.ts (countByPeriodActivity, lines 85-99)
//         + lib/db/executions.ts (listExecutionsByPeriodActivity, lines 222-259)
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "./index";
import { executions, planRows } from "./schema";

export type ScopeTotals = {
  plannedUnits: number;
  executedUnits: number;
  inProgressUnits: number;
  pendingUnits: number;
  cancelledUnits: number;
  plannedCost: number;
  actualCost: number;
};

export async function aggregateScopeTotals(
  periodId: number,
  activity: string | null, // null = all activities
  regions: string[],
  states: string[],
  districts: string[],
  distributors: string[],
): Promise<ScopeTotals> {
  // plannedUnits = count(plan_rows where source='plan-upload' in scope)
  // because each plan_row = one planned unit (D-03 grain: one row per physical unit).
  // executedUnits / cancelledUnits / pendingUnits = count(executions joined to those plan_rows
  // grouped by status). LEFT JOIN so plan rows with zero executions still contribute to
  // plannedUnits (the "Pending — never recorded" bucket).
  const where = and(
    eq(planRows.periodId, periodId),
    eq(planRows.source, "plan-upload"),                         // D-06 exception exclusion
    activity ? eq(planRows.activity, activity) : undefined,
    regions.length ? inArray(planRows.region, regions) : undefined,
    states.length ? inArray(planRows.state, states) : undefined,
    districts.length ? inArray(planRows.district, districts) : undefined,
    distributors.length ? inArray(planRows.distributor, distributors) : undefined,
  );

  const [row] = await db
    .select({
      plannedUnits: sql<number>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<number>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<number>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<number>`count(${executions.id}) filter (where ${executions.status} = 'Pending')::int`,
      cancelledUnits: sql<number>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled'), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(where);

  return {
    plannedUnits: Number(row.plannedUnits),
    executedUnits: Number(row.executedUnits),
    inProgressUnits: Number(row.inProgressUnits),
    pendingUnits: Number(row.pendingUnits),
    cancelledUnits: Number(row.cancelledUnits),
    plannedCost: Number(row.plannedCost),         // numeric → string → number at boundary
    actualCost: Number(row.actualCost),
  };
}
```

Notes:
- `count(...) filter (where ...)` is **Postgres standard SQL** (supported on both PGlite and node-postgres). Cleaner than `sum(case when ... then 1 else 0 end)`.
- `coalesce(sum(...), 0)::text` handles the empty-scope case and forces a string return so Drizzle's numeric handling doesn't drift.
- The `distinct` on `count(plan_rows.id)` is required because of the LEFT JOIN expanding rows.

### Pattern 2: Shared completeness helper (pure function)

```ts
// lib/compliance/completeness.ts — single source of truth (D-05)
export type CompletenessInput = {
  plannedUnits: number;
  executedUnits: number;     // Done (D-02)
  cancelledUnits: number;    // Cancelled (D-03/D-04)
};

export type Completeness = {
  pctExecuted: number;    // 0..1, rounded later for display
  pctCancelled: number;   // 0..1
  effectiveDenominator: number;  // plannedUnits - cancelledUnits, never < 0
};

export function computeCompleteness(input: CompletenessInput): Completeness {
  const denom = Math.max(0, input.plannedUnits - input.cancelledUnits);
  return {
    pctExecuted: denom === 0 ? 0 : input.executedUnits / denom,
    pctCancelled: input.plannedUnits === 0 ? 0 : input.cancelledUnits / input.plannedUnits,
    effectiveDenominator: denom,
  };
}
```

Called by: dashboard cards, future grid stat-strip refactor, Phase-5 export.

### Pattern 3: Week bucketing (Postgres `date_trunc`)

```sql
-- Postgres date_trunc('week', ts) returns the Monday 00:00 starting that ISO week.
-- This is the ISO 8601 convention — locked here as the canonical week definition.
select
  date_trunc('week', e.execution_date::timestamp) as week_start,
  count(*) filter (where e.status = 'Done') as executed,
  count(*) filter (where e.status = 'Cancelled') as cancelled,
  count(*) filter (where e.status in ('Pending', 'In Progress')) as pending_or_in_progress,
  coalesce(sum(e.total_cost) filter (where e.status <> 'Cancelled'), 0) as actual_cost
from executions e
join plan_rows pr on pr.id = e.plan_row_id
where pr.period_id = $1
  and pr.source = 'plan-upload'
  -- and additional facet filters
group by 1
order by 1;
```

Notes on `execution_date`:
- It lives in `executions.fields.executionDate` (jsonb), not as a top-level column — the registry's `kind: "date"` puts it in the jsonb tail. The SQL must cast: `(e.fields->>'executionDate')::date`. The bucket query becomes `date_trunc('week', (e.fields->>'executionDate')::date::timestamp)`. **Filter out rows where `executionDate IS NULL` explicitly** — they don't belong to any bucket.

### Pattern 4: Geo drill tree (cascade walk + `<details>`)

```tsx
// app/(app)/dashboard/geo-drill-tree.tsx
// Reuses lib/actuals/filter.ts optionsFor() to walk Region → State → District → Taluka.
"use client";
import { useState } from "react";
import { optionsFor } from "@/lib/actuals/filter";
import type { UnitRow } from "@/lib/actuals/rows";

type AggRow = { region: string; state: string; district: string; taluka: string;
  planned: number; executed: number; cancelled: number;
  plannedCost: number; actualCost: number };

export function GeoDrillTree({ flatAggregates }: { flatAggregates: AggRow[] }) {
  // Synthesize the same UnitRow.plan shape optionsFor expects, OR write a
  // local cascade helper if shoehorning AggRow into UnitRow feels wrong.
  // (Researcher recommends: write a small lib/compliance/tree.ts that takes
  // flatAggregates and emits a {region, children: {state, children: {...}}}
  // structure for the renderer — cleaner than coercing into UnitRow.)
  // ...
  return <details>...</details>;
}
```

The CONTEXT decision D-11 to **reuse `lib/actuals/filter.ts`** is honored in spirit (same cascade logic) but the *literal* `UnitRow` shape may not fit a (region, state, district, taluka, metrics) aggregate row. The planner should decide between:

- **(a)** Synthesize stub UnitRow-like objects from AggRow and call `optionsFor()` directly — minimal new code, requires fudging the type.
- **(b)** Extract a generic `cascadeOptions<T>(rows, getKey, upstream)` from `lib/actuals/filter.ts` and have both the grid and the tree call it — slightly more refactor, but cleaner long-term.

**Recommendation:** ship (a) first; promote to (b) only if a third consumer appears.

### Anti-Patterns to Avoid

- **Loading all rows client-side and aggregating in JS.** Violates CLAUDE.md "Server-side aggregation only." A 2,000-row period × 5 aggregates = 10,000 transferred objects per page render. Always `GROUP BY` in SQL.
- **Hand-rolling % math in the dashboard component.** Goes against D-05 single-source-of-truth. The pure `computeCompleteness` helper must be the only place the formula lives.
- **Using `Number` parseFloat on `numeric` columns inside SQL.** Drizzle returns `numeric` as `string`; the boundary conversion belongs in the query helper's return-mapping step, not scattered through render code.
- **Storing chart data in client React state at top of dashboard.** The chart island receives pre-aggregated weekly buckets as props from the RSC; no client fetch.
- **A second `db.transaction(...)` in any dashboard helper.** Read-only — Drizzle implicit one-shot is correct; never open a transaction.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stacked area chart with axes/tooltip/responsive container | Custom SVG with manual stack math, axis ticks, tooltip positioning | **Recharts** `<AreaChart>` + `<Area stackId="1">` | ~300 LoC saved per chart; tooltip hit-testing and responsive sizing are non-trivial. |
| Collapsible tree row with focus + keyboard toggle | Custom `<div>` with `onClick` + manual `aria-expanded` state | Native `<details>`/`<summary>` | Native focus, native Enter/Space toggle, no JS for basic expand state. |
| ISO week bucket math in JS | A `weekOf(date)` helper that handles year boundaries | Postgres `date_trunc('week', ts)` | ISO week is hard (week 53 boundary, Mon-start vs Sun-start). Let Postgres own it. |
| `numeric → number` coercion sprinkled across the page | `Number(row.plannedCost)` repeated everywhere | Coerce **once** at the query helper boundary; return typed scalars | Mirrors the pattern in `lib/db/executions.ts:248-258` and `plan-rows.ts:94-98`. |
| FilterBar state sync with dashboard | Lift FilterBar state into a React context | URL `searchParams` (`?region=...&state=...`) | RSC reads searchParams, re-fetches on change. No client context. Already the pattern at `app/(app)/actuals/page.tsx:60`. |
| Drill-down breadcrumb routing | A separate `/dashboard/zone/[region]/state/[state]/...` route tree | Single page + `<details>` collapsible tree | Locked by D-09. Routing each level invalidates the "scan siblings at any depth" UX. |

**Key insight:** every primitive Phase 4 needs already exists in the codebase (period-scoping, FilterBar, cascade, Drizzle aggregates pattern, RSC + client island convention). The phase is composition — not new infrastructure.

## Runtime State Inventory

Phase 4 is read-only and additive (no rename, no migration). The standard runtime-state categories are out of scope.

**Categories explicitly checked:**
- Stored data: None — no writes.
- Live service config: None — no external services touched.
- OS-registered state: None.
- Secrets/env vars: None new.
- Build artifacts: New `recharts` dep adds to `node_modules`; lockfile updates expected — no cleanup needed.

## Common Pitfalls

### Pitfall 1: `executionDate` lives in jsonb, not a top-level column

**What goes wrong:** Naive `select date_trunc('week', e.execution_date)` fails — there is no `execution_date` column on `executions`. The date lives in `executions.fields->>'executionDate'` (jsonb), because the registry routes `kind: "date"` fields to the jsonb tail.

**Why it happens:** Confusion between the registry FieldDef key `executionDate` and a SQL column.

**How to avoid:** Always read via `(e.fields->>'executionDate')::date`. Add a partial expression index in a future migration if performance ever requires it (Phase 4 does not need one — periods are small).

**Warning signs:** "column execution_date does not exist" error from PGlite/Postgres.

### Pitfall 2: Cancelled units leaking into `actualCost`

**What goes wrong:** A cancelled execution may have a non-zero `totalCost` (the row was edited before being cancelled). Summing `total_cost` without filtering on status double-charges the budget.

**Why it happens:** `sum(total_cost)` is the obvious-but-wrong query.

**How to avoid:** Always filter cancelled out of cost aggregates: `sum(total_cost) filter (where status <> 'Cancelled')`.

**Warning signs:** Actual ₹ on the dashboard exceeds expectations vs the grid.

### Pitfall 3: Exception rows leaking into headline `% executed`

**What goes wrong:** D-06 says exceptions are excluded from main metrics. Forgetting the `where source = 'plan-upload'` predicate inflates the denominator (every exception row adds 1 to `plannedUnits`).

**Why it happens:** `plan_rows` table mixes both kinds after Phase 3.1; default behavior of `select count(*) from plan_rows` includes exceptions.

**How to avoid:** Every dashboard query helper that touches `plan_rows` must filter `source = 'plan-upload'`. Codify this in `lib/db/dashboard.ts` as a constant predicate `PLAN_UPLOAD_ONLY` reused across helpers.

**Warning signs:** % executed creeps down after a single off-plan exception is added.

### Pitfall 4: Off-by-one between `% executed` and `% cancelled` denominators

**What goes wrong:** `% executed = done / (planned - cancelled)` (D-03) but `% cancelled = cancelled / planned` (D-04). These have **different denominators** intentionally. A code reviewer or a refactorer can easily "normalize" them and break the spec.

**How to avoid:** `computeCompleteness()` returns both with both denominators explicit in the type. Add a unit test that exercises the asymmetry: `{planned: 10, executed: 6, cancelled: 2}` → `pctExecuted = 6/8 = 0.75`, `pctCancelled = 2/10 = 0.20`.

### Pitfall 5: Race between dashboard read and grid write

**What goes wrong:** A user saves an edit in the grid, switches to the dashboard, and the numbers don't yet reflect the save (RSC caches the page in Next.js Data Cache).

**Why it happens:** `export const dynamic = "force-dynamic"` is set per page, but `fetch` deduping or React `cache()` may still serve stale data within a single request graph.

**How to avoid:** Set `dynamic = "force-dynamic"` on the dashboard page (matches `app/(app)/actuals/page.tsx:14`). Add a small "Refresh" button (D-CONTEXT specified manual refresh is welcome) that calls a Server Action to invalidate (`revalidatePath('/dashboard')`).

**Warning signs:** User saves a Done status, dashboard still shows it as Pending until manual reload.

### Pitfall 6: Recharts + React 19 install friction

**What goes wrong:** Recharts depends on `react-is`, which historically lagged React 19 compat. Install can fail with peer-dep warnings.

**Why it happens:** Documented in [Recharts issue #4558](https://github.com/recharts/recharts/issues/4558).

**How to avoid:** Add `"overrides": { "react-is": "$react" }` to `package.json` before `npm install recharts`. Verify with a smoke import in a `"use client"` component.

**Warning signs:** `npm install` warning about `react-is` peer; runtime "Invalid hook call" or "Cannot read property of undefined" in chart island.

### Pitfall 7: Postgres `date_trunc('week', ...)` is Monday-start; user may expect Sunday-start

**What goes wrong:** Indian business week convention is sometimes Mon-Sun, sometimes Sun-Sat. `date_trunc('week', ...)` is **ISO Monday-start**, unconditional. Charts may shift by a day vs a hand-counted Excel pivot.

**How to avoid:** Lock the week definition as **ISO (Monday-start)** in the SUMMARY and on the chart axis label ("Week of YYYY-MM-DD, Mon"). If the team objects after seeing v1, escalate as a CONTEXT amendment, not a quiet code change.

### Pitfall 8: Drizzle returns `numeric` as STRING, not number

**What goes wrong:** `plannedCost` arrives as `"125000.00"` not `125000`. Direct use in arithmetic produces NaN or string concatenation bugs.

**How to avoid:** Mirror the existing pattern in `lib/db/plan-rows.ts:94-98` and `lib/db/executions.ts:248-258` — coerce via `Number(row.plannedCost)` at the query helper return-boundary. Document the convention in `lib/db/dashboard.ts` header comment.

## Code Examples

### Stat strip card (RSC)

```tsx
// app/(app)/dashboard/stat-strip.tsx
// Source pattern: app/(app)/actuals/page.tsx lines 172-189 (existing stat display)
import { computeCompleteness } from "@/lib/compliance/completeness";
import type { ScopeTotals } from "@/lib/db/dashboard";

export function StatStrip({ totals }: { totals: ScopeTotals }) {
  const { pctExecuted, pctCancelled } = computeCompleteness(totals);
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <dl className="grid grid-cols-2 gap-3 md:grid-cols-6">
      <Stat label="% Executed" value={pct(pctExecuted)} />
      <Stat label="% Cancelled" value={pct(pctCancelled)} />
      <Stat label="Planned units" value={totals.plannedUnits} />
      <Stat label="Done" value={totals.executedUnits} />
      <Stat label="Cancelled" value={totals.cancelledUnits} />
      <Stat label="Pending + WIP" value={totals.pendingUnits + totals.inProgressUnits} />
      <Stat label="Planned ₹" value={fmt.format(totals.plannedCost)} />
      <Stat label="Actual ₹" value={fmt.format(totals.actualCost)} />
    </dl>
  );
}
```

### Weekly trend client island

```tsx
// app/(app)/dashboard/weekly-trend-chart.tsx
"use client";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export type WeekBucket = { weekStart: string; executed: number; cancelled: number; pending: number };

export function WeeklyTrendChart({ buckets }: { buckets: WeekBucket[] }) {
  return (
    <div className="h-72 w-full" data-slot="weekly-trend-chart">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={buckets}>
          <XAxis dataKey="weekStart" />
          <YAxis allowDecimals={false} />
          <Tooltip />
          <Legend />
          <Area type="monotone" dataKey="executed" stackId="1" />
          <Area type="monotone" dataKey="pending"  stackId="1" />
          <Area type="monotone" dataKey="cancelled" stackId="1" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `case when ... then 1 else 0 end` + `sum(...)` for conditional counts | `count(*) filter (where ...)` (SQL:2003) | Available in Postgres 9.4+ (2014); universally supported now | Cleaner, faster, native Drizzle support via `sql<number>` template |
| Hand-roll responsive chart sizing with media queries | Recharts `<ResponsiveContainer>` | Standard pattern since Recharts 2.x | Zero-config responsive |
| ARIA `role="treegrid"` with full arrow-key nav for read-only tree | Native `<details>`/`<summary>` for read-only collapsibles | Always available; chosen here for v1 simplicity | Native focus, no JS for toggle, screen-reader-friendly. v2 can upgrade to treegrid if drill metrics become editable. |

**Deprecated/outdated:**
- Glide Data Grid (already excluded in CLAUDE.md for React 19 incompatibility) — not relevant to dashboard.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recharts 3.x is the latest stable on npm and works with React 19 with the `react-is` override | Standard Stack | Need to fall back to visx or raw SVG; chart code rewrite |
| A2 | `executionDate` is stored in `executions.fields` jsonb, not as a top-level column | Pitfall 1 | If it's a real column, the SQL simplifies (no `->>'executionDate'::date` cast) — net positive |
| A3 | The new `plan_rows.source` column from Phase 3.1 migration 0002 will be live before Phase 4 implementation starts (`source` is on `PlanRowRecord` already per recent commit `a6b89e0`) | Pitfall 3 | If Phase 3.1 slips, Phase 4 must hold or include a stub `source='plan-upload'` default everywhere |
| A4 | `STATUS_VALUES` / `TERMINAL_STATUSES` constants referenced in CONTEXT.md D-03 do **NOT** exist in the codebase at HEAD — grep across `lib/activities/*` finds zero matches; status enumValues are inlined per-activity config | Pitfall 4 / Code Examples | Planner should treat the cancellation-cohort constants as **needing to be introduced** in `lib/activities/status.ts` (or `lib/compliance/status.ts`) as part of Phase 4 OR as a Phase-3.1 leftover. **This is the single biggest "is the assumption from CONTEXT actually grounded?" finding.** |
| A5 | Indian week convention should match ISO (Mon-start) | Pitfall 7 | User may want Sun-start; visible mismatch on charts |
| A6 | `app/(app)/dashboard/page.tsx` is the right route placement and matches existing `(app)` group conventions | Architectural Map | Trivial to move |
| A7 | The `Cancelled` status value is the literal string `'Cancelled'` (capital C) — assumed from CONTEXT D-03's reference to `TERMINAL_STATUSES` and from `enumValues: ["Pending", "In Progress", "Done"]` in counter-wall.ts NOT containing `'Cancelled'`. Phase 3.1 adds Cancelled to the registry. | Several queries | Wrong casing = silent zero. Verify the exact registry literal once Phase 3.1 lands. |
| A8 | Recharts npm `[ASSUMED]` legitimacy — package is well-known but slopcheck wasn't run in this session | Package Legitimacy Audit | Procedural; the package is real and widely used |

## Open Questions

1. **Where does the shared `% executed` helper live? — RECOMMEND: `lib/compliance/completeness.ts`**
   - What we know: CONTEXT D-05 lists two options (`lib/dashboard/completeness.ts` vs extending `lib/actuals/`).
   - What's unclear: nothing — both are viable. The choice is about naming.
   - Recommendation: **`lib/compliance/`** (new top-level folder). Reasons: (a) "compliance" matches the requirement family name (COMP-03), (b) `lib/dashboard/` would be misleading because the same helper is called from the grid and from Phase-5 export — not just the dashboard, (c) `lib/actuals/` is grid-scoped and would couple the helper to grid lifecycle. Mirrors `lib/excel/`, `lib/auth/`, `lib/db/` precedent of feature-named lib folders.

2. **Chart library — RECOMMEND: Recharts 3.x with `react-is` override**
   - Survey: Recharts (most popular, ~3M weekly downloads, [Recharts npm](https://www.npmjs.com/package/recharts)), visx (lower-level, more code), raw SVG (zero dep, most code).
   - React 19 status: works with the `react-is` peer-dep override (documented in [Recharts issue #4558](https://github.com/recharts/recharts/issues/4558) and [LogRocket 2026 review](https://blog.logrocket.com/best-react-chart-libraries-2026/)).
   - Pick: Recharts — least code for stacked area + line + tooltip + responsive container, well-documented, ergonomic React API. Bundle weight (~95kB gzipped) acceptable for a 2-chart dashboard.

3. **SQL aggregation strategy — RECOMMEND: N small queries via `Promise.all`**
   - Codebase pattern: `app/(app)/actuals/page.tsx:67-71` already does parallel `Promise.all` of three queries. No materialized-view tooling installed. Drizzle has no built-in cross-query batcher.
   - Pick: N small, focused queries. Each helper in `lib/db/dashboard.ts` does one `GROUP BY`. The page composes via `Promise.all`. Single big query would CROSS-JOIN noisy and lose readability; materialized view is premature.

4. **Planned baseline for trend chart — RECOMMEND: option (c) — skip planned series in trend**
   - CONTEXT lists three options. Skipping is the simplest honest representation: plan rows have no `planned_date` column, so distributing planned units across weeks is a fabrication (a flat `total / N_weeks` line implies a planning cadence that doesn't exist in the data). The stat cards already show planned-vs-actual at period level. Keep the trend honest: executed (Done), in-progress, cancelled — that's what was actually recorded. **Document the choice prominently in the plan and on the chart caption** ("Trend shows recorded executions only; period totals in cards above").

5. **ARIA treegrid pattern — RECOMMEND: native `<details>` / `<summary>`**
   - shadcn/ui has Accordion (Radix substrate); Radix has no Treegrid primitive.
   - For a read-only 4-level drill with no inline edit, `<details>`/`<summary>` gives: native Enter/Space toggle, native focus indicators, screen-reader semantics (browsers announce "expanded"/"collapsed"), zero JS for toggle behavior, zero new dependency.
   - When to upgrade: if v2 introduces inline edit of drill rows OR keyboard arrow-key navigation between siblings becomes a request, swap to `role="treegrid"`. v1 doesn't need it.

6. **Week bucketing in SQL — LOCK: ISO week (Monday-start) via `date_trunc('week', ts)`**
   - Verified: Postgres `date_trunc('week', ts)` returns the Monday 00:00 of the ISO week. Universal across Postgres 9+, PGlite-compatible.
   - Lock this convention in the chart axis labels ("Week of YYYY-MM-DD") and document in the plan.

7. **Route placement — RECOMMEND: `app/(app)/dashboard/page.tsx`**
   - Verified vs current app router structure (`app/(app)/{actuals,plans,periods,items}/page.tsx`). Matches convention. Add `{ href: "/dashboard", label: "Dashboard" }` to `app/(app)/nav-links.tsx:6-11`. **Consider making it the first nav link** (or the `/` landing) since CONTEXT D-13 and DASH-01 specify "on login user sees the dashboard."
   - Migration to landing: currently `app/(app)/page.tsx` is a "Foundation ready" placeholder. Phase 4 could either (a) keep `/dashboard` as a separate route OR (b) replace `app/(app)/page.tsx` content with the dashboard. **Planner picks; recommendation is (a) with a `redirect("/dashboard")` from `page.tsx`** — keeps the dashboard logic encapsulated in its own folder.

8. **Existing aggregate code — VERIFIED: one helper exists, no other shapes to reuse**
   - `lib/db/plan-rows.ts:85-99` has `countByPeriodActivity()` — counts plan rows grouped by (period, activity). Used by `/plans` overview. Not reusable directly for Phase 4 (different shape, no status grouping, no cost) but **its pattern is the template** for Phase 4's aggregators: typed return shape, `sql<number>\`count(...)::int\``, normalized via `Number()` at boundary.
   - No other aggregate helpers in `lib/db/*`. Phase 4 introduces `lib/db/dashboard.ts` as the new home for all dashboard aggregators.

9. **Risk register — TOP FAILURE MODES**

| # | Risk | Mitigation |
|---|------|------------|
| R1 | **`TERMINAL_STATUSES` / `Cancelled` literal undefined in codebase** (A4/A7) — Phase 4 SQL hardcodes `'Cancelled'` strings, but the registry doesn't yet contain this value. | Verify in Phase 3.1 SUMMARY that `Cancelled` lands in `enumValues`. If not, Phase 4 plan must include a small registry edit task. |
| R2 | **Exception rows leak into main metrics** (Pitfall 3) | Every dashboard query helper filters `source = 'plan-upload'`; add a unit test asserting an inserted exception row doesn't move % executed. |
| R3 | **Dashboard reads stale data after grid write** (Pitfall 5) | `force-dynamic`, manual refresh button, document the eventual-consistency contract. |
| R4 | **Off-by-one in proportional %** (Pitfall 4 + D-03/D-04 asymmetry) | Unit-test `computeCompleteness` with the spec example `{planned: 10, executed: 6, cancelled: 2}` → `0.75 / 0.20`. |
| R5 | **`period_id` accidentally omitted in a helper** (Phase 1 invariant) | Codify a `PERIOD_SCOPED` predicate at the top of `lib/db/dashboard.ts`; every helper composes from it. |
| R6 | **Chart bundle weight bloats first paint** | Recharts is in a `"use client"` island that doesn't ship on the server-rendered shell; only paints after hydration. Acceptable. If it becomes a problem, lazy-load via `next/dynamic` with `ssr: false`. |
| R7 | **`Cancelled` double-counted** if status filter logic forgets to subtract from denominator | Single helper, single test (R4 covers). |
| R8 | **`executionDate` jsonb access syntax differs from PGlite to node-postgres** | Both support `fields->>'executionDate'` standard syntax. Smoke-test on PGlite during Wave 0; full suite on node-postgres in CI. |
| R9 | **Recharts install fails in CI** due to peer-dep | Pin override in `package.json` before install; gate the install task with a verify checkpoint. |
| R10 | **Status filter accidentally applied to dashboard** (D-17 explicitly excludes it) | Dashboard FilterBar wrapper omits the `status` facet; reuse the existing FilterBar component with a `hideFacets={['status']}` prop OR a dashboard-specific dropdown set. |
| R11 | **`numeric` columns silently treated as JS number** (Pitfall 8) | Boundary-coerce pattern from `lib/db/executions.ts:248-258`; ESLint rule could enforce but not necessary for v1. |

## Environment Availability

> Read-only feature; no new runtime dependencies beyond the npm package install.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PostgreSQL `date_trunc` | DASH-06 week bucketing | ✓ | PGlite + node-postgres both support | — |
| Postgres `filter (where ...)` syntax | All status-conditioned counts | ✓ | Standard SQL since PG 9.4 | `case when ... then 1 else 0 end` (uglier but equivalent) |
| Postgres `->>` jsonb operator | `executionDate` access | ✓ | Used elsewhere in codebase | — |
| Recharts npm package | DASH-06 chart | ✗ (not installed) | 3.x available | Raw SVG (~200 LoC per chart) |

**Missing dependencies with no fallback:** none
**Missing dependencies with fallback:** Recharts (fallback: raw SVG, only if install fails)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (unit) + Playwright 1.60 (e2e) |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test` (full unit suite via `vitest run`) |
| Full suite command | `npm test && npm run e2e` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COMP-03 | `computeCompleteness({planned:10, executed:6, cancelled:2}) → {pctExecuted:0.75, pctCancelled:0.20}` | unit | `vitest run lib/compliance/completeness.test.ts` | ❌ Wave 0 |
| DASH-01 | `/dashboard` renders stat strip with non-zero values when period has executions | e2e | `playwright test e2e/dashboard.spec.ts` | ❌ Wave 0 |
| DASH-02 | By-activity card shows one row per activity with executions; by-region card shows one per region | unit + e2e | `vitest run lib/db/dashboard.test.ts` | ❌ Wave 0 |
| DASH-03 | Planned ₹ vs actual ₹ matches sum of `plan_rows.planned_cost` vs sum of non-cancelled `executions.total_cost` | unit | `vitest run lib/db/dashboard.test.ts` | ❌ Wave 0 |
| DASH-04 | Setting `?region=North` reduces stat-strip counts to that region's slice | e2e | `playwright test` | ❌ Wave 0 |
| DASH-05 | Cancelled card surfaces; cancelled rows do not move `% executed` numerator OR denominator | unit | `vitest run lib/compliance/completeness.test.ts` | ❌ Wave 0 |
| DASH-06 | Weekly buckets returned in ISO Monday-start; rolling-N=8 returns 8 buckets | unit | `vitest run lib/db/dashboard.test.ts` | ❌ Wave 0 |
| DASH-07 | Drill tree from Zone → Taluka expands and metrics aggregate correctly at each level | e2e | `playwright test` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` for the touched module
- **Per wave merge:** full `npm test`
- **Phase gate:** full `npm test && npm run e2e` green

### Wave 0 Gaps
- [ ] `lib/compliance/completeness.test.ts` — covers COMP-03, DASH-05 math
- [ ] `lib/db/dashboard.test.ts` — covers DASH-02, DASH-03, DASH-06 SQL helpers (PGlite-backed)
- [ ] `e2e/dashboard.spec.ts` — covers DASH-01, DASH-04, DASH-07 end-to-end
- [ ] No framework install needed (Vitest + Playwright already configured)

## Project Constraints (from CLAUDE.md)

These directives are treated with the same authority as locked CONTEXT decisions.

- **Tech stack invariants:** Next 16.2.7 / React 19.2.7 / Vercel Fluid / Neon Postgres / Drizzle 0.45 / AG Grid Community / Tailwind 4 / shadcn/ui / Server Actions for mutations. Phase 4 has no mutations.
- **DO NOT suggest new heavy dependencies without strong justification.** → Recharts is the *one* new dep, justified by ~300 LoC savings per chart and React 19 compat verified. No others added.
- **Server-side aggregation only — never load all rows client-side.** → All `GROUP BY` runs in Postgres via Drizzle.
- **All money is integer paise / numeric — no float coercion.** → `numeric` columns coerced to `number` only at the query helper return boundary (matches existing `plan-rows.ts:94-98` pattern).
- **GSD Workflow Enforcement (user CLAUDE.md):** All file changes go through a GSD command; Phase 4 work flows through `/gsd-execute-phase`.
- **No SheetJS / Excel work in Phase 4** — Phase 5 owns export.

## Sources

### Primary (HIGH confidence)
- Codebase files read in full: `lib/db/plan-rows.ts`, `lib/db/executions.ts`, `lib/db/schema.ts`, `lib/actuals/filter.ts`, `lib/activities/types.ts`, `lib/activities/registry.ts`, `lib/activities/counter-wall.ts`, `app/(app)/actuals/page.tsx`, `app/(app)/actuals/filter-bar.tsx`, `app/(app)/layout.tsx`, `app/(app)/nav-links.tsx`, `package.json` — all checked against HEAD on `master`
- `.planning/phases/04-compliance-dashboard/04-CONTEXT.md` — locked decisions
- `.planning/phases/03_1-actuals-grid-refinements/03_1-CONTEXT.md` — exception row + status backfill context
- `.planning/phases/01-foundation/01-CONTEXT.md` — period scoping + multi-unit grain
- `.planning/REQUIREMENTS.md` — requirement IDs verified
- `.planning/ROADMAP.md` — phase goal + success criteria verified
- `./CLAUDE.md` — stack invariants

### Secondary (MEDIUM confidence)
- [Recharts npm page](https://www.npmjs.com/package/recharts) — version + downloads
- [Recharts issue #4558 — Support React 19](https://github.com/recharts/recharts/issues/4558) — React 19 `react-is` override
- [Best React chart libraries in 2026 — LogRocket](https://blog.logrocket.com/best-react-chart-libraries-2026/) — chart library survey, updated June 2026
- [shadcn/ui Next.js 15 + React 19 docs](https://ui.shadcn.com/docs/react-19) — peer-dep override pattern for React 19

### Tertiary (LOW confidence — verify before relying)
- None — every claim above is grounded in either a codebase read or an authoritative source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against `package.json`; Recharts versions/compat verified via npm + Recharts repo
- Architecture: HIGH — patterns mirror existing `lib/db/*` and `app/(app)/*` conventions
- Pitfalls: HIGH — derived from reading actual schema (`executionDate` in jsonb), existing helpers (numeric → string), Phase 3.1 migration plan (source column), and locked decisions (D-03/D-04 asymmetry)
- Chart library: MEDIUM — Recharts works, but the React 19 peer-dep workaround is empirical and may evolve
- Status enum / Cancelled literal: LOW-MEDIUM — A4 risk: `TERMINAL_STATUSES` referenced in CONTEXT does not exist in codebase at HEAD; the `Cancelled` literal isn't in `counter-wall.ts` enumValues. Phase 3.1 is expected to add it but is unfinished. Planner must verify on Phase 3.1 completion.

**Research date:** 2026-06-08
**Valid until:** 2026-07-08 (30 days; stable stack, no fast-moving dependencies)

---

## RESEARCH COMPLETE

Phase 4 is a composition of existing primitives — period-scoped Drizzle aggregates in a new `lib/db/dashboard.ts`, a shared `lib/compliance/completeness.ts` math helper, an RSC at `app/(app)/dashboard/page.tsx`, and one new dependency (Recharts 3.x with a `react-is` override) for the weekly trend chart.

Sources:
- [Recharts on npm](https://www.npmjs.com/package/recharts)
- [Recharts React 19 support issue #4558](https://github.com/recharts/recharts/issues/4558)
- [Best React chart libraries in 2026 — LogRocket Blog](https://blog.logrocket.com/best-react-chart-libraries-2026/)
- [shadcn/ui Next.js 15 + React 19](https://ui.shadcn.com/docs/react-19)
