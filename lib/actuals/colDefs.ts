/**
 * Registry→AG Grid ColDef mapper.
 *
 * Converts an ActivityConfig's planColumns + actualColumns into AG Grid ColDef[].
 * PURE module — `import type { ColDef }` keeps this unit-testable without a browser.
 *
 * Binding shape (A1 confirmed in 03-01 spike):
 *   - plan columns: field = "plan.<key>"  (editable:false, muted cellClass)
 *   - actual columns (non-derived): field = "fields.<key>"  (editable:true, cellEditor per FieldKind)
 *   - actual columns (derived, computeFrom present): editable:true (overridable, D3-05)
 *       + valueGetter that short-circuits to stored value when overridden (prevents Pitfall-4 loop)
 *
 * ACTV-03: a 7th activity added to the registry maps through with no code change here.
 */

import type { ColDef } from "ag-grid-community";
import type { ActivityConfig, FieldDef } from "../activities/types";
import { computeDerived, isOverridden } from "./calc";

// ---------------------------------------------------------------------------
// cellEditor mapping per FieldKind
// ---------------------------------------------------------------------------

/**
 * Maps FieldDef.kind to the AG Grid Community built-in cell editor name.
 * lat/long stay as text (PITFALLS: never numeric-coerce coordinates).
 * currency uses agNumberCellEditor — ₹ display is handled by valueFormatter, not a special editor.
 */
const EDITOR_BY_KIND: Record<FieldDef["kind"], string> = {
  text: "agTextCellEditor",
  number: "agNumberCellEditor",
  currency: "agNumberCellEditor",
  date: "agDateStringCellEditor",
  status: "agSelectCellEditor",
  enum: "agSelectCellEditor",
  lat: "agTextCellEditor",
  long: "agTextCellEditor",
};

/**
 * Per-kind minimum column width (px). Text-kind columns (dealer/area, distributor,
 * SFID) tend to carry long human-readable values and were getting truncated to
 * 'ACME Coun…' at desktop width (F-028). Numeric/date/coord columns stay narrower
 * since their content is fixed-width. AG Grid still lets the user resize.
 */
const MIN_WIDTH_BY_KIND: Record<FieldDef["kind"], number> = {
  text: 160,
  number: 110,
  currency: 120,
  date: 130,
  status: 130,
  enum: 130,
  lat: 130,
  long: 130,
};

// ---------------------------------------------------------------------------
// buildColumnDefs
// ---------------------------------------------------------------------------

/**
 * Build AG Grid ColDef[] from an ActivityConfig.
 *
 * Plan columns come first (read-only, muted), then actual columns (editable).
 * Derived actual columns (FieldDef.computeFrom truthy) get a valueGetter that:
 *   - returns the stored value when isOverridden(fields, key) is true (sticky override, D3-05)
 *   - calls computeDerived(activityKey, key, fields) otherwise (live formula)
 *
 * The valueGetter signature matches AG Grid's ValueGetterParams (p.data is the UnitRow).
 * Row shape: { plan: Record<string,unknown>, fields: Record<string,unknown> }
 */
export function buildColumnDefs(cfg: ActivityConfig): ColDef[] {
  const activityKey = cfg.key;

  // Plan columns: read-only, muted styling, dotted plan.* path
  const planCols: ColDef[] = cfg.planColumns.map((f): ColDef => ({
    headerName: f.label,
    field: `plan.${f.key}`,
    editable: false,
    cellClass: "ag-cell-plan",
    minWidth: MIN_WIDTH_BY_KIND[f.kind],
  }));

  // Actual columns: editable, dotted fields.* path, cellEditor per kind
  const actualCols: ColDef[] = cfg.actualColumns.map((f): ColDef => {
    const isDerived = f.computeFrom != null && f.computeFrom.length > 0;
    const editor = EDITOR_BY_KIND[f.kind];
    const editorParams =
      f.enumValues && f.enumValues.length > 0
        ? { values: [...f.enumValues] }
        : undefined;

    if (isDerived) {
      // Derived column: overridable (D3-05) — field path still works for AG Grid internal use
      // but valueGetter takes precedence for the displayed value.
      const key = f.key;
      return {
        headerName: f.label,
        field: `fields.${key}`,
        colId: key,
        editable: true, // overridable
        cellEditor: editor,
        cellEditorParams: editorParams,
        minWidth: MIN_WIDTH_BY_KIND[f.kind],
        /**
         * valueGetter: returns the stored override value when overridden,
         * otherwise computes via the D3-04 formula engine.
         * This is the Pitfall-4 guard: the override flag short-circuits recompute.
         */
        valueGetter: (p: { data: { fields: Record<string, unknown>; plan: Record<string, unknown> } }) => {
          const fields = p.data?.fields ?? {};
          if (isOverridden(fields, key)) {
            // Return the stored (user-overridden) value directly
            return fields[key];
          }
          // Live formula
          return computeDerived(activityKey, key, fields);
        },
      };
    }

    // Non-derived actual column
    return {
      headerName: f.label,
      field: `fields.${f.key}`,
      editable: true,
      cellEditor: editor,
      cellEditorParams: editorParams,
      minWidth: MIN_WIDTH_BY_KIND[f.kind],
    };
  });

  return [...planCols, ...actualCols];
}
