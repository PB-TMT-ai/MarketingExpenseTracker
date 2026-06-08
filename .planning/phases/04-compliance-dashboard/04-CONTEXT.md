# Phase 4: Compliance & Dashboard - Context

**Gathered:** 2026-06-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver the headline compliance & spend dashboard for the active period: planned / executed / cancelled / pending counter counts, planned vs actual ₹, week-wise trend (period + rolling), and a Zone → State → District → Taluka drill-down. All numbers honor the active filters and share **one** authoritative `% executed` calc path with the grid (and, in Phase 5, export). No new write paths — read-only aggregates over `plan_rows` + `executions`.

Covers requirements: **COMP-03, DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07**.

</domain>

<decisions>
## Implementation Decisions

### % Executed Math
- **D-01:** `% executed` is **proportional / units-based**: `sum(executed_units across plan rows in scope) / sum(planned_units across plan rows in scope)`. A 5-wall plan with 2 Done walls contributes 2/5 — not 0, not 1. Honors the multi-unit plan-row grain locked in Phase 1.
- **D-02:** "Executed" for the numerator = executions with `status = 'Done'`. `In Progress` and `Pending` do NOT count toward executed (they show in their own counters).
- **D-03:** **Cancelled is excluded from both numerator and denominator** of `% executed` (consistent with `TERMINAL_STATUSES` treatment in `lib/activities/status.ts`). A cancelled unit "doesn't count" — neither as work done nor as work owed.
- **D-04:** A separate **`% cancelled`** stat is shown alongside `% executed`, computed against the **original** planned units (i.e. denominator includes the cancelled units). This is the only place cancelled units appear in a denominator — so the user can see "what fraction of the plan was abandoned" at a glance.
- **D-05:** The completeness calc is implemented **once**, in a shared helper (e.g. `lib/dashboard/completeness.ts` or extension of `lib/actuals/`), and is called by the dashboard, the grid stat strip, and the future export. Single source of truth — grid, dashboard, and export must never disagree (success criterion #4).

### Exception Rows in Dashboard
- **D-06:** Off-plan exception rows (`plan_rows.source = 'exception'` from Phase 3.1 / COMP-04) are **excluded** from the main `% executed`, Zone breakdowns, and all primary stat cards. The headline compliance metric reflects only plan-uploaded rows — keeps "% of plan executed" honest.
- **D-07:** Exception spend gets its own **parallel "Exception spend" card**: count of exception executions + total ₹ for the active period (and filtered scope). Visible on the main dashboard so leakage is never hidden.
- **D-08:** Drill-down (Zone → Taluka) shows plan-uploaded rows only by default. (Whether exception rows are explorable in the drill-down at all is a v2 question — for v1 they live solely in the Exception spend card. Documented as deferred.)

### Drill-down Shape
- **D-09:** **Single-page collapsible tree.** Top level lists all Zones (`plan_rows.region` distinct values in the active period + filter scope). Click a Zone row to expand States below it; State → Districts; District → Talukas. Same URL, ARIA-treegrid pattern, smooth UX for scanning siblings at any depth.
- **D-10:** **Each tree row shows all three metrics** in a compact cell layout: planned / executed / cancelled counter counts AND planned-vs-actual ₹. Sortable by any column. Matches success criterion #7 verbatim.
- **D-11:** The cascade utility in `lib/actuals/filter.ts` (the same one powering the grid's Region → State → District → Distributor filter) is **reused** for the drill-down hierarchy walk. No new cascade code.
- **D-12:** Drill-down honors the active period and any global filters (Region / State / Distributor) currently applied via the existing FilterBar — i.e. a user who has filtered to a single Zone in the filter bar sees the tree rooted at that Zone.

### Week-wise Trend (Claude's discretion — defaults locked)
- **D-13:** Week-wise trend chart lives on the **main dashboard** (not a drawer or secondary tab) as a primary visual below the stat cards.
- **D-14:** Default visualization: **stacked line/area chart** of planned vs executed vs cancelled **counter counts** per ISO week, bucketed by `executions.executionDate` (with planned baseline distributed across the period — see open question below for the planner if non-trivial).
- **D-15:** Default rolling window for the standalone "recent N weeks" view: **N = 8**. Selectable from a small toggle (4 / 8 / 12). The rolling view is period-independent — it shows the last N ISO weeks ending today regardless of which period is active.
- **D-16:** A second chart (or toggle) shows planned ₹ vs actual ₹ per week using the same bucket. Same chart family; consistent palette.

### Filter & Period Honoring
- **D-17:** Every dashboard card, chart, and tree row obeys: (a) the active period, (b) the global FilterBar selection (Region / State / Distributor — Status filter does NOT apply to the dashboard since the dashboard *shows* status breakdowns). Activity filter (if any) likewise applies. Same query helpers as the grid where possible.

### Claude's Discretion
- Exact stat-card layout, visual treatment, motion, and shadcn/ui components are Claude's discretion within the existing design system (consistent with Phase 3 grid styling and the JSW brand accent from the design-pass rounds).
- Chart library choice (Recharts vs visx vs raw SVG) is Claude's discretion — pick the lightest viable option compatible with React 19 / Next 16. No new server-side chart dependency.
- SQL aggregation strategy (single big query vs multiple smaller queries vs materialized helper) is Claude's discretion. Prefer correctness + clarity over premature optimization; revisit only if a real dataset shows perceptible lag.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Roadmap & Requirements
- `.planning/ROADMAP.md` §"Phase 4: Compliance & Dashboard" — goal, success criteria, dependencies
- `.planning/REQUIREMENTS.md` §Compliance + §Dashboard — COMP-03, DASH-01 through DASH-07 definitions
- `.planning/PROJECT.md` — core value (headline compliance metric), constraints, scope guardrails

### Prior phase context (read for inherited decisions)
- `.planning/phases/01-foundation/01-CONTEXT.md` — period-scoping, multi-unit plan-row grain, money columns
- `.planning/phases/03-actuals-grid/03-CONTEXT.md` — filter cascade pattern, status enum, save-bar pattern
- `.planning/phases/03_1-actuals-grid-refinements/` — exception-row marker (`plan_rows.source = 'exception'`), Cancelled status, status backfill (read whatever CONTEXT.md exists once Phase 3.1 lands)

### Reusable code (full paths)
- `lib/actuals/filter.ts` — cascade utility (Region → State → District → Distributor / Taluka); reused for drill-down hierarchy walk
- `lib/activities/status.ts` — status enum + `TERMINAL_STATUSES` (`Done`, `Cancelled`); single source of truth for status classification
- `lib/activities/` (registry) — per-activity column definitions, used to break down execution/spend by activity (DASH-02)
- `db/schema/plan_rows.ts` and `db/schema/executions.ts` — the data the dashboard aggregates over; `source` column lands in Phase 3.1
- Existing FilterBar component (from Phase 3) — the dashboard must consume the same filter state

### Notes
- No external ADRs or specs beyond ROADMAP/REQUIREMENTS — Phase 4 is a read-only aggregate layer over existing schema and existing utilities. All decisions are captured in this CONTEXT.md.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/actuals/filter.ts` — cascade traversal already used by the grid's FilterBar; the same shape (parent-key → child-keys map) is exactly what the drill-down tree needs. **Do not re-implement.**
- `lib/activities/status.ts` `TERMINAL_STATUSES` — already classifies `Done` and `Cancelled` as terminal; reuse to decide what counts toward executed vs cancelled vs pending.
- Activity registry (`lib/activities/*`) — has the per-activity column types (measurement / item-list / status) needed for the by-activity breakdown (DASH-02).
- FilterBar (Phase 3) + Active Period context — already drive the grid; the dashboard plugs into the same state, no new global state needed.
- `executions.executionDate` column — primary key for week bucketing (DASH-06). ISO-week truncation can be done in SQL (`date_trunc('week', execution_date)`).

### Established Patterns
- **Period scoping is structural** — every aggregate query must join on `period_id`. Don't query without it.
- **Server-side aggregation** — match the grid's pattern: aggregates run as Server Actions / RSC fetches, never client-computed across the full row set.
- **Money is integer paise (or numeric, never float)** — established Phase 1 convention. The dashboard's ₹ totals must use the same column types, no coercion drift.
- **Optimistic-concurrency / version columns** on executions — read-only here, but be aware that a dashboard read can race a grid write; eventual consistency is fine for v1 (no SWR/polling required, but a manual "refresh" affordance is welcome).

### Integration Points
- **One shared `% executed` helper** — extracted (or moved) into a `lib/compliance/` (or `lib/dashboard/`) module that the grid, dashboard, and Phase 5 export all import. This is success criterion #4.
- **New route group** — `app/(authed)/dashboard/page.tsx` (or similar; pick a path consistent with existing routes). RSC for the heavy aggregates; small client component for the tree-expand interactions and the rolling-N toggle.
- **No DB migration is required** for Phase 4 itself — all needed columns exist (or land in Phase 3.1: `plan_rows.source`).

</code_context>

<specifics>
## Specific Ideas

- User specifically asked for: planned / executed / cancelled counter counts (week-wise), planned vs actual expense, and Zone / State / District / Taluka views. All three are now first-class success criteria.
- Zone == `plan_rows.region` (no schema migration, no new column).
- Match the existing JSW brand accent and Phase-3 grid styling — consistent visual language.

</specifics>

<deferred>
## Deferred Ideas

- **Exception rows inside the drill-down tree** — for v1, exception spend lives only in its own card. Letting users explore exceptions down to Taluka is a v2 enhancement (toggle on the tree, or a separate exception-drill route).
- **Period-over-period comparison on the dashboard** — already deferred to v2 (RPT-01).
- **Saved / shareable dashboard filter views** — v2 (RPT-02).
- **CSV / PNG export of the dashboard itself** — out of scope; Phase 5 export covers the grid only.
- **Dashboard polling / real-time refresh** — eventual consistency is fine for v1; a manual refresh button is the most we'd add.
- **Drill metric customization** (e.g., let the user choose whether each row leads with % executed vs counts vs ₹) — defaulting to "all three per row" for v1; per-user customization is v2.

### Open question for the planner (not blocking)
- **Distributing the planned baseline across weeks** for the trend chart: plan rows don't have a "planned week" column. Options for the planner to consider — (a) show planned as a flat line at `total_planned_units / N_weeks_in_period`, (b) show planned only as a period-total reference line, (c) skip the planned series in the trend and keep planned only in the stat cards. Pick the simplest honest representation; document the choice in the plan.

</deferred>

---

*Phase: 4-compliance-dashboard*
*Context gathered: 2026-06-08*
