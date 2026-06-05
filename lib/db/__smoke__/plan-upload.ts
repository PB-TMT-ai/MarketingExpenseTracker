/**
 * Live-DB proof of D2-01 — the load-bearing FK-restrict invariant for plan re-uploads.
 *
 * The type checker can confirm the action's signature; vitest can prove the mirror
 * commit's per-path behavior. NEITHER can prove that the ON DELETE RESTRICT FK on
 * `executions.plan_row_id` actually fires at runtime against the real PGlite driver,
 * rolling the whole transaction back and leaving the would-be-deleted plan_row intact.
 *
 * This smoke does exactly that, exercising the EXACT mirror-commit transaction shape
 * `lib/actions/plans.ts` uses (snapshot → insert → update → delete inside ONE
 * db.transaction, try/catch AROUND the transaction) — but invoked directly so the
 * `cookies()` Next-request-scope dependency doesn't block us in a tsx context.
 *
 * What the smoke proves end-to-end:
 *   1. The FK structural invariant (executions.plan_row_id → plan_rows.id ON DELETE
 *      RESTRICT) RAISES SQLSTATE 23001 against the real PGlite driver at delete time.
 *   2. Drizzle's tx auto-rolls back when the callback throws (NO partial write — the
 *      would-be update on SF-B is undone, the row count is unchanged, the execution
 *      survives).
 *   3. `queryBlockedDealers` (helper consumed by commitPlanUpload's catch) correctly
 *      identifies SF-A as the blocker with executionCount=1.
 *   4. The isFkRestrictError detector (verbatim from lib/actions/plans.ts) correctly
 *      duck-types on err.cause?.code ?? err.code and accepts both 23001 and 23503.
 *
 * Pattern: `console.log` + `process.exit(0|1)` + local `function assert()` — mirrors
 * lib/db/__smoke__/item-master.ts. NOT vitest; this is exit-code-driven so npm scripts
 * + CI can gate on it without a test runner.
 *
 * Run with: `npm run plan-upload:smoke`
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../index";
import { ensureMigrated } from "../migrate";
import { planRows } from "../schema";
import {
  _resetExecutionsForTest,
  _resetPlanRowsForTest,
  bulkInsertPlanRows,
  deletePlanRows,
  listByPeriodActivity,
  queryBlockedDealers,
  updatePlanRow,
  type PlanRowInsert,
  type PlanRowUpdate,
} from "../plan-rows";
import { _resetPeriodsForTest, insertPeriod } from "../periods";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
}

/**
 * VERBATIM copy of the isFkRestrictError detector from lib/actions/plans.ts. Duplicated
 * here on purpose: the smoke proves the production detector pattern fires against the
 * real PGlite error shape; importing the action's helper would also pull `cookies()` into
 * scope. Keep this synced with the action.
 */
function isFkRestrictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code =
    (cause as { code?: string } | undefined)?.code ??
    (err as { code?: string }).code;
  return code === "23001" || code === "23503";
}

async function planRowCount(periodId: number, activity: string): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from plan_rows where period_id = ${periodId} and activity = ${activity}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

async function executionCount(planRowId: number): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from executions where plan_row_id = ${planRowId}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

/**
 * Mirror-commit transaction — the EXACT body of commitPlanUpload, minus auth + Zod.
 * Replicates the production shape: snapshot → insert (chunked 500 via
 * bulkInsertPlanRows) → update (per row) → delete (last, only failable branch),
 * with try/catch AROUND db.transaction so a thrown FK RESTRICT triggers rollback.
 */
async function mirrorCommit(
  periodId: number,
  activity: string,
  rows: readonly PlanRowInsert[],
): Promise<
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string; blockedDealers: Array<{ sfid: string; executionCount: number }> }
> {
  const incomingSfids = rows.map((r) => r.sfid);
  try {
    const result = await db.transaction(async (tx) => {
      const existing = await tx
        .select({ id: planRows.id, sfid: planRows.sfid })
        .from(planRows)
        .where(and(eq(planRows.periodId, periodId), eq(planRows.activity, activity)));
      const bySfid = new Map(existing.map((r) => [r.sfid, r.id]));
      const incomingSet = new Set(incomingSfids);

      // Insert NEW (chunked inside the tx; chunking OUTSIDE the tx breaks atomicity).
      const toInsert = rows.filter((r) => !bySfid.has(r.sfid));
      const inserted = await bulkInsertPlanRows(tx, toInsert);

      // Update EXISTING.
      let updated = 0;
      for (const row of rows) {
        const id = bySfid.get(row.sfid);
        if (id == null) continue;
        const patch: PlanRowUpdate = {
          region: row.region,
          state: row.state,
          district: row.district,
          taluka: row.taluka,
          distributor: row.distributor,
          dealer: row.dealer,
          plannedCost: row.plannedCost,
          fields: row.fields,
        };
        await updatePlanRow(tx, id, patch);
        updated++;
      }

      // DELETE — the ONLY branch that can fire FK RESTRICT.
      const toDeleteIds = existing.filter((r) => !incomingSet.has(r.sfid)).map((r) => r.id);
      let deleted = 0;
      if (toDeleteIds.length > 0) {
        await deletePlanRows(tx, toDeleteIds);
        deleted = toDeleteIds.length;
      }

      return { inserted, updated, deleted };
    });
    return { ok: true as const, ...result };
  } catch (err) {
    if (isFkRestrictError(err)) {
      const blocked = await queryBlockedDealers(db, periodId, activity, incomingSfids);
      return {
        ok: false as const,
        error: `Cannot remove ${blocked.length} dealer(s) with recorded actuals`,
        blockedDealers: blocked,
      };
    }
    throw err;
  }
}

