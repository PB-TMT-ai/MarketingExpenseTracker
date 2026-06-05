import { getActivePeriodRow, type PeriodRow } from "../db/periods";

/**
 * The PRD-02 scoping seam. Phase-2+ subsystems (plan upload, grid, dashboard) call this
 * to know which `period_id` to filter all reads on (`WHERE period_id = active.id`). Lives
 * in a separate module so the seam can be replaced or memoized without touching db code.
 */
export async function getActivePeriod(): Promise<PeriodRow | null> {
  return getActivePeriodRow();
}
