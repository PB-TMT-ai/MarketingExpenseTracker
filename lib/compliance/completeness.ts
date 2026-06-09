/**
 * Shared completeness math — the SINGLE SOURCE OF TRUTH (D-05) for
 * % executed and % cancelled across the dashboard cards (Phase 4),
 * the future grid stat strip, and the Phase 5 export.
 *
 * PURE module — framework-free. No React, no Drizzle, no DB.
 *
 * Decision references:
 *   D-01: % executed is units-based (sum executed / sum planned in scope).
 *   D-02: numerator counts only status='Done' (Pending / In Progress excluded).
 *   D-03: % executed denominator EXCLUDES Cancelled — a cancelled unit doesn't
 *         count as work owed.
 *   D-04: % cancelled denominator INCLUDES Cancelled — "what fraction of the
 *         original plan was abandoned" is reported against the ORIGINAL planned
 *         total.
 *   D-05: Implemented once, here. Grid, dashboard, and export must never
 *         disagree about these numbers.
 *
 * The asymmetry in D-03 vs D-04 is INTENTIONAL. Do not normalize the two
 * denominators to match. Display-side rounding (e.g. percentage formatting) is
 * the consumer's responsibility — this module returns raw ratios.
 */

export type CompletenessInput = {
  readonly plannedUnits: number;
  readonly executedUnits: number;
  readonly cancelledUnits: number;
};

export type Completeness = {
  readonly pctExecuted: number;
  readonly pctCancelled: number;
  readonly effectiveDenominator: number;
};

export function computeCompleteness(input: CompletenessInput): Completeness {
  const { plannedUnits, executedUnits, cancelledUnits } = input;
  // D-03: cancelled units leave the denominator for % executed.
  const effectiveDenominator = Math.max(0, plannedUnits - cancelledUnits);
  const pctExecuted = effectiveDenominator === 0 ? 0 : executedUnits / effectiveDenominator;
  // D-04: % cancelled reports against the original plan, so denominator INCLUDES cancelled.
  const pctCancelled = plannedUnits === 0 ? 0 : cancelledUnits / plannedUnits;
  return { pctExecuted, pctCancelled, effectiveDenominator };
}
