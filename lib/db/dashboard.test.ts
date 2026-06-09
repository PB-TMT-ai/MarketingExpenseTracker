import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "./index";
import { ensureMigrated } from "./migrate";
import {
  _findPlanRowIdForTest,
  _resetExecutionsForTest,
  _resetPlanRowsForTest,
} from "./plan-rows";
import { _resetExecutionItemsForTest } from "./executions";
import { _resetPeriodsForTest, insertPeriod } from "./periods";
import { computeCompleteness } from "../compliance/completeness";

import {
  aggregateExceptionTotals,
  aggregateScopeTotals,
  aggregateWeeklyBuckets,
  breakdownByDistributor,
  breakdownByState,
  type DashboardFilters,
} from "./dashboard";
import { executions, planRows } from "./schema";

/**
 * PGlite-backed integration tests for `lib/db/dashboard.ts`.
 *
 * Locks the invariants Plan 04-02 ships:
 *   - D-06 exception exclusion via PLAN_UPLOAD_ONLY (Test 1).
 *   - Pitfall 2 cancelled-cost exclusion (Test 2).
 *   - D-04 asymmetric-denominator round-trip with `computeCompleteness` (Test 3).
 *   - DASH-06 ISO Monday-start week bucketing + rolling-N (Test 4).
 *   - D-17 filter honoring — empty array = no constraint (Test 5).
 *   - Pending includes NULL status (Phase 3.1 backfill semantics, Test 6).
 *
 * Live PGlite via the shared `db` instance. vitest.config.ts pins
 * DATABASE_URL=memory:// so this never collides with the dev server's
 * `./.pglite` directory.
 *
 * Cleanup order is FK-safe: execution_items → executions → plan_rows → periods.
 */

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  await _resetExecutionItemsForTest();
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();
});

// ---------------------------------------------------------------------------
// Seed helpers (test-only — never touch production write paths)
// ---------------------------------------------------------------------------

type SeedSpec = {
  periodId: number;
  activity?: string;
  sfid: string;
  region?: string | null;
  state?: string | null;
  district?: string | null;
  taluka?: string | null;
  distributor?: string | null;
  source?: "plan-upload" | "exception";
  plannedCost?: number | null;
  status?: string | null;
  totalCost?: number | null;
  executionDate?: string | null; // 'YYYY-MM-DD'
};

/**
 * Seed ONE plan_row + ZERO-or-ONE execution. Status / totalCost / executionDate
 * may be omitted to leave the execution unwritten (planned-but-not-executed).
 */
async function seed(spec: SeedSpec): Promise<{ planRowId: number; sfid: string }> {
  const activity = spec.activity ?? "counter-wall";
  const source = spec.source ?? "plan-upload";
  const plannedCost = spec.plannedCost == null ? null : String(spec.plannedCost);

  await db.execute(
    sql`insert into plan_rows
        (period_id, activity, sfid, region, state, district, taluka, distributor,
         planned_cost, fields, source)
        values (${spec.periodId}, ${activity}, ${spec.sfid},
                ${spec.region ?? null}, ${spec.state ?? null}, ${spec.district ?? null},
                ${spec.taluka ?? null}, ${spec.distributor ?? null},
                ${plannedCost}, '{}', ${source})`,
  );
  const planRowId = await _findPlanRowIdForTest(spec.periodId, activity, spec.sfid);
  if (!planRowId) throw new Error(`seed: could not find plan_row for sfid=${spec.sfid}`);

  // No execution requested → plan_row only.
  const shouldSeedExec =
    spec.status !== undefined ||
    spec.totalCost !== undefined ||
    spec.executionDate !== undefined;
  if (!shouldSeedExec) return { planRowId, sfid: spec.sfid };

  const totalCost = spec.totalCost == null ? null : String(spec.totalCost);
  const fields = spec.executionDate
    ? JSON.stringify({ executionDate: spec.executionDate })
    : "{}";

  await db.execute(
    sql`insert into executions (plan_row_id, status, unit_no, total_cost, fields)
        values (${planRowId}, ${spec.status ?? null}, ${`u-${spec.sfid}`},
                ${totalCost}, ${fields}::jsonb)`,
  );

  return { planRowId, sfid: spec.sfid };
}

