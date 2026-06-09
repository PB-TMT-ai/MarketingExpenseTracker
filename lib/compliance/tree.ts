/**
 * Pure geo-tree builder for the compliance drill-down (DASH-07 — Zone → State →
 * District → Taluka).
 *
 * PURE module — framework-free. No React, no Drizzle, no DB. The only import is an
 * `import type` from `@/lib/db/dashboard` (the `GeoRow` shape), which is erased at
 * compile time — there is no runtime dependency on the DAL.
 *
 * This is the compliance-side tree builder, consumed by the dashboard geo-drill
 * island and reusable by any future drill consumer (export, reports). It honors the
 * *spirit* of the D-11 cascade in `lib/actuals/filter.ts` — the region → state →
 * district → taluka hierarchy — but deliberately does NOT reuse the literal
 * `optionsFor` helper there, because `GeoRow` (a flat aggregate tuple with metrics)
 * is a different shape than `UnitRow` (a grid row). RESEARCH Pattern 4 option (a):
 * a small purpose-built transform beats shoehorning `GeoRow` into `UnitRow`.
 *
 * Guarantee (DASH-07 success criterion #7 — "% executed aggregates upward"): every
 * parent node's metrics are the SUM of its leaf descendants' metrics. Summing is
 * done incrementally as rows are inserted, so the invariant holds at every level by
 * construction — `parent.planned === sum(child.planned)` recursively.
 */

import type { GeoRow } from "@/lib/db/dashboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single node in the geo drill tree. The same shape at every level (zone, state,
 * district, taluka) — only `label` and the depth in `children` distinguish levels.
 * Leaves (taluka nodes) have `children: []`.
 */
export type GeoTreeNode = {
  label: string;
  planned: number;
  executed: number;
  cancelled: number;
  plannedCost: number;
  actualCost: number;
  children: GeoTreeNode[];
};

// ---------------------------------------------------------------------------
// Internal accumulator
// ---------------------------------------------------------------------------

/** Mutable accumulator keyed by label; `kids` is the next level (empty Map at leaves). */
type Acc = {
  label: string;
  planned: number;
  executed: number;
  cancelled: number;
  plannedCost: number;
  actualCost: number;
  kids: Map<string, Acc>;
};

const UNASSIGNED = "(unassigned)";

/** Coalesce null/undefined/empty who-where values to the canonical "(unassigned)" label. */
function label(v: string | null | undefined): string {
  return v != null && v !== "" ? v : UNASSIGNED;
}

/** Get-or-create the accumulator for `key` under `parent`, initialized to zero metrics. */
function child(parent: Map<string, Acc>, key: string): Acc {
  let node = parent.get(key);
  if (!node) {
    node = {
      label: key,
      planned: 0,
      executed: 0,
      cancelled: 0,
      plannedCost: 0,
      actualCost: 0,
      kids: new Map(),
    };
    parent.set(key, node);
  }
  return node;
}

/** Add a row's metrics into an accumulator (the upward-sum step). */
function addMetrics(node: Acc, row: GeoRow): void {
  node.planned += row.plannedUnits;
  node.executed += row.executedUnits;
  node.cancelled += row.cancelledUnits;
  node.plannedCost += row.plannedCost;
  node.actualCost += row.actualCost;
}

/** Flatten the accumulator Map into a sorted GeoTreeNode[] (alphabetical by label). */
function flatten(map: Map<string, Acc>): GeoTreeNode[] {
  return [...map.values()]
    .map((acc) => ({
      label: acc.label,
      planned: acc.planned,
      executed: acc.executed,
      cancelled: acc.cancelled,
      plannedCost: acc.plannedCost,
      actualCost: acc.actualCost,
      children: flatten(acc.kids),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// buildGeoTree
// ---------------------------------------------------------------------------

/**
 * Transform a flat `GeoRow[]` into a nested `GeoTreeNode[]` — one top-level node per
 * distinct region, each nested by (region, state), (region, state, district), and
 * (region, state, district, taluka). Leaf metrics sum into every ancestor (one O(N)
 * walk). Siblings at every depth are sorted alphabetically. Empty input → [].
 */
export function buildGeoTree(rows: GeoRow[]): GeoTreeNode[] {
  const roots = new Map<string, Acc>();

  for (const row of rows) {
    const region = child(roots, label(row.region));
    addMetrics(region, row);

    const state = child(region.kids, label(row.state));
    addMetrics(state, row);

    const district = child(state.kids, label(row.district));
    addMetrics(district, row);

    const taluka = child(district.kids, label(row.taluka));
    addMetrics(taluka, row);
  }

  return flatten(roots);
}
