/**
 * Pure derive engine for the actuals grid.
 *
 * PURE module — imports ONLY `import type` from ../activities/types.
 * NO react, NO next, NO drizzle, NO db.
 * Importable from both the client grid and the server-side trust-recompute in lib/actions/executions.ts.
 *
 * Formulas are LOCKED by D3-04:
 *   - counter-wall: totalSqft is ENTERED (not derived → returns null); totalCost = actualSqft × perUnitCost
 *   - in-shop:      totalSqft = length × breadth; totalCost = totalSqft × perUnitCost
 *   - gsb / nlb:    totalSqft = length × breadth (HEIGHT IS EXCLUDED — stored for reference only);
 *                   totalCost = totalSqft × perUnitCost
 *   - pop-dealer-kit: lineTotal = qty × rate
 *   - dealer-certificate: no derived fields
 *
 * Sticky-override semantics (D3-05):
 *   - isOverridden(f, key) — reads f.__overrides?.[key] === true
 *   - setOverride(f, key, on) — sets the flag (true = override, false = formula)
 *   - clearOverride(f, key) — removes the flag entirely
 *   The totalCost composition path: when totalSqft is overridden, totalCost uses the stored
 *   fields.totalSqft rather than re-deriving it (correct compositional behaviour).
 */

// type-only import — no runtime dependency on the activities module
import type {} from "../activities/types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Strip ₹, commas, and whitespace then coerce to a finite number.
 * Returns null (not NaN) when the value is absent, empty, or non-numeric.
 */
function num(v: unknown): number | null {
  if (v == null) return null;
  const s = typeof v === "string" ? v.replace(/[₹,\s]/g, "") : String(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Round to 2 decimal places (half-up) applied ONCE at each product boundary.
 * Prevents the 0.1+0.2 drift that accumulates when left unrounded.
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Override helpers (D3-05)
// ---------------------------------------------------------------------------

/**
 * Returns true when the user has manually overridden the derived value for `key`.
 * Reads the __overrides sub-object on the fields record.
 */
export function isOverridden(f: Record<string, unknown>, key: string): boolean {
  const overrides = f.__overrides;
  if (overrides == null || typeof overrides !== "object") return false;
  return (overrides as Record<string, unknown>)[key] === true;
}

/**
 * Set or clear the per-key override flag.
 * Mutates `f` in-place — the caller (valueSetter or reset handler) owns the row copy.
 */
export function setOverride(
  f: Record<string, unknown>,
  key: string,
  on: boolean,
): void {
  if (f.__overrides == null || typeof f.__overrides !== "object") {
    f.__overrides = {};
  }
  (f.__overrides as Record<string, unknown>)[key] = on;
}

/**
 * Remove the override flag for `key` (restores formula behaviour).
 */
export function clearOverride(f: Record<string, unknown>, key: string): void {
  if (f.__overrides == null || typeof f.__overrides !== "object") return;
  delete (f.__overrides as Record<string, unknown>)[key];
}

// ---------------------------------------------------------------------------
// computeDerived — the locked D3-04 formula engine
// ---------------------------------------------------------------------------

/**
 * Compute the derived value for a given field key within an activity's unit fields.
 *
 * @param activityKey - registry key, e.g. "gsb", "in-shop", "counter-wall"
 * @param key         - the derived field key, e.g. "totalSqft" | "totalCost" | "lineTotal"
 * @param f           - the current unit fields record (may contain nested __overrides)
 * @returns number if computable, null if any required input is missing/non-numeric
 *
 * CRITICAL:
 *   - gsb/nlb totalSqft = length × breadth ONLY — height is excluded from area (D3-04)
 *   - counter-wall has no derived totalSqft — entering it directly; returns null
 *   - totalCost composition: when totalSqft is overridden, use stored value; else re-derive
 *   - All results are round2'd at the product boundary (2 dp, half-up)
 */
export function computeDerived(
  activityKey: string,
  key: string,
  f: Record<string, unknown>,
): number | null {
  // ------------------------------------------------------------------
  // totalSqft
  // ------------------------------------------------------------------
  if (key === "totalSqft") {
    if (activityKey === "counter-wall") {
      // counter-wall actualSqft is ENTERED by the user, not derived.
      // Return null so the grid leaves the cell editable rather than formula-filling it.
      return null;
    }
    if (
      activityKey === "in-shop" ||
      activityKey === "gsb" ||
      activityKey === "nlb"
    ) {
      // D3-04 CRITICAL: totalSqft = length × breadth
      // HEIGHT IS EXCLUDED from the area calculation (stored for reference only).
      // gsb/nlb computeFrom lists height so the grid refreshes when height changes,
      // but the formula must NOT multiply by height.
      const l = num(f["length"]);
      const b = num(f["breadth"]);
      if (l === null || b === null) return null;
      return round2(l * b);
    }
    // All other activities: no totalSqft derivation
    return null;
  }

  // ------------------------------------------------------------------
  // totalCost — Total Sq Ft × Per-unit cost
  // ------------------------------------------------------------------
  if (key === "totalCost") {
    const pu = num(f["perUnitCost"]);
    if (pu === null) return null;

    // counter-wall: totalCost = actualSqft (entered) × perUnitCost
    // The "sqft" for counter-wall is the directly-entered actualSqft, not a derived field.
    if (activityKey === "counter-wall") {
      const sqft = num(f["actualSqft"]);
      if (sqft === null) return null;
      return round2(sqft * pu);
    }

    // All other activities: totalCost = totalSqft × perUnitCost.
    // Determine the sqft value to use:
    //   - if totalSqft is overridden → use the stored value
    //   - otherwise → re-derive it via computeDerived (composition)
    let sqft: number | null;
    if (isOverridden(f, "totalSqft")) {
      sqft = num(f["totalSqft"]);
    } else {
      sqft = computeDerived(activityKey, "totalSqft", f);
    }
    if (sqft === null) return null;
    return round2(sqft * pu);
  }

  // ------------------------------------------------------------------
  // lineTotal — POP / Dealer-Kit: Qty × Rate
  // ------------------------------------------------------------------
  if (key === "lineTotal") {
    const q = num(f["qty"]);
    const r = num(f["rate"]);
    if (q === null || r === null) return null;
    return round2(q * r);
  }

  // ------------------------------------------------------------------
  // Unknown key
  // ------------------------------------------------------------------
  return null;
}
