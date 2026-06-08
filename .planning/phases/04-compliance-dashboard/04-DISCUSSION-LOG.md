# Phase 4: Compliance & Dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-08
**Phase:** 4-compliance-dashboard
**Areas discussed:** % executed math, Exception rows in dashboard, Drill-down shape
**Areas skipped (Claude's discretion):** Week-wise trend UX

---

## % Executed Math

### Q1 — Partial / multi-unit completeness

| Option | Description | Selected |
|--------|-------------|----------|
| Proportional (units-based) | `sum(executed_units) / sum(planned_units)`. A 5-wall plan with 2 Done walls = 2/5. | ✓ |
| Binary (row-based) | `% = fully-done plan rows / all plan rows`. Same example = 0. | |
| Two metrics, both shown | Show both proportional and binary as separate cards. | |

**User's choice:** Proportional (units-based)
**Notes:** Honors the multi-unit plan-row grain locked in Phase 1; rewards partial progress; gives an honest signal of how much actual work has landed.

### Q2 — Cancelled treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Excluded from denominator | Cancelled units removed from both num and denom — "doesn't count". | |
| In denominator, not numerator | Cancelled stays in planned; % drops when work is cancelled. | |
| Separate ratio shown alongside | % executed excludes cancelled; an additional "% cancelled" stat shown next to it. | ✓ |

**User's choice:** Separate ratio shown alongside
**Notes:** Most transparent. % executed stays clean (consistent with `TERMINAL_STATUSES` treatment in the grid), and a parallel "% cancelled" makes plan abandonment visible at a glance.

---

## Exception Rows in Dashboard

### Q3 — Where exception rows appear

| Option | Description | Selected |
|--------|-------------|----------|
| Parallel "exception spend" bucket | Main % executed and Zone totals count plan-uploaded rows only; exceptions get their own count + ₹ card. | ✓ |
| Folded into Zone totals | Exception rows count like plan-uploaded rows everywhere. | |
| Both views, toggleable | A "Include exceptions: on/off" toggle switches all cards/breakdowns. | |

**User's choice:** Parallel "exception spend" bucket
**Notes:** Keeps the headline compliance metric honest (only plan-uploaded work counts toward "% of plan executed"), while surfacing exception leakage as its own first-class number on the same dashboard.

---

## Drill-down Shape

### Q4 — Drill-down navigation

| Option | Description | Selected |
|--------|-------------|----------|
| Single page, collapsible tree | All Zones listed; click to expand States → Districts → Talukas inline. | ✓ |
| Router-pushed breadcrumb pages | One route per level with breadcrumbs. | |
| Master-detail (table + side panel) | Left: Zone table; right panel deepens on click. | |

**User's choice:** Single page, collapsible tree
**Notes:** Fast scanning, easy sibling comparison at every depth, one URL. Cascade utility in `lib/actuals/filter.ts` maps directly onto the tree walk — no new traversal code.

### Q5 — Drill row primary metric

| Option | Description | Selected |
|--------|-------------|----------|
| Show all three per row | Planned / executed / cancelled counts AND planned-vs-actual ₹ in a compact cell layout; sortable by any column. | ✓ |
| % executed first, counts on hover | Primary visual is the % bar; raw numbers behind hover/click. | |
| Expense-first (₹) | Spend numbers primary; counts secondary. | |

**User's choice:** Show all three per row
**Notes:** Matches success criterion #7 verbatim. Avoids hiding numbers behind interactions; sortable columns let either the count-watcher or the budget-owner lead with the metric they care about.

---

## Claude's Discretion

- **Week-wise trend UX** — user skipped this area in the gray-areas selection. Defaults locked in CONTEXT.md (D-13 through D-16): main dashboard placement, stacked line/area chart of counter counts, rolling default N = 8 (toggle 4 / 8 / 12), parallel ₹ chart for planned vs actual spend per week.
- Chart library choice (Recharts vs visx vs raw SVG) — pick lightest viable for React 19 / Next 16.
- SQL aggregation strategy — single big query vs multiple smaller; prefer clarity over premature optimization.
- Exact stat-card layout, visual treatment, motion, shadcn/ui component picks — within the existing design system and JSW brand accent.

## Deferred Ideas

- **Exception rows inside the drill-down tree** — for v1 they live only in the Exception spend card. A v2 enhancement could let users explore exceptions down to Taluka (toggle on the tree, or a separate exception-drill route).
- **Period-over-period comparison on the dashboard** — already deferred to v2 (RPT-01).
- **Saved / shareable dashboard filter views** — v2 (RPT-02).
- **CSV / PNG export of the dashboard itself** — out of scope; Phase 5 export covers the grid only.
- **Dashboard polling / real-time refresh** — eventual consistency is fine for v1; a manual refresh button is the most we'd add.
- **Per-user drill-metric customization** — defaulting to "all three per row" for v1; user-configurable column emphasis is v2.

## Open Question Passed to the Planner (non-blocking)

- **Planned baseline in the week-wise trend chart** — plan rows don't have a "planned week" column. The planner should pick one of: (a) flat planned line at `total_planned_units / N_weeks_in_period`, (b) planned shown only as a period-total reference line, (c) drop the planned series from the trend and keep planned only in the stat cards. Document the choice in PLAN.md.
