import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./index";
import { executions, executionItems, planRows } from "./schema";

/**
 * Typed query / write helpers for `executions` and `execution_items`.
 *
 * NO business rules live here — no requireSession, no Zod, no revalidatePath.
 * This module is the thin data-access layer; all rules live in `lib/actions/executions.ts`.
 *
 * Discipline mirrors `lib/db/plan-rows.ts`:
 *   - Helpers accept an OUTER `tx` (or `db`) and NEVER open their own `db.transaction`.
 *   - Numeric inputs are stringified at the write boundary (numeric(14,2) columns).
 *   - Drizzle returns `numeric` as STRING; callers that need a JS number must convert.
 *   - No `sfid` column exists on `executions` — the off-plan guard is structural (COMP-01).
 *   - Underscore-prefixed helpers are test/smoke only; NEVER call from app code.
 */

// ---------------------------------------------------------------------------
// DbOrTx — mirror the plan-rows.ts pattern exactly
// ---------------------------------------------------------------------------
type TxHandle = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type DbOrTx = typeof db | TxHandle;

// ---------------------------------------------------------------------------
// Canonical type: ExecutionRecord (owned here; lib/actuals/rows.ts imports from here)
// ---------------------------------------------------------------------------

/**
 * ExecutionRecord — the canonical shape returned by read queries.
 * Numeric columns (perUnitCost / totalCost / totalSqft) arrive as string | null
 * from Drizzle's `numeric` type, matching the PlanRowRecord.plannedCost pattern.
 * `fields` is the jsonb measurement blob.
 */
export type ExecutionRecord = {
  id: number;
  planRowId: number;
  status: string | null;
  unitNo: string | null;
  perUnitCost: string | null;
  totalCost: string | null;
  totalSqft: string | null;
  fields: Record<string, unknown>;
  version: number;
};

/**
 * ExecPatch — the mutable subset of an execution row, used on updates.
 * Numeric values are expected as strings (to match the DB boundary convention).
 */