async function newPeriod(label = "Dash Jul 2026"): Promise<number> {
  return insertPeriod({
    type: "month",
    label,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
}

function noFilters(periodId: number): DashboardFilters {
  return {
    periodId,
    activity: null,
    regions: [],
    states: [],
    districts: [],
    distributors: [],
  };
}

// ---------------------------------------------------------------------------
// Test 1 — D-06 exception exclusion (R2)
// ---------------------------------------------------------------------------

describe("D-06 exception exclusion via PLAN_UPLOAD_ONLY", () => {
  it("Test 1: aggregateScopeTotals excludes source='exception'; aggregateExceptionTotals counts them", async () => {
    const periodId = await newPeriod();

    // 3 plan-upload rows with Done executions.
    await seed({ periodId, sfid: "P-1", status: "Done", totalCost: 100 });
    await seed({ periodId, sfid: "P-2", status: "Done", totalCost: 100 });
    await seed({ periodId, sfid: "P-3", status: "Done", totalCost: 100 });

    // 1 exception row with a Done execution.
    await seed({
      periodId,
      sfid: "EX-1",
      source: "exception",
      status: "Done",
      totalCost: 500,
    });

    const scope = await aggregateScopeTotals(noFilters(periodId));
    // Plan-upload only: 3 planned, 3 executed, ₹300 actual.
    expect(scope.plannedUnits).toBe(3);
    expect(scope.executedUnits).toBe(3);
    expect(scope.actualCost).toBe(300);

    const ex = await aggregateExceptionTotals(noFilters(periodId));
    expect(ex.exceptionCount).toBe(1);
    expect(ex.exceptionCost).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Pitfall 2 cancelled-cost exclusion
// ---------------------------------------------------------------------------

describe("Pitfall 2 cancelled-cost exclusion", () => {
  it("Test 2: sum(total_cost) FILTER excludes status='Cancelled' rows", async () => {
    const periodId = await newPeriod("Dash Aug 2026");
    // Two distinct plan_rows so each gets its own execution.
    await seed({ periodId, sfid: "CC-1", status: "Cancelled", totalCost: 500 });
    await seed({ periodId, sfid: "CC-2", status: "Done", totalCost: 300 });

    const scope = await aggregateScopeTotals(noFilters(periodId));
    expect(scope.actualCost).toBe(300); // NOT 800
    expect(scope.cancelledUnits).toBe(1);
    expect(scope.executedUnits).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — D-04 asymmetric denominators round-trip with computeCompleteness
// ---------------------------------------------------------------------------

describe("D-04 asymmetric denominators (DAL + compliance math round-trip)", () => {
  it("Test 3: planned=10, executed=6, cancelled=2 → pctExecuted=0.75, pctCancelled=0.20, denom=8", async () => {
    const periodId = await newPeriod("Dash Sep 2026");

    // 6 Done, 2 Cancelled, 2 Pending — 10 plan_rows total.
    for (let i = 0; i < 6; i++) {
      await seed({ periodId, sfid: `D-${i}`, status: "Done", totalCost: 10 });
    }
    for (let i = 0; i < 2; i++) {
      await seed({ periodId, sfid: `C-${i}`, status: "Cancelled", totalCost: 999 });
    }
    for (let i = 0; i < 2; i++) {
      await seed({ periodId, sfid: `P-${i}`, status: "Pending" });
    }

    const scope = await aggregateScopeTotals(noFilters(periodId));
    expect(scope.plannedUnits).toBe(10);
    expect(scope.executedUnits).toBe(6);
    expect(scope.cancelledUnits).toBe(2);

    expect(
      computeCompleteness({
        plannedUnits: scope.plannedUnits,
        executedUnits: scope.executedUnits,
        cancelledUnits: scope.cancelledUnits,
      }),
    ).toEqual({ pctExecuted: 0.75, pctCancelled: 0.2, effectiveDenominator: 8 });
  });
});

// ---------------------------------------------------------------------------
// Test 4 — ISO week bucketing + rolling-N
// ---------------------------------------------------------------------------

describe("DASH-06 ISO Monday-start week bucketing", () => {
  it("Test 4: three Mondays + one same-week Wednesday → three buckets; weekStart = Monday", async () => {
    const periodId = await newPeriod("Dash Iso 2026");

    // Three consecutive Mondays in 2026 (verified):
    //   2026-06-01 (Mon), 2026-06-08 (Mon), 2026-06-15 (Mon).
    // The Wednesday of week 2: 2026-06-10 — same ISO week as 2026-06-08.
    await seed({
      periodId,
      sfid: "W-1-MON",
      status: "Done",
      totalCost: 10,
      executionDate: "2026-06-01",
    });
    await seed({
      periodId,
      sfid: "W-2-MON",
      status: "Done",
      totalCost: 20,
      executionDate: "2026-06-08",
    });
    await seed({
      periodId,
      sfid: "W-2-WED",
      status: "Done",
      totalCost: 30,
      executionDate: "2026-06-10",
    });
    await seed({
      periodId,
      sfid: "W-3-MON",
      status: "Done",
      totalCost: 40,
      executionDate: "2026-06-15",
    });

    const buckets = await aggregateWeeklyBuckets(noFilters(periodId), {
      kind: "rolling",
      // Wide enough window to capture all three seeded weeks regardless of
      // the date `current_date` lands on at run time (the buckets are
      // semantically time-relative; we lock the count + monday-anchor only).
      weeks: 12,
    });

    // Filter to the buckets we control; the test environment's `current_date`
    // may add empty trailing weeks but no more seeded data.
    const seededWeekStarts = ["2026-06-01", "2026-06-08", "2026-06-15"];
    const ours = buckets.filter((b) => seededWeekStarts.includes(b.weekStart));
    expect(ours.map((b) => b.weekStart)).toEqual(seededWeekStarts);

    // Wed of week 2 merges into 2026-06-08 bucket: 2 executions, ₹50.
    const week2 = ours.find((b) => b.weekStart === "2026-06-08");
    expect(week2?.executed).toBe(2);
    expect(week2?.actualCost).toBe(50);

    const week1 = ours.find((b) => b.weekStart === "2026-06-01");
    expect(week1?.executed).toBe(1);

    const week3 = ours.find((b) => b.weekStart === "2026-06-15");
    expect(week3?.executed).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — D-17 filter honoring (empty array = no constraint)
// ---------------------------------------------------------------------------

describe("D-17 filter honoring", () => {
  it("Test 5: regions=['North'] halves the count; regions=[] returns the full set", async () => {
    const periodId = await newPeriod("Dash Filter 2026");

    for (let i = 0; i < 3; i++) {
      await seed({ periodId, sfid: `N-${i}`, region: "North" });
    }
    for (let i = 0; i < 3; i++) {
      await seed({ periodId, sfid: `S-${i}`, region: "South" });
    }

    const all = await aggregateScopeTotals(noFilters(periodId));
    expect(all.plannedUnits).toBe(6);

    const north = await aggregateScopeTotals({
      ...noFilters(periodId),
      regions: ["North"],
    });
    expect(north.plannedUnits).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Test 6 — pendingUnits includes NULL status (Phase 3.1 backfill semantics)
// ---------------------------------------------------------------------------

describe("pending-includes-NULL (Phase 3.1 backfill semantics)", () => {
  it("Test 6: status='Pending' and status IS NULL both count as pending", async () => {
    const periodId = await newPeriod("Dash Pending 2026");
    await seed({ periodId, sfid: "PN-1", status: "Pending" });
    await seed({ periodId, sfid: "PN-2", status: null });

    const scope = await aggregateScopeTotals(noFilters(periodId));
    expect(scope.pendingUnits).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Task 2.2 — breakdownByState / breakdownByDistributor (RED)
// ---------------------------------------------------------------------------

describe("breakdownByState", () => {
  it("groups planned/actual cost + counters + sqft by state", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });

    // Seed: 2 counter-wall plan rows in MH, 1 in KA. One MH row executed with status='Done'.
    await db.insert(planRows).values([
      { periodId, activity: "counter-wall", sfid: "S1", state: "MH", plannedCost: "1000", fields: { planSqft: 100 } },
      { periodId, activity: "counter-wall", sfid: "S2", state: "MH", plannedCost: "2000", fields: { planSqft: 200 } },
      { periodId, activity: "counter-wall", sfid: "S3", state: "KA", plannedCost: "3000", fields: { planSqft: 300 } },
    ]);
    const mhRowId = await _findPlanRowIdForTest(periodId, "counter-wall", "S1");
    await db.insert(executions).values({
      planRowId: mhRowId!,
      status: "Done",
      totalCost: "950",
      totalSqft: "98",
    });

    const rows = await breakdownByState({
      periodId,
      activity: null,
      regions: [],
      states: [],
      districts: [],
      distributors: [],
    });

    const mh = rows.find((r) => r.state === "MH")!;
    expect(mh.plannedCost).toBe(3000);
    expect(mh.actualCost).toBe(950);
    expect(mh.plannedCounters).toBe(2);
    expect(mh.actualCounters).toBe(1);
    expect(mh.plannedSqft).toBe(300);
    expect(mh.actualSqft).toBe(98);

    const ka = rows.find((r) => r.state === "KA")!;
    expect(ka.plannedCost).toBe(3000);
    expect(ka.actualCounters).toBe(0);
  });
});

describe("breakdownByDistributor", () => {
  it("groups by distributor and coalesces NULL to (unassigned)", async () => {
    const periodId = await insertPeriod({
      type: "quarter",
      label: "Q1",
      startDate: "2026-04-01",
      endDate: "2026-06-30",
    });
    await db.insert(planRows).values([
      { periodId, activity: "counter-wall", sfid: "S1", distributor: "Acme", plannedCost: "1000", fields: { planSqft: 100 } },
      { periodId, activity: "counter-wall", sfid: "S2", distributor: null, plannedCost: "500", fields: { planSqft: 50 } },
    ]);

    const rows = await breakdownByDistributor({
      periodId,
      activity: null,
      regions: [],
      states: [],
      districts: [],
      distributors: [],
    });

    expect(rows.find((r) => r.distributor === "Acme")?.plannedCost).toBe(1000);
    expect(rows.find((r) => r.distributor === "(unassigned)")?.plannedCost).toBe(500);
  });
});
