/**
 * Live-DB proof of the cross-driver rowCountOf normalizer and per-unit
 * optimistic concurrency gate (D3-11 / Pitfall 6).
 *
 * The type checker can verify the function signatures; vitest can check
 * conditional logic. NEITHER can prove that `UPDATE ... WHERE id=? AND version=?`
 * actually fires against the real PGlite driver and that `rowCountOf()` returns
 * the right integer from the live query result.
 *
 * This smoke proves end-to-end:
 *   1. insertExecution returns a valid id (row was actually created at version 0).
 *   2. A FRESH update (expectedVersion=0) succeeds — rowCountOf===1, version is now 1.
 *   3. A STALE update (expectedVersion=0 again, stale) affects 0 rows — rowCountOf===0.
 *      This is the optimistic-concurrency gate; a conflict is DETECTED, not overwritten.
 *   4. The row's stored value is UNCHANGED after the stale update attempt (no clobber).
 *   5. savePopKit inserts one kit execution + N execution_items atomically.
 *
 * Run with: `npm run executions:smoke`
 * Pattern: `console.log` + `process.exit(0|1)` — mirrors lib/db/__smoke__/plan-upload.ts.
 * NOT vitest; exit-code-driven for npm scripts + CI.
 */
import { sql } from "drizzle-orm";
import { db } from "../index";
import { ensureMigrated } from "../migrate";
import {
  insertExecution,
  updateExecutionVersioned,
  listExecutionsByPeriodActivity,
  savePopKit,
  rowCountOf,
  _findExecutionForTest,
} from "../executions";
import { _resetExecutionsForTest, _resetPlanRowsForTest } from "../plan-rows";
import { _resetPeriodsForTest, insertPeriod } from "../periods";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
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

async function executionItemCount(execId: number): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from execution_items where execution_id = ${execId}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