export type ExecPatch = {
  status?: string | null;
  unitNo?: string | null;
  perUnitCost?: string | null;
  totalCost?: string | null;
  totalSqft?: string | null;
  fields?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// rowCountOf — cross-driver affected-row count normalizer (Pitfall 6)
//
// PGlite (via drizzle-orm/pglite) and postgres-js (via drizzle-orm/postgres-js)
// expose the UPDATE result differently:
//   PGlite   → the result IS the row array  (length = rows affected on RETURNING,
//               but for non-RETURNING DML, drizzle returns the empty array [])
//             ACTUALLY: PGlite DML result via drizzle execute() is an object { rows: [] }
//             but drizzle's .update().set().where() returns a QueryResult whose
//             shape depends on driver. We duck-type all plausible shapes.
//   postgres-js → returns { count: bigint, command: string, ... }
//
// The duck-typing approach mirrors `isFkRestrictError` in lib/actions/plans.ts:
// never instanceof-check (obfuscated classes across versions), always structural.
//
// Proven by the live PGlite smoke (lib/db/__smoke__/executions.ts): a stale-version
// UPDATE affects 0 rows → rowCountOf returns 0; a fresh UPDATE affects 1 row → returns 1.
// ---------------------------------------------------------------------------
export function rowCountOf(result: unknown): number {
  if (result == null) return 0;

  // PGlite (via drizzle-orm/pglite) — PROVEN by live smoke:
  //   UPDATE/INSERT/DELETE without RETURNING returns { rows: [], fields: [], affectedRows: number }
  //   affectedRows is the actual row count affected by the DML statement.
  if (typeof (result as { affectedRows?: unknown }).affectedRows === "number") {
    return (result as { affectedRows: number }).affectedRows;
  }

  // postgres-js (via drizzle-orm/postgres-js):
  //   Result is a ResultSet where `.count` is a bigint (number of rows affected).
  if (typeof (result as { count?: unknown }).count === "bigint") {
    return Number((result as { count: bigint }).count);
  }
  // Some drizzle versions expose count as a number directly
  if (typeof (result as { count?: unknown }).count === "number") {
    return (result as { count: number }).count;
  }

  // PGlite rowCount fallback (older versions of PGlite/drizzle-pglite).
  if (typeof (result as { rowCount?: unknown }).rowCount === "number") {
    return (result as { rowCount: number }).rowCount;
  }

  // Fallback: if the result is an array (RETURNING shape), use length.
  // For UPDATE without RETURNING the array would be empty → 0.
  if (Array.isArray(result)) {
    return (result as unknown[]).length;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// insertExecution — insert a new execution row (version 0 for new placeholders)
// ---------------------------------------------------------------------------

export type ExecInsertValues = {
  planRowId: number;
  fields: Record<string, unknown>;
  version?: number; // defaults to 0
  status?: string | null;
  unitNo?: string | null;
  perUnitCost?: number | string | null;
  totalCost?: number | string | null;
  totalSqft?: number | string | null;
};

/**
 * Insert a new execution row. Stringifies numeric inputs at the DB boundary.
 * Returns the new execution id.
 * MUST be called within an OUTER tx; never opens its own transaction.
 * NO sfid is written (column does not exist — off-plan guard is structural).
 */
export async function insertExecution(
  tx: DbOrTx,
  values: ExecInsertValues,
): Promise<number> {
  const toNumStr = (v: number | string | null | undefined): string | null => {
    if (v == null) return null;
    return String(v);
  };

  const inserted = await tx
    .insert(executions)
    .values({
      planRowId: values.planRowId,
      fields: values.fields,
      version: values.version ?? 0,
      status: values.status ?? null,
      unitNo: values.unitNo ?? null,
      perUnitCost: toNumStr(values.perUnitCost),
      totalCost: toNumStr(values.totalCost),
      totalSqft: toNumStr(values.totalSqft),
    })
    .returning();

  const row =
    Array.isArray(inserted) ? inserted[0] : ((inserted as { rows?: unknown[] }).rows ?? [])[0];

  if (!row) {
    throw new Error("insertExecution: failed to get inserted row");
  }
  return Number((row as { id: number | string }).id);
}

// ---------------------------------------------------------------------------
// updateExecutionVersioned — optimistic-concurrency UPDATE (D3-11)
//
// UPDATE executions
//   SET ..., version = expectedVersion+1, updated_at = now()
//   WHERE id = ? AND version = ?
//
// Returns true if exactly 1 row was affected (success),
// false if 0 rows were affected (stale version — conflict, do NOT retry/overwrite).
// ---------------------------------------------------------------------------

/**
 * Version-checked update. Bumps `version` atomically at the DB level.
 * Returns true on success (rowCount===1), false on stale version (rowCount===0).
 * Does NOT throw on a stale version — the caller COLLECTS conflicts (D3-11).
 * Genuine DB errors are still thrown.
 */
export async function updateExecutionVersioned(
  tx: DbOrTx,
  id: number,
  expectedVersion: number,
  patch: ExecPatch,
): Promise<boolean> {
  const toNumStr = (v: string | null | undefined): string | null => {
    if (v == null) return null;
    return v;
  };

  const setValues: Record<string, unknown> = {
    version: expectedVersion + 1,
    updatedAt: new Date(),
  };

  if (patch.status !== undefined) setValues.status = patch.status;
  if (patch.unitNo !== undefined) setValues.unitNo = patch.unitNo;
  if (patch.perUnitCost !== undefined) setValues.perUnitCost = toNumStr(patch.perUnitCost);
  if (patch.totalCost !== undefined) setValues.totalCost = toNumStr(patch.totalCost);
  if (patch.totalSqft !== undefined) setValues.totalSqft = toNumStr(patch.totalSqft);
  if (patch.fields !== undefined) setValues.fields = patch.fields;

  const res = await tx
    .update(executions)
    .set(setValues as Parameters<ReturnType<typeof tx.update>["set"]>[0])
    .where(and(eq(executions.id, id), eq(executions.version, expectedVersion)));

  return rowCountOf(res) === 1;
}

// ---------------------------------------------------------------------------
// listExecutionsByPeriodActivity — read all executions for a (periodId, activity)
// ---------------------------------------------------------------------------

/**
 * Join executions → plan_rows and filter by (period_id, activity).
 * Returns ExecutionRecord[] sorted by plan_row_id (stable order for the flat grid).
 * Numeric columns arrive as string | null (Drizzle numeric type convention).
 */
export async function listExecutionsByPeriodActivity(
  periodId: number,
  activity: string,
): Promise<ExecutionRecord[]> {
  const rows = await db
    .select({
      id: executions.id,
      planRowId: executions.planRowId,
      status: executions.status,
      unitNo: executions.unitNo,
      perUnitCost: executions.perUnitCost,
      totalCost: executions.totalCost,
      totalSqft: executions.totalSqft,
      fields: executions.fields,
      version: executions.version,
    })
    .from(executions)
    .innerJoin(planRows, eq(executions.planRowId, planRows.id))
    .where(
      and(
        eq(planRows.periodId, periodId),
        eq(planRows.activity, activity),
      ),
    )
    .orderBy(executions.planRowId, executions.id);

  return rows.map((r) => ({
    id: Number(r.id),
    planRowId: Number(r.planRowId),
    status: r.status,
    unitNo: r.unitNo,
    perUnitCost: r.perUnitCost,
    totalCost: r.totalCost,
    totalSqft: r.totalSqft,
    fields: r.fields as Record<string, unknown>,
    version: Number(r.version),
  }));
}

// ---------------------------------------------------------------------------
// listKitLines — load execution_items for a set of kit executions (POP/Dealer-Kit)
// so the grid can pre-populate the kit modal and show line counts on load. Without
// this, re-opening a saved kit shows no lines and a re-save (savePopKit = replace-all)
// would silently wipe them. Returns [] for an empty id set. Numeric cols arrive as
// STRING (Drizzle numeric) — the caller converts for display.
// ---------------------------------------------------------------------------

export type KitLineRecord = {
  executionId: number;
  itemName: string;
  qty: string;
  rate: string;
  lineTotal: string;
};

export async function listKitLines(
  executionIds: number[],
): Promise<KitLineRecord[]> {
  if (executionIds.length === 0) return [];
  const rows = await db
    .select({
      executionId: executionItems.executionId,
      itemName: executionItems.itemName,
      qty: executionItems.qty,
      rate: executionItems.rate,
      lineTotal: executionItems.lineTotal,
    })
    .from(executionItems)
    .where(inArray(executionItems.executionId, executionIds))
    .orderBy(executionItems.id);
  return rows.map((r) => ({
    executionId: Number(r.executionId),
    itemName: r.itemName,
    qty: r.qty,
    rate: r.rate,
    lineTotal: r.lineTotal,
  }));
}

// ---------------------------------------------------------------------------
// savePopKit — POP/Dealer-Kit: one execution ("kit") + N execution_items
// atomically (D3-13 / D3-14).
//
// Caller is responsible for the OUTER transaction. This function:
//   1. Inserts a new kit execution if executionId is null (first save).
//   2. Reuses the existing execution id otherwise.
//   3. DELETEs ALL prior execution_items for the kit (replace-all semantics).
//   4. Inserts the new lines (itemName is a TEXT SNAPSHOT, never an FK).
//   5. Returns the execution id.
// ---------------------------------------------------------------------------

export type PopLine = {
  itemName: string; // snapshot at entry (D-08), NOT an FK
  qty: number;
  rate: number;
  lineTotal: number; // Qty × Rate — computed app-side, persisted as string
};

/**
 * Write (or replace) a POP/Dealer-Kit execution + its line items.
 * Lines are replaced atomically (delete-then-insert inside the outer tx).
 * itemName is a text snapshot, not a foreign key to item_master.
 */
export async function savePopKit(
  tx: DbOrTx,
  planRowId: number,
  executionId: number | null,
  lines: PopLine[],
): Promise<number> {
  const kitTotal =
    lines.length > 0
      ? String(lines.reduce((sum, l) => sum + l.lineTotal, 0))
      : null;

  // Step 1: get or create the kit execution.
  const execId =
    executionId ??
    (await insertExecution(tx, {
      planRowId,
      fields: {},
      version: 0,
      totalCost: kitTotal,
    }));

  // Step 2: replace all prior execution_items (replace-all semantics, D3-14).
  await tx.delete(executionItems).where(eq(executionItems.executionId, execId));

  // Step 3: insert new lines (itemName is a SNAPSHOT text — store the name string).
  if (lines.length > 0) {
    await tx.insert(executionItems).values(
      lines.map((l) => ({
        executionId: execId,
        itemName: l.itemName,
        qty: String(l.qty),
        rate: String(l.rate),
        lineTotal: String(l.lineTotal),
      })),
    );
  }

  // Step 4: update the kit's totalCost to match the new line sum.
  if (executionId != null) {
    await tx
      .update(executions)
      .set({ totalCost: kitTotal, updatedAt: new Date() })
      .where(eq(executions.id, execId));
  }

  return execId;
}

// ---------------------------------------------------------------------------
// Test / smoke helpers — NEVER call from app code
// ---------------------------------------------------------------------------

/**
 * Test/smoke helper — wipes the execution_items table.
 *
 * MUST run BEFORE `_resetExecutionsForTest` because of the NOT NULL FK with
 * ON DELETE RESTRICT on `execution_items.execution_id`. A delete against
 * `executions` fails if any row has child execution_items.
 * NEVER call from app code.
 */
export async function _resetExecutionItemsForTest(): Promise<void> {
  await db.execute(sql`delete from execution_items`);
}

/**
 * Test/smoke helper — find an execution by plan_row_id.
 * Returns { id, version } or null. Used by e2e conflict tests to read a
 * known execution id+version for building stale-version payloads.
 * NEVER call from app code.
 */
export async function _findExecutionForTest(
  planRowId: number,
): Promise<{ id: number; version: number } | null> {
  const raw = await db.execute(
    sql`select id, version from executions where plan_row_id = ${planRowId} limit 1`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: number | string; version: number | string }>;
  const row = rows[0];
  if (!row) return null;
  return { id: Number(row.id), version: Number(row.version) };
}
