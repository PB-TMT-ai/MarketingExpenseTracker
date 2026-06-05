/**
 * Canonical types for the pure Excel I/O layer (Phase 2, Plan 02-01).
 *
 * This module is FRAMEWORK-FREE — no react, no next, no drizzle, no node built-ins —
 * so it can be imported from the browser parse path AND from vitest. Only `export type`
 * declarations live here; there is ZERO runtime code by design.
 *
 * Layering:
 *   - parse.ts → produces `ParsedRow` via `coerceCell`
 *   - validate.ts → emits `PreviewRow[]` with `Classification`s and `FieldError[]`s
 *   - Plan 02-02's Server Action upgrades "valid" → "update" by diffing against
 *     existing plan_rows in the DB. The "blocking" classification (SFID exists in
 *     the DB plan, absent from upload, has child executions) ALSO lives in the
 *     Server Action — never here, because that decision requires DB state.
 */

/**
 * The per-row taxonomy the BROWSER preview can decide on its own (no DB call):
 *
 *   - valid       → headers + every field parsed cleanly, no in-file duplicate
 *   - update      → set by Plan 02-02's Server Action when the SFID already exists in
 *                   plan_rows for this (period, activity); NOT emitted by buildPreview
 *   - duplicate   → the same SFID appears more than once in the uploaded file
 *   - fieldError  → required field missing OR coerceCell returned { ok: false } anywhere
 *
 * "blocking" is a fifth state that lives in the Server Action only — it depends on
 * `executions.plan_row_id` FK state which the browser cannot see. The union is kept
 * narrow here so the browser cannot accidentally claim a row is blocked.
 */
export type Classification = "valid" | "update" | "duplicate" | "fieldError";

/**
 * The canonical post-coerce row shape the parser emits and the Server Action consumes.
 *
 *   - `sfid`         → always present (the SFID column is required on every activity)
 *   - `sharedFields` → real-column routing (region/state/district/...); `FieldDef.shared === true`
 *   - `jsonbFields`  → goes into `plan_rows.fields` jsonb tail; everything else
 *   - `plannedCost`  → routed to the real `plan_rows.planned_cost numeric(14,2)` column.
 *                      Nullable: dealer-certificate / gsb / nlb do not list a planned-cost
 *                      column in the registry, so those activities store `null`.
 */
export type ParsedRow = {
  readonly sfid: string;
  readonly sharedFields: Readonly<Record<string, string | null>>;
  readonly jsonbFields: Readonly<Record<string, string | number | null>>;
  readonly plannedCost: number | null;
};

/**
 * One per-row coercion failure surfaced by the preview. Multiple may appear on a single
 * PreviewRow (e.g. row 17 has both a missing required field AND a malformed date).
 */
export type FieldError = {
  readonly col: string;
  readonly rawValue: unknown;
  readonly reason: string;
};

/**
 * Header-row mismatch error variants. Lenient match per D2-03 = case-insensitive +
 * whitespace-trim, ordered comparison against `ActivityConfig.planColumns[i].label`.
 *
 *   - missing   → an expected label is absent (after normalization)
 *   - extra     → an unexpected label is present
 *   - mismatch  → length matches and set matches, but order differs
 */
export type HeaderError = {
  readonly kind: "missing" | "extra" | "mismatch";
  readonly expected: readonly string[];
  readonly got: readonly string[];
  readonly details?: string;
};

/**
 * One preview-table row: the human-visible row number (Excel-1-indexed, so the first
 * data row is 2), the local classification, the parsed payload (null on fieldError),
 * and the list of per-field errors that pushed it into fieldError state.
 */
export type PreviewRow = {
  readonly rowNumber: number;
  readonly classification: Classification;
  readonly sfid: string | null;
  readonly parsed: ParsedRow | null;
  readonly errors: readonly FieldError[];
};
