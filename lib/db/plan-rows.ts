import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { executions, planRows } from "./schema";
import { chunked } from "../excel/util";

/**
 * Typed query helpers for `plan_rows`. NO business rules live here — the off-plan guard
 * (D-01 / COMP-01) is structural in the `executions.plan_row_id` NOT NULL FK with
 * ON DELETE RESTRICT, and the mirror-semantics policy (D2-01) lives in
 * `lib/actions/plans.ts`. This module exposes a thin typed read/write surface only.
 *
 * Discipline mirrored from `lib/db/periods.ts`:
 *   - one-call query helpers that take primitive args and return typed shapes
 *   - bulk write helpers accept an OUTER `tx` (or `db`) so the caller controls the
 *     transaction boundary — these functions NEVER open their own `db.transaction(...)`
 *   - underscore-prefixed `_resetPlanRowsForTest` is a test/smoke helper only
 */

/**
 * Drizzle returns `numeric` columns as STRING (preserves arbitrary precision), so
 * `plannedCost` is `string | null` here. Callers that need a JS number must convert.
 */
export type PlanRowRecord = {
  id: number;
  periodId: number;
  activity: string;
  sfid: string;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  distributor: string | null;
  dealer: string | null;
  plannedCost: string | null;
  fields: Record<string, unknown>;
};

/** One blocked-dealer row returned by `queryBlockedDealers`. */
export type BlockedDealer = {
  sfid: string;
  executionCount: number;
};

/**
 * Type alias for either the outer `db` instance OR the transactional handle Drizzle
 * passes into `db.transaction(async tx => ...)`. The transaction handle is a
 * `PgTransaction<...>` which lacks `$client` and therefore is NOT assignable to
 * `typeof db` directly — we extract its shape from the callback parameter so the
 * helpers compile uniformly whether called with `db` or `tx`.
 *
 * Discipline: bulkInsertPlanRows / updatePlanRow / deletePlanRows are typically called
 * with `tx`; listByPeriodActivity / queryBlockedDealers may be called with either.
 * Either way the helper never opens its own `db.transaction(...)`.
 */
type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | TxHandle;

/** List every plan_row for (periodId, activity). Mirrors `listPeriods` shape-wise. */
export async function listByPeriodActivity(
  periodId: number,
  activity: string,
): Promise<PlanRowRecord[]> {
  const rows = await db
    .select()
    .from(planRows)
    .where(and(eq(planRows.periodId, periodId), eq(planRows.activity, activity)));
  return rows as PlanRowRecord[];
}

/**
 * The row shape `commitPlanUpload` hands to `bulkInsertPlanRows`. Shared who/where
 * columns are present as nullable string columns; jsonb tail rides in `fields`;
 * plannedCost is a number-or-null, converted to string on write to satisfy numeric(14,2).
 */
export type PlanRowInsert = {
  periodId: number;
  activity: string;
  sfid: string;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  distributor: string | null;
  dealer: string | null;
  plannedCost: number | null;
  fields: Record<string, unknown>;
};

/**
 * Bulk-insert plan rows in 500-row chunks (RESEARCH §4 — under the 65535 wire-param cap
 * for ~20-column rows). MUST be called with an OUTER transaction handle; the chunked
 * loop runs INSIDE that transaction so a failure on any chunk rolls back all chunks
 * (the atomic-commit guarantee from CONTEXT line 117).
 *
 * Numeric cast: Drizzle's pg numeric column accepts string OR number on input, but the
 * canonical representation is string — stringify here so future engine swaps don't drift.
 */
export async function bulkInsertPlanRows(
  tx: DbOrTx,
  rows: readonly PlanRowInsert[],
): Promise<number> {
  if (rows.length === 0) return 0;
  let inserted = 0;
  for (const chunk of chunked(rows, 500)) {
    await tx.insert(planRows).values(
      chunk.map((r) => ({
        periodId: r.periodId,
        activity: r.activity,
        sfid: r.sfid,
        region: r.region,
        state: r.state,
        district: r.district,
        taluka: r.taluka,
        distributor: r.distributor,
        dealer: r.dealer,
        plannedCost: r.plannedCost === null ? null : String(r.plannedCost),
        fields: r.fields,
      })),
    );
    inserted += chunk.length;
  }
  return inserted;
}

