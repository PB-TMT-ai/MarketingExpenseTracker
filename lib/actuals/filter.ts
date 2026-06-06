/**
 * Pure cascading filter derivation and SFID predicate for the actuals grid.
 *
 * PURE module — imports only `import type` from ./rows.
 * No React, no AG Grid runtime, no DB.
 *
 * Design (D3-06 / D3-07 / D3-08):
 *   - Custom filter bar with multi-select dropdowns for Region/State/District/Distributor/Status
 *   - Options derived from the loaded client-side rows (no server round-trip needed at ≤1k rows)
 *   - Location filters cascade: Region → State → District (each narrows the downstream options)
 *   - Distributor and Status are independent (not part of the geographic cascade)
 *   - SFID search is a dedicated predicate on plan.sfid ONLY (A6 fix — not a quickFilter)
 *
 * Usage in the AG Grid component:
 *   - Derive option lists: optionsFor(allRows, "state", { region: selectedRegions })
 *   - Apply filter: doesExternalFilterPass = (node) => matchesFacets(node.data, selected)
 *                   AND matchesSfid(node.data, sfidSearch)
 */

import type { UnitRow } from "./rows";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The facet keys supported by the custom filter bar.
 * Location facets (region/state/district/distributor) read from row.plan.
 * status reads from row.fields.
 */
export type FacetKey = "region" | "state" | "district" | "distributor" | "status";

/**
 * Upstream selections passed to optionsFor to cascade (narrow) option lists.
 * An empty array for a key means "no constraint for that facet."
 */
export type UpstreamSelections = Partial<Record<FacetKey, string[]>>;

/**
 * The active facet selections for matchesFacets.
 * An absent key or an empty array means "no constraint."
 */
export type FacetSelections = Partial<Record<FacetKey, string[]>>;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Get the string value of a facet from a row.
 * Location facets (region/state/district/distributor) come from row.plan.
 * Status comes from row.fields.
 */
function rowValueFor(row: UnitRow, facet: FacetKey): string | null {
  if (facet === "status") {
    const v = row.fields["status"];
    return v != null ? String(v) : null;
  }
  const v = row.plan[facet];
  return v != null && v !== "" ? String(v) : null;
}

/**
 * Test whether a row passes all upstream facet selections (for cascade narrowing).
 * An absent key or empty array = no constraint.
 */
function passesUpstream(row: UnitRow, upstream: UpstreamSelections): boolean {
  for (const [key, vals] of Object.entries(upstream)) {
    if (!vals || vals.length === 0) continue; // empty = no constraint
    const rv = rowValueFor(row, key as FacetKey);
    if (rv == null || !vals.includes(rv)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// optionsFor
// ---------------------------------------------------------------------------

/**
 * Derive sorted unique non-empty option values for `col` from the loaded rows,
 * narrowed by the upstream facet selections (cascade).
 *
 * Cascade order: Region → State → District (geographic hierarchy per D3-07).
 * Distributor and Status are independent facets.
 *
 * @param rows     - All loaded rows for the current period+activity
 * @param col      - The facet column to derive options for
 * @param upstream - Already-selected upstream facets (narrows downstream options)
 * @returns Sorted, unique, non-empty option strings
 */
export function optionsFor(
  rows: UnitRow[],
  col: string,
  upstream: UpstreamSelections,
): string[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (!passesUpstream(row, upstream)) continue;
    const v = rowValueFor(row, col as FacetKey);
    if (v != null && v !== "") seen.add(v);
  }
  return [...seen].sort();
}

// ---------------------------------------------------------------------------
// matchesFacets
// ---------------------------------------------------------------------------

/**
 * Test whether a row passes all active facet selections.
 *
 * Location facets (region/state/district/distributor) are checked against row.plan.
 * Status is checked against row.fields.status.
 *
 * An absent or empty selection for a facet means "no constraint" (passes all).
 * This is the body of AG Grid's doesExternalFilterPass callback, kept pure here
 * so it can be unit-tested without a grid instance.
 *
 * @param row      - The UnitRow to test
 * @param selected - Active facet selections (Partial<Record<FacetKey, string[]>>)
 * @returns true if the row passes all active facets; false otherwise
 */
export function matchesFacets(row: UnitRow, selected: FacetSelections): boolean {
  for (const [key, vals] of Object.entries(selected)) {
    if (!vals || vals.length === 0) continue; // empty = no constraint
    const rv = rowValueFor(row, key as FacetKey);
    if (rv == null || !vals.includes(rv)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// matchesSfid
// ---------------------------------------------------------------------------

/**
 * Case-insensitive substring/prefix match on row.plan.sfid ONLY.
 *
 * A6 dedicated predicate: unlike quickFilterText which scans all rendered cells,
 * this predicate is scoped to plan.sfid so it never creates false matches against
 * region names, dealer names, or other columns that happen to contain the search string.
 *
 * @param row    - The UnitRow to test
 * @param search - The SFID search string (trimmed before comparison)
 * @returns true when search is empty/whitespace OR plan.sfid contains the search string
 */
export function matchesSfid(row: UnitRow, search: string): boolean {
  const trimmed = search.trim();
  if (trimmed === "") return true;
  const sfid = row.plan["sfid"];
  if (sfid == null) return false;
  return String(sfid).toLowerCase().includes(trimmed.toLowerCase());
}
