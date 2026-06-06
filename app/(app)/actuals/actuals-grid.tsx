"use client";

/**
 * ActualsGrid — the editable AG Grid for one (activity, period) slice.
 *
 * A3 finding (03-01 spike): a mounted-guard (useState+useEffect) prevents SSR window
 * access. NO next/dynamic({ssr:false}) wrapper is needed — AG Grid module-scope imports
 * are SSR-safe; the guard only prevents rendering the <AgGridReact> JSX on the server.
 *
 * A1: dotted nested field paths — plan.* read-only, fields.* editable.
 * A2: AllCommunityModule (registered in ag-grid-setup.ts, imported below).
 * A4: themeQuartz default — NO CSS import; v33+ auto-injects via Theming API.
 *
 * D3-05: derived cells auto-compute via valueGetter (computeDerived), overridable;
 *        override flag stored in fields.__overrides; clearOverride resets to formula.
 * D3-12: dirty rows highlighted via cellClassRules; override cells get a second class.
 * D3-10/11: Save bar reads the dirty Map; conflict rows get a data-slot marker.
 */

import "./ag-grid-setup";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgGridReact } from "ag-grid-react";
import {
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
  type CellValueChangedEvent,
} from "ag-grid-community";
import { buildColumnDefs } from "@/lib/actuals/colDefs";
import { cloneUnitForAdd, type UnitRow } from "@/lib/actuals/rows";
import { setOverride, clearOverride, isOverridden } from "@/lib/actuals/calc";
import { matchesFacets, matchesSfid, type FacetSelections } from "@/lib/actuals/filter";
import { getActivity } from "@/lib/activities/registry";
import { type SaveBatchState } from "@/lib/actions/executions";
import FilterBar from "./filter-bar";
import SaveBar from "./save-bar";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type ActualsGridProps = {
  /** Flat row model assembled server-side by the page */
  initialRows: UnitRow[];
  activityKey: string;
  periodId: number;
  /** Item master rows for POP modal (03-05 will wire the modal; grid receives them now) */
  items?: Array<{ id: number; name: string; category: string | null }>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActualsGrid({
  initialRows,
  activityKey,
  periodId,
  items = [],
}: ActualsGridProps) {
  // A3: mounted guard — render placeholder until client-side (SSR-safe, no dynamic import).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Resolve activity config for colDefs
  const activityCfg = useMemo(() => getActivity(activityKey), [activityKey]);

  // AG Grid API ref
  const apiRef = useRef<GridApi<UnitRow> | null>(null);

  // ---------------------------------------------------------------------------
  // Row data state — single source of truth for the grid rows.
  // We keep a Map<rowKey, UnitRow> for O(1) dirty-state management and a parallel
  // array for rowData so AG Grid can reconcile via getRowId.
  // ---------------------------------------------------------------------------
  const [rowMap, setRowMap] = useState<Map<string, UnitRow>>(() => {
    const m = new Map<string, UnitRow>();
    for (const r of initialRows) m.set(r.rowKey, r);
    return m;
  });

  // Derive the rowData array from the map (AG Grid reconciles by rowKey via getRowId).
  const rowData = useMemo(() => Array.from(rowMap.values()), [rowMap]);

  // ---------------------------------------------------------------------------
  // Filter state — driven by FilterBar, consumed by AG Grid external filter.
  // ---------------------------------------------------------------------------
  const [facetSelections, setFacetSelections] = useState<FacetSelections>({});
  const [sfidSearch, setSfidSearch] = useState<string>("");

  // Refs so the AG Grid callbacks (isExternalFilterPresent / doesExternalFilterPass)
  // always see the latest values without stale closures.
  const facetRef = useRef<FacetSelections>({});
  const sfidRef = useRef<string>("");

  useEffect(() => {
    facetRef.current = facetSelections;
    sfidRef.current = sfidSearch;
    apiRef.current?.onFilterChanged();
  }, [facetSelections, sfidSearch]);

  const isExternalFilterPresent = useCallback((): boolean => {
    const hasFacets = Object.values(facetRef.current).some((v) => v && v.length > 0);
    return hasFacets || sfidRef.current.trim() !== "";
  }, []);

  const doesExternalFilterPass = useCallback((node: IRowNode<UnitRow>): boolean => {
    if (!node.data) return true;
    return (
      matchesFacets(node.data, facetRef.current) &&
      matchesSfid(node.data, sfidRef.current)
    );
  }, []);

  // ---------------------------------------------------------------------------
  // Column definitions — built from the activity config.
  // ---------------------------------------------------------------------------
  const columnDefs = useMemo(() => {
    if (!activityCfg) return [];
    const cols = buildColumnDefs(activityCfg);
    // Append a "+ Add unit" action column at the far right.
    return [
      ...cols,
      {
        headerName: "",
        colId: "__addUnit",
        width: 110,
        editable: false,
        cellRenderer: (p: { data: UnitRow }) => {
          if (!p.data) return null;
          return (
            <button
              onClick={() => handleAddUnit(p.data)}
              className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
              aria-label="Add unit"
            >
              + add unit
            </button>
          );
        },
      },
    ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityCfg]);

  const defaultColDef = useMemo(
    () => ({ flex: 1, minWidth: 120, resizable: true, sortable: true }),
    [],
  );

  // ---------------------------------------------------------------------------
  // Cell class rules — dirty rows get a yellow-tint, override cells get a badge.
  // Applied via cellClassRules on the defaultColDef. AG Grid merges class rules
  // across defaultColDef and per-column defs.
  // ---------------------------------------------------------------------------
  const defaultColDefWithClasses = useMemo(
    () => ({
      ...defaultColDef,
      cellClassRules: {
        "ag-cell-dirty": (p: { data?: UnitRow }) => Boolean(p.data?.dirty),
      },
    }),
    [defaultColDef],
  );

  // ---------------------------------------------------------------------------
  // onCellValueChanged — update the row's fields, mark dirty, handle overrides.
  // ---------------------------------------------------------------------------
  const handleCellValueChanged = useCallback(
    (event: CellValueChangedEvent<UnitRow>) => {
      const { data, colDef, newValue } = event;
      if (!data) return;

      // Determine the field key from colId (derived cols use colId) or the field path.
      const colId = colDef.colId;
      const fieldPath = typeof colDef.field === "string" ? colDef.field : "";
      // fields.* path → key is the part after "fields."
      const fieldsKey = fieldPath.startsWith("fields.")
        ? fieldPath.slice("fields.".length)
        : colId ?? null;

      if (!fieldsKey || fieldPath.startsWith("plan.")) {
        // Plan columns are read-only; no dirty update.
        return;
      }

      setRowMap((prev) => {
        const next = new Map(prev);
        const row = next.get(data.rowKey);
        if (!row) return prev;

        // Clone fields (never mutate the stored object in place).
        const newFields = { ...row.fields, [fieldsKey]: newValue };

        // D3-05: if this is a derived column (has a valueGetter), the user editing it
        // manually means they want to OVERRIDE the formula — set the override flag.
        const isDerived = Boolean(colDef.valueGetter);
        if (isDerived && newValue !== null && newValue !== undefined) {
          setOverride(newFields, fieldsKey, true);
        }

        const updatedRow: UnitRow = {
          ...row,
          fields: newFields,
          dirty: true,
          isPlaceholder: false, // any edit promotes a placeholder to a real row
        };
        next.set(data.rowKey, updatedRow);
        return next;
      });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // handleAddUnit — clone the row's plan context for a new "+ add unit" row.
  // ---------------------------------------------------------------------------
  function handleAddUnit(row: UnitRow) {
    const newRow = cloneUnitForAdd(row);
    setRowMap((prev) => {
      const next = new Map(prev);
      next.set(newRow.rowKey, newRow);
      return next;
    });
    // Let AG Grid know rowData changed (it will reconcile via getRowId).
  }

  // ---------------------------------------------------------------------------
  // clearOverrideForRow — called from a "reset to formula" affordance (inline button).
  // ---------------------------------------------------------------------------
  const handleClearOverride = useCallback((rowKey: string, fieldKey: string) => {
    setRowMap((prev) => {
      const next = new Map(prev);
      const row = next.get(rowKey);
      if (!row) return prev;
      const newFields = { ...row.fields };
      clearOverride(newFields, fieldKey);
      // Clear the stored value so the valueGetter recomputes.
      delete newFields[fieldKey];
      next.set(rowKey, { ...row, fields: newFields, dirty: true });
      return next;
    });
    // Refresh the specific cell so the valueGetter fires again.
    const node = apiRef.current?.getRowNode(rowKey);
    if (node) {
      apiRef.current?.refreshCells({ rowNodes: [node], force: true });
    }
  }, []);
  void handleClearOverride; // referenced in future 03-05 reset affordance

  // ---------------------------------------------------------------------------
  // Dirty row count (for SaveBar)
  // ---------------------------------------------------------------------------
  const dirtyRows = useMemo(
    () => Array.from(rowMap.values()).filter((r) => r.dirty),
    [rowMap],
  );

  // ---------------------------------------------------------------------------
  // onSaveResult — called by SaveBar after saveExecutionsBatch returns.
  // D3-11: savedIds → clear dirty + update executionId+version.
  //         conflicts → mark row with conflict flag (do NOT clear value).
  // ---------------------------------------------------------------------------
  const handleSaveResult = useCallback((result: SaveBatchState) => {
    if (!result.ok) return;

    setRowMap((prev) => {
      const next = new Map(prev);

      for (const saved of result.savedIds) {
        const row = next.get(saved.rowKey);
        if (!row) continue;
        next.set(saved.rowKey, {
          ...row,
          executionId: saved.id,
          version: saved.version,
          dirty: false,
          isPlaceholder: false,
        });
      }

      // Mark conflict rows — do NOT overwrite values (D3-11).
      for (const conflictId of result.conflicts) {
        // Conflicts are execution IDs; find the matching row by executionId.
        for (const [key, row] of next) {
          if (row.executionId === conflictId) {
            next.set(key, { ...row, fields: { ...row.fields, __conflict: true } });
          }
        }
      }

      return next;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // handleConflictReload — reload a specific conflict row's data from server.
  // Uses router.refresh() for a full page refresh so the page re-fetches from DB.
  // ---------------------------------------------------------------------------
  const handleConflictReload = useCallback((_rowKey: string) => {
    // Full page refresh brings fresh server data (revalidatePath already done by action).
    window.location.reload();
  }, []);

  // ---------------------------------------------------------------------------
  // onGridReady
  // ---------------------------------------------------------------------------
  const onGridReady = useCallback((e: GridReadyEvent<UnitRow>) => {
    apiRef.current = e.api;
    // Dev/test: expose the grid API on window so e2e can call ensureColumnVisible
    // to scroll off-screen columns into view before interacting with them.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__actualsGridApi = e.api;
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (!activityCfg) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Unknown activity: {activityKey}
      </div>
    );
  }

  if (!mounted) {
    return (
      <div
        data-slot="actuals-grid"
        className="flex h-64 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-sm text-neutral-500"
      >
        Loading grid…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-slot="actuals-grid">
      {/* Filter bar — drives the AG Grid external filter */}
      <FilterBar
        allRows={rowData}
        onFacetChange={(sel) => setFacetSelections(sel)}
        onSfidChange={(s) => setSfidSearch(s)}
      />

      {/* Grid container — explicit height required by AG Grid (A4) */}
      <div style={{ height: 600, width: "100%" }}>
        <AgGridReact<UnitRow>
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDefWithClasses}
          getRowId={(p) => p.data.rowKey}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
          onCellValueChanged={handleCellValueChanged}
          stopEditingWhenCellsLoseFocus
        />
      </div>

      {/* Conflict row markers — surfaced via data-slot for e2e */}
      {Array.from(rowMap.values())
        .filter((r) => r.fields.__conflict)
        .map((r) => (
          <div
            key={r.rowKey}
            data-slot="row-conflict"
            data-rowkey={r.rowKey}
            className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
          >
            <span>
              Row conflict — another user updated this record. Reload to see the
              latest values before re-saving.
            </span>
            <button
              onClick={() => handleConflictReload(r.rowKey)}
              className="ml-4 rounded border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100"
            >
              Reload
            </button>
          </div>
        ))}

      {/* Save bar — persists dirty rows, handles conflict results */}
      <SaveBar
        dirtyRows={dirtyRows}
        activityKey={activityKey}
        periodId={periodId}
        onSaveResult={handleSaveResult}
        items={items}
      />
    </div>
  );
}