/** The mutable patch shape for a single existing plan_row. */
export type PlanRowUpdate = {
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  distributor: string | null;
  dealer: string | null;
  plannedCost: number | null;
  fields: Record<string, unknown>;
};

/**
 * Update a single plan_row by id. The natural unit is per-row because the changed-fields
 * set is small (the mirror-semantics path expects ~tens of updates per re-upload, not
 * thousands). Uses the caller's transaction handle.
 */
export async function updatePlanRow(
  tx: DbOrTx,
  id: number,
  patch: PlanRowUpdate,
): Promise<void> {
  await tx
    .update(planRows)
    .set({
      region: patch.region,
      state: patch.state,
      district: patch.district,
      taluka: patch.taluka,
      distributor: patch.distributor,
      dealer: patch.dealer,
      plannedCost: patch.plannedCost === null ? null : String(patch.plannedCost),
      fields: patch.fields,
    })
    .where(eq(planRows.id, id));
}

/**
 * Delete plan_rows by id. This is the ONLY branch in the commit that can fire FK RESTRICT
 * (when a row has child executions). Callers MUST let the throw propagate out of
 * `db.transaction(...)` so Drizzle rolls back; the outer `commitPlanUpload` translates the
 * SQLSTATE 23001/23503 error into `{ ok: false, blockedDealers }`.
 */
export async function deletePlanRows(tx: DbOrTx, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.delete(planRows).where(inArray(planRows.id, ids));
}

/**
 * After a failed mirror-commit (FK RESTRICT fired and the tx rolled back), recompute which
 * SFIDs in the existing plan are absent from the incoming upload AND have at least one
 * child execution — those are the "blockers" the user must resolve before retrying.
 *
 * MUST be called with the OUTER `db` (not a rolled-back tx). LEFT JOINs `executions`,
 * groups by sfid, filters HAVING count > 0. Returns rows shaped `{ sfid, executionCount }`.
 */
export async function queryBlockedDealers(
  database: DbOrTx,
  periodId: number,
  activity: string,
  incomingSfids: readonly string[],
): Promise<BlockedDealer[]> {
  const existing = await database
    .select({ id: planRows.id, sfid: planRows.sfid })
    .from(planRows)
    .where(and(eq(planRows.periodId, periodId), eq(planRows.activity, activity)));

  // The SFIDs the user is asking to REMOVE = present in DB, absent from upload.
  const incomingSet = new Set(incomingSfids);
  const wouldRemove = existing.filter((r) => !incomingSet.has(r.sfid));
  if (wouldRemove.length === 0) return [];

  const idsToCheck = wouldRemove.map((r) => r.id);
  const blocked = await database
    .select({
      sfid: planRows.sfid,
      count: sql<number>`count(${executions.id})::int`,
    })
    .from(planRows)
    .leftJoin(executions, eq(executions.planRowId, planRows.id))
    .where(inArray(planRows.id, idsToCheck))
    .groupBy(planRows.sfid)
    .having(sql`count(${executions.id}) > 0`);

  return blocked.map((b) => ({ sfid: b.sfid, executionCount: Number(b.count) }));
}

/**
 * Test/smoke helper — wipes the executions table.
 *
 * MUST run BEFORE `_resetPlanRowsForTest` because of the NOT NULL FK with ON DELETE
 * RESTRICT — a delete against `plan_rows` would otherwise fail if any row has children.
 * NEVER call from app code.
 */
export async function _resetExecutionsForTest(): Promise<void> {
  await db.execute(sql`delete from executions`);
}

/**
 * Test/smoke helper — wipes the plan_rows table. Call `_resetExecutionsForTest()` first.
 * NEVER call from app code (the off-plan guard depends on plan_rows referencing real
 * periods; truncating would orphan downstream data).
 */
export async function _resetPlanRowsForTest(): Promise<void> {
  await db.execute(sql`delete from plan_rows`);
}