/**
 * Construct a counter-wall insert row (shared columns routed correctly; planSqft in jsonb).
 * Tests against the dual table → real-column-vs-jsonb routing for shared/non-shared fields.
 */
function makeRow(periodId: number, sfid: string, region = "West"): PlanRowInsert {
  return {
    periodId,
    activity: "counter-wall",
    sfid,
    region,
    state: "MH",
    district: "Pune",
    taluka: "Haveli",
    distributor: "ACME",
    dealer: null,
    plannedCost: null,
    fields: { dealerOrArea: `Dealer ${sfid}`, planSqft: 100 },
  };
}

async function main() {
  await ensureMigrated();
  // FK-safe reset order: executions first (children), plan_rows next (parent), periods last.
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();

  // (1) Seed a period.
  const periodId = await insertPeriod({
    type: "month",
    label: "Smoke Aug 2026",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  assert(periodId > 0, `insertPeriod returned non-positive id: ${periodId}`);

  // (2) Fresh commit — 2 rows (SF-A, SF-B).
  const seedState = await mirrorCommit(periodId, "counter-wall", [
    makeRow(periodId, "SF-A", "West"),
    makeRow(periodId, "SF-B", "West"),
  ]);
  assert(seedState.ok === true, `seed commit must succeed, got: ${JSON.stringify(seedState)}`);
  if (!seedState.ok) throw new Error("unreachable");
  assert(seedState.inserted === 2, `expected inserted=2, got ${seedState.inserted}`);
  assert(
    (await planRowCount(periodId, "counter-wall")) === 2,
    "after seed commit, expected 2 plan_rows for (period, counter-wall)",
  );

  // (3) Find SF-A's plan_row id and seed ONE execution against it via raw SQL.
  const allRows = await listByPeriodActivity(periodId, "counter-wall");
  const planRowA = allRows.find((r) => r.sfid === "SF-A");
  assert(planRowA !== undefined, "could not find SF-A plan_row after seed");
  if (!planRowA) throw new Error("unreachable");

  await db.execute(
    sql`insert into executions (plan_row_id, status, unit_no) values (${planRowA.id}, 'Pending', 'smoke-unit-1')`,
  );
  assert(
    (await executionCount(planRowA.id)) === 1,
    "after raw-SQL insert, expected 1 execution row against SF-A",
  );

  // Snapshot SF-A's region BEFORE the failed commit — we'll re-check after to prove
  // the rollback was clean (no partial update slipped through).
  const sfaRegionBefore = planRowA.region;
  assert(
    sfaRegionBefore === "West",
    `expected SF-A region 'West' before failed commit, got '${sfaRegionBefore}'`,
  );

  // (4) Re-upload OMITTING SF-A. Also mutate SF-B's region so we can prove the
  // rollback undid the would-be update on SF-B (i.e. the transaction rolled back
  // ALL changes, not just the delete).
  const blockedState = await mirrorCommit(periodId, "counter-wall", [
    makeRow(periodId, "SF-B", "SouthRegionChange"),
  ]);

  // (5) Assert: state.ok=false, blockedDealers reports SF-A.
  assert(
    blockedState.ok === false,
    `expected ok=false on FK-restrict path, got: ${JSON.stringify(blockedState)}`,
  );
  if (blockedState.ok) throw new Error("unreachable");
  assert(blockedState.blockedDealers !== undefined, "blockedDealers must be present");
  assert(
    blockedState.blockedDealers.length === 1,
    `expected exactly 1 blocked dealer, got ${blockedState.blockedDealers.length}`,
  );
  assert(
    blockedState.blockedDealers[0].sfid === "SF-A",
    `expected blocked sfid='SF-A', got '${blockedState.blockedDealers[0].sfid}'`,
  );
  assert(
    blockedState.blockedDealers[0].executionCount === 1,
    `expected executionCount=1, got ${blockedState.blockedDealers[0].executionCount}`,
  );
  assert(
    /Cannot remove .* dealer/.test(blockedState.error),
    `expected error to mention 'Cannot remove ... dealer', got: ${blockedState.error}`,
  );

  // (6) Assert rollback held: row count UNCHANGED at 2, execution still exists,
  // AND SF-B's region was NOT updated (the would-be update was part of the same tx).
  assert(
    (await planRowCount(periodId, "counter-wall")) === 2,
    `D2-01 VIOLATED: rollback did not hold — plan_row count changed`,
  );
  assert(
    (await executionCount(planRowA.id)) === 1,
    `execution against SF-A must still exist after rollback`,
  );

  const rowsAfter = await listByPeriodActivity(periodId, "counter-wall");
  const sfaAfter = rowsAfter.find((r) => r.sfid === "SF-A");
  const sfbAfter = rowsAfter.find((r) => r.sfid === "SF-B");
  assert(sfaAfter !== undefined, "SF-A must still exist after rollback");
  assert(sfbAfter !== undefined, "SF-B must still exist after rollback");
  assert(
    sfaAfter!.region === "West",
    `D2-01 VIOLATED: SF-A region changed across the failed commit — got '${sfaAfter!.region}'`,
  );
  assert(
    sfbAfter!.region === "West",
    `D2-01 VIOLATED: SF-B region was updated to 'SouthRegionChange' despite tx rollback — got '${sfbAfter!.region}'`,
  );

  // Use inArray import so the import doesn't get tree-shaken away if a future refactor
  // simplifies the smoke. (Drizzle's index inArray is the helper deletePlanRows uses.)
  void inArray;

  // eslint-disable-next-line no-console
  console.log(
    `D2-01 PROVEN: FK RESTRICT fires on removal of SFID with executions; transaction rolled back; blockedDealers re-query returns SF-A. No partial write occurred.`,
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    "SMOKE FAILED:",
    err instanceof Error ? err.message : err,
  );
  process.exit(1);
});
