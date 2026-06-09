/**
 * Pure header-check + per-row preview classification for the .xlsx import path.
 *
 * Layering (D2-06): runs CLIENT-SIDE inside the browser parse pipeline. The
 * Server Action in Plan 02-02 takes this preview, re-validates, and adds the
 * two DB-dependent classifications:
 *   - "update"   — SFID already exists in plan_rows for (period, activity)
 *   - "blocking" — SFID exists in DB but absent from upload AND has child executions
 *
 * Framework-free: only imports the activity types and the local `types.ts`.
 * Runs unchanged in browser and vitest.
 */

import type { FieldDef } from "../activities/types";
import type {
  Classification,
  FieldError,
  HeaderError,
  ParsedRow,
  PreviewRow,
} from "./types";
import type { coerceCell as CoerceCellFn } from "./parse";

/** Normalize per D2-03: lowercase + trim whitespace. NO per-field aliasing (deferred). */
function normalize(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

/**
 * Compare an incoming header row to `planColumns[i].label` per D2-03.
 *
 * Returns `null` on match (case-insensitive + whitespace-trim, ordered).
 * Returns a HeaderError describing the kind of disagreement otherwise:
 *
 *   - missing  → set(expected) - set(got) is non-empty
 *   - extra    → set(got) - set(expected) is non-empty
 *   - mismatch → length matches AND set matches, but ORDER differs
 *
 * The kind is computed in priority order: missing → extra → mismatch. (We could
 * surface multiple errors, but the preview UI only needs one to tell the user
 * "your headers are wrong, here's why".)
 */
export function validateHeaders(
  headerRow: readonly unknown[],
  planColumns: readonly FieldDef[],
): HeaderError | null {
  const expectedRaw = planColumns.map((c) => c.label);
  const gotRaw = headerRow.map((h) => String(h ?? ""));

  const expectedN = expectedRaw.map(normalize);
  const gotN = gotRaw.map(normalize);

  const expectedSet = new Set(expectedN);
  const gotSet = new Set(gotN);

  // missing: any expected label not present in the got set
  const missing = expectedN.filter((e) => !gotSet.has(e));
  if (missing.length > 0) {
    return {
      kind: "missing",
      expected: expectedRaw,
      got: gotRaw,
      details: `Missing columns: ${missing.join(", ")}`,
    };
  }

  // extra: any got label not present in the expected set
  const extra = gotN.filter((g) => !expectedSet.has(g));
  if (extra.length > 0) {
    return {
      kind: "extra",
      expected: expectedRaw,
      got: gotRaw,
      details: `Unexpected columns: ${extra.join(", ")}`,
    };
  }

  // sets match and lengths match — now check order. (If lengths differ but sets
  // are equal, that's impossible after a set match, so length equality is
  // already implied here.)
  for (let i = 0; i < expectedN.length; i++) {
    if (expectedN[i] !== gotN[i]) {
      return {
        kind: "mismatch",
        expected: expectedRaw,
        got: gotRaw,
        details: `Column ${i + 1} should be "${expectedRaw[i]}" but got "${gotRaw[i]}"`,
      };
    }
  }

  return null;
}

/**
 * Per-row classification (browser-local). Iterates data rows (skipping the
 * header at index 0), parses each cell through `coerce` against the matching
 * planColumns FieldDef, routes values into shared vs jsonb buckets via
 * `FieldDef.shared`, and assigns one of three classifications:
 *
 *   - fieldError  → any cell coerce failure OR a required FieldDef is null
 *   - duplicate   → the same sfid appears more than once in this file (set in a
 *                   second pass; fieldError wins if a row has both problems)
 *   - valid       → everything else
 *
 * rowNumber is Excel-1-indexed: the first data row (input index 1) becomes
 * rowNumber 2, matching what the user sees in the gridlines of their .xlsx.
 *
 * The `coerce` function is injected (not imported directly) so the test suite
 * can swap in stubs and so this module stays decoupled from the SheetJS-pulling
 * parse.ts at the type level.
 */
export function buildPreview(
  rows: readonly unknown[][],
  planColumns: readonly FieldDef[],
  coerce: typeof CoerceCellFn,
  existingSfids?: Set<string>,
): PreviewRow[] {
  // Defensive: locate the SFID column index (the registry always has one for
  // all six activities, but if a 7th activity were registered without an sfid
  // column, we want to surface that as a single fieldError row rather than
  // crash with an undefined index.)
  const sfidIdx = planColumns.findIndex((f) => f.key === "sfid");
  if (sfidIdx === -1) {
    return [
      {
        rowNumber: 0,
        classification: "fieldError",
        sfid: null,
        parsed: null,
        errors: [
          {
            col: "(activity config)",
            rawValue: null,
            reason: "Activity has no SFID column in its planColumns config",
          },
        ],
      },
    ];
  }

  // Plan-cost routing: if any FieldDef has key === "plannedCost", use that index
  // for ParsedRow.plannedCost. Otherwise stay null (counter-wall has planSqft,
  // not plannedCost; dealer-cert / gsb / nlb don't list a cost column at all).
  const plannedCostIdx = planColumns.findIndex((f) => f.key === "plannedCost");

  // First pass: parse and classify per-row in isolation
  const out: PreviewRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 1; // data row 0 (index 1) → Excel row 2
    const errors: FieldError[] = [];
    const sharedFields: Record<string, string | null> = {};
    const jsonbFields: Record<string, string | number | null> = {};
    let plannedCost: number | null = null;
    let sfidValue: string | null = null;

    for (let c = 0; c < planColumns.length; c++) {
      const field = planColumns[c];
      const cell = row[c];
      const result = coerce(cell, field);

      if (!result.ok) {
        errors.push({ col: field.label, rawValue: cell, reason: result.error });
        continue;
      }

      const value = result.value;

      // Required check: required field with null after coerce → fieldError
      if (field.required && value === null) {
        errors.push({
          col: field.label,
          rawValue: cell,
          reason: `${field.label} is required`,
        });
        continue;
      }

      // Capture sfid before routing — it's a shared field too, but we want a
      // top-level string copy for duplicate detection.
      if (c === sfidIdx && typeof value === "string") {
        sfidValue = value;
      }

      // Capture plannedCost separately (real column on plan_rows)
      if (plannedCostIdx !== -1 && c === plannedCostIdx) {
        plannedCost = typeof value === "number" ? value : null;
        continue; // plannedCost is its own real column, do NOT also route into shared/jsonb
      }

      // Route shared vs jsonb. Shared fields store strings (real text columns
      // on plan_rows: region/state/...); jsonb tail can hold strings or numbers.
      if (field.shared === true) {
        sharedFields[field.key] = typeof value === "string" ? value : value === null ? null : String(value);
      } else {
        jsonbFields[field.key] = value;
      }
    }

    let classification: Classification;
    let parsed: ParsedRow | null;

    if (errors.length > 0) {
      classification = "fieldError";
      parsed = null;
    } else {
      classification = "valid";
      // sfidValue is guaranteed non-null here because sfid is required on every
      // current activity AND the required check above caught the null path.
      parsed = {
        sfid: sfidValue ?? "",
        sharedFields,
        jsonbFields,
        plannedCost,
      };
    }

    out.push({
      rowNumber,
      classification,
      sfid: sfidValue,
      parsed,
      errors,
    });
  }

  // Update pass: classify rows whose SFID exists in the DB as "update" (DB-aware
  // classification provided by the upload form fetching existing SFIDs before preview).
  // fieldError takes priority — only "valid" rows get reclassified.
  const afterUpdate: PreviewRow[] =
    existingSfids && existingSfids.size > 0
      ? out.map((p) =>
          p.classification === "valid" && p.sfid !== null && existingSfids.has(p.sfid)
            ? { ...p, classification: "update" as Classification }
            : p,
        )
      : out;

  // Second pass: mark duplicate SFIDs (in-file). fieldError wins over duplicate.
  const sfidCounts = new Map<string, number>();
  for (const p of afterUpdate) {
    if (p.sfid !== null) {
      sfidCounts.set(p.sfid, (sfidCounts.get(p.sfid) ?? 0) + 1);
    }
  }
  return afterUpdate.map((p) => {
    if (
      p.classification !== "fieldError" &&
      p.sfid !== null &&
      (sfidCounts.get(p.sfid) ?? 0) > 1
    ) {
      return { ...p, classification: "duplicate" as Classification };
    }
    return p;
  });
}
