/**
 * Single-source-of-truth completeness math (D-05). Imported by the dashboard,
 * the grid stat strip, and the future Phase 5 export — every "% executed" the
 * user sees runs through this one pure function.
 *
 * The asymmetric-denominator spec (D-03 vs D-04):
 *   - `pctExecuted` denominator EXCLUDES cancelled units (cancelled work doesn't count).
 *   - `pctCancelled` denominator INCLUDES cancelled units (against the ORIGINAL plan,
 *     so the user can see what fraction of the plan was abandoned).
 *
 * Spec example (D-04): {planned:10, executed:6, cancelled:2}
 *   → effectiveDenominator = 8
 *   → pctExecuted = 6/8 = 0.75
 *   → pctCancelled = 2/10 = 0.20
 *
 * NOTE: This file's canonical definition is owned by Plan 04-01. Plan 04-02 needs
 * it for the D-04 round-trip test (Task 2 Test 3). When 04-01's worktree merges
 * the two files will be identical-by-spec.
 */

export type CompletenessInput = {
  plannedUnits: number;
  executedUnits: number;
  cancelledUnits: number;
};

export type Completeness = {
  pctExecuted: number;
  pctCancelled: number;
  effectiveDenominator: number;
};

export function computeCompleteness(input: CompletenessInput): Completeness {
  const { plannedUnits, executedUnits, cancelledUnits } = input;
  const effectiveDenominator = Math.max(0, plannedUnits - cancelledUnits);
  const pctExecuted =
    effectiveDenominator === 0 ? 0 : executedUnits / effectiveDenominator;
  const pctCancelled = plannedUnits === 0 ? 0 : cancelledUnits / plannedUnits;
  return { pctExecuted, pctCancelled, effectiveDenominator };
}
