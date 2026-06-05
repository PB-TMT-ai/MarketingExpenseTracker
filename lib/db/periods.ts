import { desc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { periods } from "./schema";

/**
 * Typed query helpers for the `periods` table. NO business rules live here — the
 * "exactly one active period" invariant (D-11) is enforced inside `setActiveTx` by
 * transactionally clearing every row's `is_active` before setting the target's, so
 * even a concurrent reader can never observe two active rows.
 */

export type PeriodRow = {
  id: number;
  type: "month" | "quarter" | "fy";
  label: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  createdAt: Date;
};

export type NewPeriod = {
  type: "month" | "quarter" | "fy";
  label: string;
  startDate: string;
  endDate: string;
};

export async function listPeriods(): Promise<PeriodRow[]> {
  const rows = await db.select().from(periods).orderBy(desc(periods.createdAt));
  return rows as PeriodRow[];
}

export async function insertPeriod(values: NewPeriod): Promise<number> {
  const [row] = await db
    .insert(periods)
    .values({
      type: values.type,
      label: values.label,
      startDate: values.startDate,
      endDate: values.endDate,
      // is_active stays false by default; setActiveTx is the only path to true.
    })
    .returning();
  return Number((row as { id: number | string }).id);
}

export async function getActivePeriodRow(): Promise<PeriodRow | null> {
  const [row] = await db
    .select()
    .from(periods)
    .where(eq(periods.isActive, true))
    .limit(1);
  return (row as PeriodRow | undefined) ?? null;
}

/**
 * D-11: leaves EXACTLY ONE row with is_active=true, transactionally. The clear-all then
 * set-one order is correct under MVCC — a concurrent reader sees either the pre-state
 * (zero or one active) or the post-state (exactly one active), never two.
 */
export async function setActiveTx(id: number): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(periods)
      .set({ isActive: false })
      .where(eq(periods.isActive, true));
    await tx.update(periods).set({ isActive: true }).where(eq(periods.id, id));
  });
}

/**
 * Test/smoke helper — wipes the periods table. NEVER call from app code (the off-plan
 * guard depends on plan_rows referencing real periods; truncating would orphan them).
 */
export async function _resetPeriodsForTest(): Promise<void> {
  await db.execute(sql`delete from periods`);
}
