/**
 * coerceForKind — per-column type coercion for the GRID-13 paste-block handler.
 *
 * PURE module — imports ONLY the `num` primitive from ./calc and a type from ../activities.
 * No React, no AG Grid, no DB — unit-testable in isolation.
 *
 * Pasting from Excel/Sheets gives every cell as a raw text/plain string. Before a pasted
 * value is written into a UnitRow's fields.*, it must be coerced to match the target
 * column's FieldDef.kind — but ONLY where coercion is safe:
 *
 *   - number / currency → num(raw): strips ₹/commas → number|null (reuses calc.ts so the
 *     paste path and the derive engine share ONE numeric primitive, no drift).
 *   - date → DD/MM/YY string AS-IS. Phase 2 D2 locked DD/MM/YY as canonical Indian input;
 *     ISO (YYYY-MM-DD) is REJECTED downstream. NEVER convert a pasted date to ISO here.
 *   - lat / long → string AS-IS. Coordinates are stored as decimal STRINGS (existing
 *     PITFALL: numeric-coercing "19.0760" would drop precision / trailing zeros). NEVER
 *     numeric-coerce a coordinate.
 *   - text → string as-is.
 *   - status / enum → string as-is. The paste stays FORGIVING — membership against
 *     enumValues is validated by the next save's server-side Zod, not at paste time.
 */

import { num } from "./calc";
import type { FieldDef } from "../activities/types";

/**
 * Coerce a raw pasted cell string to the value shape expected for `kind`.
 *
 * @param raw  - the raw text/plain cell value from the clipboard TSV
 * @param kind - the target column's FieldDef.kind
 * @returns number|null for number/currency; the raw string (as-is) for every other kind
 */
export function coerceForKind(raw: string, kind: FieldDef["kind"]): unknown {
  switch (kind) {
    case "number":
    case "currency":
      // Reuse calc.ts num() — strips ₹/commas/whitespace → number|null (never NaN).
      return num(raw);

    case "date":
      // DD/MM/YY passthrough — NEVER convert to ISO (Phase 2 D2 locked).
      return raw;

    case "lat":
    case "long":
      // Coordinates stay decimal strings — NEVER numeric-coerce (precision PITFALL).
      return raw;

    case "status":
    case "enum":
      // As-is; server-side Zod validates membership on the next save (keep paste forgiving).
      return raw;

    case "text":
    default:
      // Free-form text (and any unmapped kind) → as-is string. Safe default: no coercion.
      return raw;
  }
}
