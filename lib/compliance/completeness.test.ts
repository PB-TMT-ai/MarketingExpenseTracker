/**
 * Tests for lib/compliance/completeness.ts — the single source of truth for
 * % executed and % cancelled math (D-05).
 *
 * Locks the asymmetric-denominator spec (D-03 vs D-04):
 *   - % executed:  denominator EXCLUDES cancelled units
 *   - % cancelled: denominator INCLUDES cancelled units
 *
 * Pure unit tests — no DB, no React, no mocks.
 */
import { describe, it, expect } from "vitest";
import { computeCompleteness } from "./completeness";
import type { CompletenessInput, Completeness } from "./completeness";

function makeInput(
  partial: Partial<CompletenessInput> = {},
): CompletenessInput {
  return {
    plannedUnits: 0,
    executedUnits: 0,
    cancelledUnits: 0,
    ...partial,
  };
}

describe("computeCompleteness — asymmetric denominators (D-03 vs D-04)", () => {
  it("spec example: {planned:10, executed:6, cancelled:2} → {pctExecuted:0.75, pctCancelled:0.20, effectiveDenominator:8}", () => {
    // % executed = 6 / (10-2) = 6/8 = 0.75
    // % cancelled = 2 / 10 = 0.20
    expect(
      computeCompleteness({ plannedUnits: 10, executedUnits: 6, cancelledUnits: 2 }),
    ).toEqual({ pctExecuted: 0.75, pctCancelled: 0.2, effectiveDenominator: 8 });
  });

  it("zero plan: {0,0,0} returns all zeros (no division by zero)", () => {
    const out: Completeness = computeCompleteness(makeInput());
    expect(out).toEqual({ pctExecuted: 0, pctCancelled: 0, effectiveDenominator: 0 });
  });

  it("all cancelled: {planned:5, executed:0, cancelled:5} → pctExecuted:0, pctCancelled:1, effectiveDenominator:0", () => {
    // denom collapses to 0, executed/0 short-circuits to 0 (no NaN/Infinity)
    expect(
      computeCompleteness({ plannedUnits: 5, executedUnits: 0, cancelledUnits: 5 }),
    ).toEqual({ pctExecuted: 0, pctCancelled: 1, effectiveDenominator: 0 });
  });

  it("fully executed: {planned:5, executed:5, cancelled:0} → pctExecuted:1, pctCancelled:0, effectiveDenominator:5", () => {
    expect(
      computeCompleteness({ plannedUnits: 5, executedUnits: 5, cancelledUnits: 0 }),
    ).toEqual({ pctExecuted: 1, pctCancelled: 0, effectiveDenominator: 5 });
  });
});

describe("computeCompleteness — edge cases", () => {
  it("planned=0 returns all zeros (no division by zero on the cancelled side either)", () => {
    expect(computeCompleteness({ plannedUnits: 0, executedUnits: 0, cancelledUnits: 0 })).toEqual({
      pctExecuted: 0,
      pctCancelled: 0,
      effectiveDenominator: 0,
    });
  });

  it("planned == cancelled: pctCancelled=1, pctExecuted=0 (denominator collapses)", () => {
    expect(computeCompleteness({ plannedUnits: 7, executedUnits: 0, cancelledUnits: 7 })).toEqual({
      pctExecuted: 0,
      pctCancelled: 1,
      effectiveDenominator: 0,
    });
  });

  it("executed > planned-cancelled: pctExecuted reports raw ratio > 1 without clamping (pure math; display-side rounds)", () => {
    // {planned:5, executed:6, cancelled:1} → denom=4, exec/denom = 1.5
    const out = computeCompleteness({
      plannedUnits: 5,
      executedUnits: 6,
      cancelledUnits: 1,
    });
    expect(out.pctExecuted).toBe(1.5);
    expect(out.effectiveDenominator).toBe(4);
    expect(out.pctCancelled).toBe(0.2);
  });

  it("is a pure function — same input yields same output across calls", () => {
    const input: CompletenessInput = {
      plannedUnits: 10,
      executedUnits: 6,
      cancelledUnits: 2,
    };
    const a = computeCompleteness(input);
    const b = computeCompleteness(input);
    expect(a).toEqual(b);
  });
});

describe("computeCompleteness — barrel export", () => {
  it("re-exported from lib/compliance/index.ts", async () => {
    const mod = await import("./index");
    expect(typeof mod.computeCompleteness).toBe("function");
  });
});
