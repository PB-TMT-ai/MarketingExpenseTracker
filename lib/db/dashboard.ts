import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { executions, planRows } from "./schema";

/**
 * Typed read-only aggregate query helpers for the dashboard. NO business rules live
 * here — the off-plan guard (COMP-01) is structural in `executions.plan_row_id`, and
 * the compliance math (D-01..D-04) lives in `lib/compliance/completeness.ts`. This
 * module is a thin typed read-only aggregate surface only.
 *
 * Discipline mirrored from `lib/db/plan-rows.ts:1-17`:
 *   - Helpers take primitive args (`DashboardFilters`) and return typed row shapes.
 *   - NEVER opens its own `db.transaction(...)` — read-only.
 *   - The module-level `PLAN_UPLOAD_ONLY` predicate codifies D-06 (exception rows
 *     are EXCLUDED from every headline metric). `EXCEPTION_ONLY` is its parallel
 *     counterpart used solely by `aggregateExceptionTotals` (D-07).
 *   - The `filter (where status <> 'Cancelled' OR status IS NULL)` discipline on
 *     every cost aggregate codifies Pitfall 2 (cancelled-with-cost rows cannot
 *     double-charge actual spend).
 *   - Numeric boundary-coerce at the return statement of every helper:
 *     `coalesce(sum(...), 0)::text` in SQL + `Number(row.x)` in TS (Pitfall 8).
 *   - Status literals (`'Done'`, `'In Progress'`, `'Pending'`, `'Cancelled'`) are
 *     hardcoded strings per PATTERNS.md ("Status literal — handled by hardcoded
 *     strings"). The 04-01 plan owns the registry; this module owns the SQL.
 */

// ---------------------------------------------------------------------------
// Module-level source predicates — single source of truth for D-06
// ---------------------------------------------------------------------------

/** D-06: every non-exception aggregate filters on this predicate. */
const PLAN_UPLOAD_ONLY = eq(planRows.source, "plan-upload");

/** D-07: `aggregateExceptionTotals` is the ONLY helper that uses this. */
const EXCEPTION_ONLY = eq(planRows.source, "exception");

// ---------------------------------------------------------------------------
// Shared filter shape — every helper accepts this
// ---------------------------------------------------------------------------

/**
 * The seven-field filter shape every dashboard helper accepts.
 *
 * `periodId` is REQUIRED (no helper aggregates across all periods — period scoping
 * is structural per CONTEXT D-17). `activity = null` means "no activity constraint".
 * For the four facet arrays, an EMPTY array means "no constraint" (D-17 filter
 * honoring): `regions.length ? inArray(...) : undefined` and `and(...)` strips the
 * undefined.
 */
export type DashboardFilters = {
  periodId: number;
  activity: string | null;
  regions: string[];
  states: string[];
  districts: string[];
  distributors: string[];
};

/**
 * Build the facet-WHERE expression shared by every helper. The CALLER composes
 * `PLAN_UPLOAD_ONLY` (D-06) or `EXCEPTION_ONLY` (D-07) explicitly so every helper
 * has the source predicate visible at its site — single source of truth for the
 * literal, single point of read for the auditor.
 *
 * - Empty facet arrays become undefined so `and(...)` strips them (D-17).
 * - `activity = null` becomes undefined (the by-activity helper IGNORES this field
 *   and groups by activity instead).
 */