async function getExecutionRow(
  id: number,
): Promise<{ version: number; fields: Record<string, unknown>; total_cost: string | null } | null> {
  const raw = await db.execute(
    sql`select version, fields, total_cost from executions where id = ${id}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ version: number | string; fields: unknown; total_cost: string | null }>;
  const row = rows[0];
  if (!row) return null;
  return {
    version: Number(row.version),
    fields: row.fields as Record<string, unknown>,
    total_cost: row.total_cost,
  };
}

/**
 * Prove that rowCountOf handles the real PGlite driver result shape.
 * We call it with mock objects that represent what each driver actually returns
 * and assert it normalizes correctly — confirming the duck-typing handles both shapes.
 */
function testRowCountOfNormalizer() {
  // PGlite (via drizzle-orm/pglite) — PROVEN by live debug:
  //   DML result = { rows: [], fields: [], affectedRows: N }
  const pgliteResult = { rows: [], fields: [], affectedRows: 1 };
  assert(rowCountOf(pgliteResult) === 1, `rowCountOf PGlite affectedRows=1: expected 1, got ${rowCountOf(pgliteResult)}`);

  const pgliteZero = { rows: [], fields: [], affectedRows: 0 };
  assert(rowCountOf(pgliteZero) === 0, `rowCountOf PGlite affectedRows=0: expected 0, got ${rowCountOf(pgliteZero)}`);

  // postgres-js (via drizzle-orm/postgres-js): { count: bigint }
  const postgresJsResult = { count: BigInt(1) };
  assert(rowCountOf(postgresJsResult) === 1, `rowCountOf postgres-js shape: expected 1, got ${rowCountOf(postgresJsResult)}`);

  const postgresJsZero = { count: BigInt(0) };
  assert(rowCountOf(postgresJsZero) === 0, `rowCountOf postgres-js zero: expected 0, got ${rowCountOf(postgresJsZero)}`);

  // PGlite older rowCount fallback
  const pgliteOld = { rowCount: 1 };
  assert(rowCountOf(pgliteOld) === 1, `rowCountOf PGlite rowCount fallback: expected 1, got ${rowCountOf(pgliteOld)}`);

  // Null / empty array
  assert(rowCountOf(null) === 0, `rowCountOf null: expected 0`);
  assert(rowCountOf([]) === 0, `rowCountOf empty array: expected 0`);
}

async function main() {
  await ensureMigrated();

  // FK-safe reset order: executions first (children), plan_rows next (parent), periods last.
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();

  // (1) Prove the rowCountOf normalizer handles all driver shapes.
  testRowCountOfNormalizer();
  // eslint-disable-next-line no-console
  console.log("  rowCountOf normalizer: PASS (postgres-js bigint, PGlite rowCount, null/empty)");

  // (2) Seed a period + plan_row (needed as FK target for executions).
  const periodId = await insertPeriod({
    type: "month",
    label: "Smoke Jun 2026",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
  });
  assert(periodId > 0, `insertPeriod returned non-positive id: ${periodId}`);

  // Insert a plan_row directly (bypasses the Server Action — smoke only needs the FK target).
  await db.execute(
    sql`insert into plan_rows (period_id, activity, sfid, fields)
        values (${periodId}, 'counter-wall', 'SMOKE-SF-1', '{}')`,
  );
  const count = await planRowCount(periodId, "counter-wall");
  assert(count === 1, `expected 1 plan_row after seed, got ${count}`);

  // Get the plan_row id for FK target.
  const raw = await db.execute(
    sql`select id from plan_rows where period_id = ${periodId} and sfid = 'SMOKE-SF-1' limit 1`,
  );
  const planRowRows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: number | string }>;
  const planRowId = Number(planRowRows[0]?.id);
  assert(planRowId > 0, `could not get plan_row id after seed, got: ${planRowId}`);

  // (3) insertExecution — new placeholder at version 0.
  let execId!: number;
  await db.transaction(async (tx) => {
    execId = await insertExecution(tx, {
      planRowId,
      fields: { marker: "initial" },
      version: 0,
      status: "Pending",
    });
  });
  assert(execId > 0, `insertExecution returned non-positive id: ${execId}`);

  const afterInsert = await getExecutionRow(execId);
  assert(afterInsert !== null, "execution row must exist after insertExecution");
  assert(afterInsert!.version === 0, `expected version=0 after insert, got ${afterInsert!.version}`);
  assert(
    (afterInsert!.fields as { marker?: string }).marker === "initial",
    `expected fields.marker='initial' after insert`,
  );
  // eslint-disable-next-line no-console
  console.log(`  insertExecution: PASS (id=${execId}, version=0, fields preserved)`);

  // (4) FRESH update: expectedVersion=0 → should succeed, version becomes 1.
  let freshOk!: boolean;
  await db.transaction(async (tx) => {
    freshOk = await updateExecutionVersioned(tx, execId, 0, {
      fields: { marker: "updated" },
      status: "In Progress",
    });
  });
  assert(freshOk === true, `fresh update (expectedVersion=0) must return true, got ${freshOk}`);

  const afterFresh = await getExecutionRow(execId);
  assert(afterFresh !== null, "execution row must exist after fresh update");
  assert(afterFresh!.version === 1, `expected version=1 after fresh update, got ${afterFresh!.version}`);
  assert(
    (afterFresh!.fields as { marker?: string }).marker === "updated",
    `expected fields.marker='updated' after fresh update`,
  );
  // eslint-disable-next-line no-console
  console.log(`  updateExecutionVersioned (fresh): PASS (version bumped 0→1, fields updated)`);

  // (5) STALE update: expectedVersion=0 again (now stale — DB has version=1).
  //     This is THE optimistic-concurrency gate. Must affect 0 rows.
  let staleOk!: boolean;
  await db.transaction(async (tx) => {
    staleOk = await updateExecutionVersioned(tx, execId, 0, {
      fields: { marker: "SHOULD-NOT-PERSIST" },
    });
  });
  assert(staleOk === false, `stale update (expectedVersion=0, DB version=1) must return false, got ${staleOk}`);

  // Confirm the row is UNCHANGED (not clobbered by the stale attempt).
  const afterStale = await getExecutionRow(execId);
  assert(afterStale !== null, "execution row must still exist after stale update");
  assert(afterStale!.version === 1, `version must remain 1 after stale update, got ${afterStale!.version}`);
  assert(
    (afterStale!.fields as { marker?: string }).marker === "updated",
    `fields.marker must remain 'updated' after stale update — got '${(afterStale!.fields as { marker?: string }).marker}'`,
  );
  // eslint-disable-next-line no-console
  console.log(`  updateExecutionVersioned (stale, expectedVersion=0 vs DB version=1): PASS (rowCountOf===0, no clobber)`);

  // (6) listExecutionsByPeriodActivity — should return the execution we inserted.
  const listed = await listExecutionsByPeriodActivity(periodId, "counter-wall");
  assert(listed.length === 1, `expected 1 execution from listExecutionsByPeriodActivity, got ${listed.length}`);
  assert(listed[0].id === execId, `listed execution id must match inserted id`);
  assert(listed[0].version === 1, `listed execution version must be 1`);
  // eslint-disable-next-line no-console
  console.log(`  listExecutionsByPeriodActivity: PASS (1 row returned, id+version correct)`);

  // (7) _findExecutionForTest — test helper returns { id, version }.
  const found = await _findExecutionForTest(planRowId);
  assert(found !== null, "_findExecutionForTest must return a row");
  assert(found!.id === execId, `_findExecutionForTest id mismatch: expected ${execId}, got ${found!.id}`);
  assert(found!.version === 1, `_findExecutionForTest version mismatch: expected 1, got ${found!.version}`);
  // eslint-disable-next-line no-console
  console.log(`  _findExecutionForTest: PASS`);

  // (8) savePopKit — insert a new kit execution + 2 execution_items atomically.
  // Seed a second plan_row for the POP test.
  await db.execute(
    sql`insert into plan_rows (period_id, activity, sfid, fields)
        values (${periodId}, 'pop-dealer-kit', 'SMOKE-SF-POP', '{}')`,
  );
  const popRaw = await db.execute(
    sql`select id from plan_rows where period_id = ${periodId} and sfid = 'SMOKE-SF-POP' limit 1`,
  );
  const popPlanRows = (
    Array.isArray(popRaw) ? popRaw : ((popRaw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: number | string }>;
  const popPlanRowId = Number(popPlanRows[0]?.id);
  assert(popPlanRowId > 0, `could not get POP plan_row id, got: ${popPlanRowId}`);

  let kitExecId!: number;
  await db.transaction(async (tx) => {
    kitExecId = await savePopKit(tx, popPlanRowId, null, [
      { itemName: "Standee A4", qty: 10, rate: 50, lineTotal: 500 },
      { itemName: "Banner 3x2", qty: 2, rate: 750, lineTotal: 1500 },
    ]);
  });
  assert(kitExecId > 0, `savePopKit returned non-positive id: ${kitExecId}`);

  const kitItemCount = await executionItemCount(kitExecId);
  assert(kitItemCount === 2, `expected 2 execution_items after savePopKit, got ${kitItemCount}`);

  const kitRow = await getExecutionRow(kitExecId);
  assert(kitRow !== null, "kit execution row must exist");
  // Kit total = 500 + 1500 = 2000
  // numeric(14,2) returns "2000.00" from PGlite; parse to number for comparison.
  assert(
    Number(kitRow!.total_cost) === 2000,
    `kit total_cost must equal 2000, got '${kitRow!.total_cost}'`,
  );
  // eslint-disable-next-line no-console
  console.log(`  savePopKit (new kit, 2 lines): PASS (kitExecId=${kitExecId}, total_cost=2000, 2 items)`);

  // (9) savePopKit REPLACE — update the same kit with different lines (replace-all).
  await db.transaction(async (tx) => {
    await savePopKit(tx, popPlanRowId, kitExecId, [
      { itemName: "Flex Banner", qty: 5, rate: 200, lineTotal: 1000 },
    ]);
  });
  const kitItemCountAfterReplace = await executionItemCount(kitExecId);
  assert(
    kitItemCountAfterReplace === 1,
    `after replace, expected 1 execution_item, got ${kitItemCountAfterReplace}`,
  );
  // eslint-disable-next-line no-console
  console.log(`  savePopKit (replace, 1 line): PASS (old 2 items deleted, 1 new item inserted)`);

  // eslint-disable-next-line no-console
  console.log(
    "\nD3-11 PROVEN: stale-version UPDATE affects 0 rows (rowCountOf===0); fresh UPDATE bumps version atomically. No clobber. rowCountOf normalizer handles all driver shapes.",
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    "SMOKE FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
