import { and, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { rowCountOf } from "./executions";
import { adhocExpenses } from "./schema";

/**
 * Adhoc expenses DAL — read + upsert with optimistic concurrency.
 *
 * - `listAdhocByPeriod`: full row list, ordered by activityDate desc nulls last, id desc.
 * - `upsertAdhocBatch`: single transaction. Inserts (id==null) get version=0. Updates
 *   apply `WHERE id=? AND version=?`; mismatches are collected to `conflicts` (not thrown).
 *   Mirrors saveExecutionsBatch's partial-success semantics (D3-11).
 * - `_resetAdhocForTest`: vitest beforeEach helper.
 */

export type AdhocRow = {
  id: number;
  periodId: number;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  activity: string | null;
  activityDate: string | null;
  budgetHeader: string | null;
  expenseAmount: string | null;
  vendorName: string | null;
  remarks: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AdhocInput = {
  id: number | null;
  periodId: number;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  activity: string | null;
  activityDate: string | null;
  budgetHeader: string | null;
  expenseAmount: string | null;
  vendorName: string | null;
  remarks: string | null;
  version: number;
};

export type AdhocBatchResult = {
  inserted: number;
  updated: number;
  conflicts: { id: number; serverVersion: number }[];
};

export async function listAdhocByPeriod(periodId: number): Promise<AdhocRow[]> {
  const rows = await db
    .select()
    .from(adhocExpenses)
    .where(eq(adhocExpenses.periodId, periodId))
    .orderBy(
      sql`${adhocExpenses.activityDate} desc nulls last, ${adhocExpenses.id} desc`,
    );

  return rows.map((r) => ({
    id: r.id,
    periodId: r.periodId,
    region: r.region,
    state: r.state,
    district: r.district,
    taluka: r.taluka,
    activity: r.activity,
    activityDate: r.activityDate,
    budgetHeader: r.budgetHeader,
    expenseAmount: r.expenseAmount,
    vendorName: r.vendorName,
    remarks: r.remarks,
    version: r.version,
    createdAt: r.createdAt as Date,
    updatedAt: r.updatedAt as Date,
  }));
}

export async function upsertAdhocBatch(
  inputs: AdhocInput[],
): Promise<AdhocBatchResult> {
  const result: AdhocBatchResult = { inserted: 0, updated: 0, conflicts: [] };

  await db.transaction(async (tx) => {
    for (const input of inputs) {
      if (input.id == null) {
        await tx.insert(adhocExpenses).values({
          periodId: input.periodId,
          region: input.region,
          state: input.state,
          district: input.district,
          taluka: input.taluka,
          activity: input.activity,
          activityDate: input.activityDate,
          budgetHeader: input.budgetHeader,
          expenseAmount: input.expenseAmount,
          vendorName: input.vendorName,
          remarks: input.remarks,
          version: 0,
        });
        result.inserted += 1;
      } else {
        const res = await tx
          .update(adhocExpenses)
          .set({
            region: input.region,
            state: input.state,
            district: input.district,
            taluka: input.taluka,
            activity: input.activity,
            activityDate: input.activityDate,
            budgetHeader: input.budgetHeader,
            expenseAmount: input.expenseAmount,
            vendorName: input.vendorName,
            remarks: input.remarks,
            version: input.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(adhocExpenses.id, input.id),
              eq(adhocExpenses.version, input.version),
            ),
          );

        if (rowCountOf(res) === 0) {
          const [current] = await tx
            .select({ version: adhocExpenses.version })
            .from(adhocExpenses)
            .where(eq(adhocExpenses.id, input.id));
          result.conflicts.push({
            id: input.id,
            serverVersion: current?.version ?? -1,
          });
        } else {
          result.updated += 1;
        }
      }
    }
  });

  return result;
}

/** Test helper — wipes the table. Vitest beforeEach uses this. */
export async function _resetAdhocForTest(): Promise<void> {
  await db.execute(sql`delete from adhoc_expenses`);
}