function facetWhere(filters: DashboardFilters) {
  return and(
    eq(planRows.periodId, filters.periodId),
    filters.activity != null ? eq(planRows.activity, filters.activity) : undefined,
    filters.regions.length ? inArray(planRows.region, filters.regions) : undefined,
    filters.states.length ? inArray(planRows.state, filters.states) : undefined,
    filters.districts.length ? inArray(planRows.district, filters.districts) : undefined,
    filters.distributors.length
      ? inArray(planRows.distributor, filters.distributors)
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Return shapes
// ---------------------------------------------------------------------------

/** One-row aggregate feeding the StatStrip (DASH-01, DASH-03, DASH-05). */
export type ScopeTotals = {
  plannedUnits: number;
  executedUnits: number;
  inProgressUnits: number;
  pendingUnits: number;
  cancelledUnits: number;
  plannedCost: number;
  actualCost: number;
  /**
   * Counter / sq ft metrics for the two activities that track them:
   * Counter Wall Painting ("counter-wall") and In-shop Branding ("in-shop").
   * Other activities contribute 0 to these aggregates via a SQL FILTER clause.
   *
   * - plannedCounters: distinct plan_row count where activity in those two.
   * - actualCounters: execution count where status='Done' AND its plan_row activity in those two.
   * - plannedSqft: sum((fields->>'planSqft')::numeric) for plan_rows in those two activities.
   *   In-shop's plan template does NOT carry sqft — so in practice this equals Counter Wall's sum.
   * - actualSqft: sum(executions.total_sqft) where status='Done' AND plan_row activity in those two.
   */
  plannedCounters: number;
  actualCounters: number;
  plannedSqft: number;
  actualSqft: number;
};

/** One row per `plan_rows.activity` in scope. Same numbers as ScopeTotals + activity. */
export type ByActivityRow = ScopeTotals & { activity: string };

/** One row per `plan_rows.region` in scope. NULL region → `"(unassigned)"`. */
export type ByRegionRow = ScopeTotals & { region: string };

/** Flat (region, state, district, taluka) row — the GeoDrillTree island consumes this. */
export type GeoRow = {
  region: string;
  state: string;
  district: string;
  taluka: string;
  plannedUnits: number;
  executedUnits: number;
  cancelledUnits: number;
  plannedCost: number;
  actualCost: number;
};

/** One ISO-week bucket. `weekStart` is the Monday-start ISO date. */
export type WeekBucket = {
  weekStart: string;
  executed: number;
  cancelled: number;
  inProgress: number;
  pending: number;
  actualCost: number;
};

/** D-07: parallel exception-spend card. */
export type ExceptionTotals = {
  exceptionCount: number;
  exceptionCost: number;
};

/** Mode for `aggregateWeeklyBuckets`. */
export type WeeklyMode =
  | { kind: "period"; startDate: string; endDate: string }
  | { kind: "rolling"; weeks: 4 | 8 | 12 };

// ---------------------------------------------------------------------------
// Helper 1 — aggregateScopeTotals (StatStrip feed)
// ---------------------------------------------------------------------------

/**
 * Single-row aggregate over (plan-upload) plan_rows in scope and their executions.
 *
 * - `plannedUnits` = distinct plan_row ids (the plan-row grain is the planned unit).
 * - `executedUnits` = executions with status='Done'.
 * - `inProgressUnits` = executions with status='In Progress'.
 * - `pendingUnits` = executions with status='Pending' OR IS NULL (Phase 3.1
 *   backfill semantics — D3.1-03 left status nullable with no default).
 * - `cancelledUnits` = executions with status='Cancelled'.
 * - `plannedCost` = sum of plan_rows.plannedCost.
 * - `actualCost` = sum of executions.totalCost FILTER (where status <> 'Cancelled'
 *   OR status IS NULL) — Pitfall 2: cancelled-with-cost rows cannot double-charge.
 */
export async function aggregateScopeTotals(
  filters: DashboardFilters,
): Promise<ScopeTotals> {
  const rows = await db
    .select({
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
      plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
      actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filters)));

  const r = rows[0];
  return {
    plannedUnits: Number(r?.plannedUnits ?? 0),
    executedUnits: Number(r?.executedUnits ?? 0),
    inProgressUnits: Number(r?.inProgressUnits ?? 0),
    pendingUnits: Number(r?.pendingUnits ?? 0),
    cancelledUnits: Number(r?.cancelledUnits ?? 0),
    plannedCost: Number(r?.plannedCost ?? 0),
    actualCost: Number(r?.actualCost ?? 0),
    plannedCounters: Number(r?.plannedCounters ?? 0),
    actualCounters: Number(r?.actualCounters ?? 0),
    plannedSqft: Number(r?.plannedSqft ?? 0),
    actualSqft: Number(r?.actualSqft ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Helper 2 — aggregateByActivity (DASH-02 by-activity card)
// ---------------------------------------------------------------------------

/**
 * Group by `plan_rows.activity`. The `filters.activity` field is IGNORED here
 * (this helper exists to BREAK DOWN by activity).
 */
export async function aggregateByActivity(
  filters: DashboardFilters,
): Promise<ByActivityRow[]> {
  const filtersNoActivity: DashboardFilters = { ...filters, activity: null };
  const rows = await db
    .select({
      activity: planRows.activity,
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
      plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
      actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filtersNoActivity)))
    .groupBy(planRows.activity)
    .orderBy(planRows.activity);

  return rows.map((r) => ({
    activity: r.activity,
    plannedUnits: Number(r.plannedUnits ?? 0),
    executedUnits: Number(r.executedUnits ?? 0),
    inProgressUnits: Number(r.inProgressUnits ?? 0),
    pendingUnits: Number(r.pendingUnits ?? 0),
    cancelledUnits: Number(r.cancelledUnits ?? 0),
    plannedCost: Number(r.plannedCost ?? 0),
    actualCost: Number(r.actualCost ?? 0),
    plannedCounters: Number(r.plannedCounters ?? 0),
    actualCounters: Number(r.actualCounters ?? 0),
    plannedSqft: Number(r.plannedSqft ?? 0),
    actualSqft: Number(r.actualSqft ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Helper 3 — aggregateByRegion (DASH-02 by-region card)
// ---------------------------------------------------------------------------

/**
 * Group by `plan_rows.region`. NULL region is COALESCED to `"(unassigned)"`
 * at the TS return boundary so the UI never renders an empty label cell.
 */
export async function aggregateByRegion(
  filters: DashboardFilters,
): Promise<ByRegionRow[]> {
  const rows = await db
    .select({
      region: planRows.region,
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      inProgressUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pendingUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
      plannedCounters: sql<string>`count(distinct ${planRows.id}) filter (where ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      actualCounters: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop'))::int`,
      plannedSqft: sql<string>`coalesce(sum((${planRows.fields}->>'planSqft')::numeric) filter (where ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
      actualSqft: sql<string>`coalesce(sum(${executions.totalSqft}) filter (where ${executions.status} = 'Done' and ${planRows.activity} in ('counter-wall','in-shop')), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filters)))
    .groupBy(planRows.region)
    .orderBy(planRows.region);

  return rows.map((r) => ({
    region: r.region ?? "(unassigned)",
    plannedUnits: Number(r.plannedUnits ?? 0),
    executedUnits: Number(r.executedUnits ?? 0),
    inProgressUnits: Number(r.inProgressUnits ?? 0),
    pendingUnits: Number(r.pendingUnits ?? 0),
    cancelledUnits: Number(r.cancelledUnits ?? 0),
    plannedCost: Number(r.plannedCost ?? 0),
    actualCost: Number(r.actualCost ?? 0),
    plannedCounters: Number(r.plannedCounters ?? 0),
    actualCounters: Number(r.actualCounters ?? 0),
    plannedSqft: Number(r.plannedSqft ?? 0),
    actualSqft: Number(r.actualSqft ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Helper 4 — aggregateByGeo (DASH-07 drill tree feed)
// ---------------------------------------------------------------------------

/**
 * One row per distinct (region, state, district, taluka) tuple in scope.
 * NULL who-where values are coalesced to `"(unassigned)"` at the TS boundary.
 * Order by region, state, district, taluka so the tree builder can walk linearly.
 */
export async function aggregateByGeo(filters: DashboardFilters): Promise<GeoRow[]> {
  const rows = await db
    .select({
      region: planRows.region,
      state: planRows.state,
      district: planRows.district,
      taluka: planRows.taluka,
      plannedUnits: sql<string>`count(distinct ${planRows.id})::int`,
      executedUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      cancelledUnits: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      plannedCost: sql<string>`coalesce(sum(${planRows.plannedCost}), 0)::text`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(PLAN_UPLOAD_ONLY, facetWhere(filters)))
    .groupBy(planRows.region, planRows.state, planRows.district, planRows.taluka)
    .orderBy(planRows.region, planRows.state, planRows.district, planRows.taluka);

  return rows.map((r) => ({
    region: r.region ?? "(unassigned)",
    state: r.state ?? "(unassigned)",
    district: r.district ?? "(unassigned)",
    taluka: r.taluka ?? "(unassigned)",
    plannedUnits: Number(r.plannedUnits ?? 0),
    executedUnits: Number(r.executedUnits ?? 0),
    cancelledUnits: Number(r.cancelledUnits ?? 0),
    plannedCost: Number(r.plannedCost ?? 0),
    actualCost: Number(r.actualCost ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Helper 5 — aggregateWeeklyBuckets (DASH-06)
// ---------------------------------------------------------------------------

/**
 * ISO Monday-start week buckets keyed on `(executions.fields->>'executionDate')::date`.
 *
 * - `mode.kind === 'period'`: caller hands us the period's start/end dates (D-17 — the
 *   helper stays DB-pure for one table, period.startDate / endDate is a re-query the
 *   caller already did). Filter executionDate BETWEEN start AND end.
 * - `mode.kind === 'rolling'`: filter executionDate >= (current_date - (weeks * interval '1 week')).
 *
 * NULL executionDate rows are EXCLUDED via an explicit IS NOT NULL predicate.
 */
export async function aggregateWeeklyBuckets(
  filters: DashboardFilters,
  mode: WeeklyMode,
): Promise<WeekBucket[]> {
  const datePred =
    mode.kind === "period"
      ? sql`(${executions.fields}->>'executionDate')::date between ${mode.startDate}::date and ${mode.endDate}::date`
      : sql`(${executions.fields}->>'executionDate')::date >= (current_date - (${mode.weeks} * interval '1 week'))`;

  const weekStartExpr = sql<string>`to_char(date_trunc('week', (${executions.fields}->>'executionDate')::date::timestamp), 'YYYY-MM-DD')`;

  const rows = await db
    .select({
      weekStart: weekStartExpr,
      executed: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Done')::int`,
      cancelled: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Cancelled')::int`,
      inProgress: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'In Progress')::int`,
      pending: sql<string>`count(${executions.id}) filter (where ${executions.status} = 'Pending' or ${executions.status} is null)::int`,
      actualCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
    })
    .from(planRows)
    .innerJoin(executions, eq(executions.planRowId, planRows.id))
    .where(
      and(
        PLAN_UPLOAD_ONLY,
        facetWhere(filters),
        sql`(${executions.fields}->>'executionDate') is not null`,
        datePred,
      ),
    )
    .groupBy(weekStartExpr)
    .orderBy(weekStartExpr);

  return rows.map((r) => ({
    weekStart: String(r.weekStart),
    executed: Number(r.executed ?? 0),
    cancelled: Number(r.cancelled ?? 0),
    inProgress: Number(r.inProgress ?? 0),
    pending: Number(r.pending ?? 0),
    actualCost: Number(r.actualCost ?? 0),
  }));
}

// ---------------------------------------------------------------------------
// Helper 6 — aggregateExceptionTotals (D-07 — the ONLY exception-source helper)
// ---------------------------------------------------------------------------

/**
 * Count + ₹ of executions whose parent plan_row.source = 'exception' in scope.
 * Cost still excludes Cancelled rows (Pitfall 2) — exception spend is real spend.
 */
export async function aggregateExceptionTotals(
  filters: DashboardFilters,
): Promise<ExceptionTotals> {
  const rows = await db
    .select({
      exceptionCount: sql<string>`count(${executions.id})::int`,
      exceptionCost: sql<string>`coalesce(sum(${executions.totalCost}) filter (where ${executions.status} <> 'Cancelled' or ${executions.status} is null), 0)::text`,
    })
    .from(planRows)
    .innerJoin(executions, eq(executions.planRowId, planRows.id))
    .where(and(EXCEPTION_ONLY, facetWhere(filters)));

  const r = rows[0];
  return {
    exceptionCount: Number(r?.exceptionCount ?? 0),
    exceptionCost: Number(r?.exceptionCost ?? 0),
  };
}
