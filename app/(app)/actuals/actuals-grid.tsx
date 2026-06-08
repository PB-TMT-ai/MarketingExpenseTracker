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
  useDeferredValue,
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
import { cloneUnitForAdd, type UnitRow, type PopLineInput } from "@/lib/actuals/rows";
import { setOverride, clearOverride } from "@/lib/actuals/calc";
import { matchesFacets, matchesSfid, type FacetSelections } from "@/lib/actuals/filter";
import { getActivity } from "@/lib/activities/registry";
import { type SaveBatchState } from "@/lib/actions/executions";
import FilterBar from "./filter-bar";
import SaveBar from "./save-bar";
import PopModal from "./pop-modal";

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

  // POP/Dealer-Kit modal: which kit row is open (rowKey), or null when closed (D3-13/14).
  const [popRowKey, setPopRowKey] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Row data state model (GRID-09 hot-path refactor).
  //
  // rowsRef  — the AUTHORITATIVE off-React row store (Map<rowKey, UnitRow>). Edits
  //            mutate this ref + push the single changed row through
  //            api.applyTransaction({ update: [row] }), so AG Grid refreshes ONLY
  //            that row's node (matched by getRowId). NO clone-on-edit, NO full
  //            rowData rebuild, NO setRowData reconcile per keystroke.
  // dirtyKeys — a Set<rowKey> in React state that drives ONLY the save-bar count.
  //            It changes at most once per row (first-dirty), not per keystroke, so
  //            the save-bar re-render is rare.
  //
  // AG Grid is seeded ONCE from the initial rows (initialRowData below); after that
  // the grid owns its node data and we patch via transactions (R10: getRowId set).
  // ---------------------------------------------------------------------------
  const rowsRef = useRef<Map<string, UnitRow>>(
    (() => {
      const m = new Map<string, UnitRow>();
      for (const r of initialRows) m.set(r.rowKey, r);
      return m;
    })(),
  );

  // dirtyKeys drives the save-bar count (and the derived dirtyRows). State, not ref,
  // because the save bar must re-render when the count changes.
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());

  // Seed AG Grid's rowData ONCE. We do NOT rebuild this array on edits — applyTransaction
  // refreshes individual nodes thereafter. FilterBar derives its facet options from the
  // same initial set (facets are plan-context based; edits don't change the facet domain).
  const initialRowData = useRef<UnitRow[]>(initialRows).current;

  // version counter bumped whenever conflict markers / row identity change in a way the
  // render path (conflict banners, POP modal) must observe. Edits do NOT bump this.
  const [rowsVersion, setRowsVersion] = useState(0);

  // ---------------------------------------------------------------------------
  // Filter state — driven by FilterBar, consumed by AG Grid external filter.
  // ---------------------------------------------------------------------------
  const [facetSelections, setFacetSelections] = useState<FacetSelections>({});
  const [sfidSearch, setSfidSearch] = useState<string>("");

  // GRID-09 Fix 3: defer the typed SFID search so onFilterChanged() does not re-run
  // once per keystroke. facetSelections changes are discrete (dropdown clicks) and
  // don't need deferral — only the free-text search does.
  const deferredSfid = useDeferredValue(sfidSearch);

  // Refs so the AG Grid callbacks (isExternalFilterPresent / doesExternalFilterPass)
  // always see the latest values without stale closures.
  const facetRef = useRef<FacetSelections>({});
  const sfidRef = useRef<string>("");

  useEffect(() => {
    facetRef.current = facetSelections;
    sfidRef.current = deferredSfid;
    apiRef.current?.onFilterChanged();
  }, [facetSelections, deferredSfid]);

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

    // POP/Dealer-Kit (item-list): a kit is ONE row per dealer edited via a modal, not
    // inline per-line cells. Show plan columns (read-only) + a single "Kit" column whose
    // button opens the multi-item modal. No add-unit (one kit per dealer).
    if (activityCfg.type === "item-list") {
      const planCols = buildColumnDefs(activityCfg).slice(
        0,
        activityCfg.planColumns.length,
      );
      return [
        ...planCols,
        {
          headerName: "Kit",
          colId: "__kit",
          minWidth: 240,
          editable: false,
          cellRenderer: (p: { data?: UnitRow }) => {
            if (!p.data) return null;
            const ls = p.data.popLines ?? [];
            const total = ls.reduce((s, l) => s + (l.lineTotal ?? 0), 0);
            return (
              <button
                data-slot="pop-edit"
                onClick={() => setPopRowKey(p.data!.rowKey)}
                className="rounded border border-neutral-300 px-2 py-0.5 text-xs hover:bg-neutral-50"
              >
                <span data-slot="pop-kit-count">{ls.length}</span> item
                {ls.length === 1 ? "" : "s"} · ₹{total.toFixed(2)} — Edit
              </button>
            );
          },
        },
      ];
    }

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
      const { data, colDef, newValue, api } = event;
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

      // GRID-09 hot path: read from the authoritative ref, mutate it, refresh ONLY
      // this row's node via applyTransaction. No Map clone, no rowData rebuild.
      const row = rowsRef.current.get(data.rowKey);
      if (!row) return;

      // Clone fields (never mutate the stored fields object in place).
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
      rowsRef.current.set(data.rowKey, updatedRow);

      // Refresh ONLY this row's node — re-runs valueGetter + cellClassRules for it.
      api.applyTransaction({ update: [updatedRow] });

      // O(1) amortised; only changes the count on the FIRST edit of a given row.
      setDirtyKeys((prev) =>
        prev.has(data.rowKey) ? prev : new Set(prev).add(data.rowKey),
      );
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // handleAddUnit — clone the row's plan context for a new "+ add unit" row.
  // ---------------------------------------------------------------------------
  function handleAddUnit(row: UnitRow) {
    const newRow = cloneUnitForAdd(row);
    rowsRef.current.set(newRow.rowKey, newRow);
    // Insert ONLY the new node — no full rowData rebuild (GRID-09).
    apiRef.current?.applyTransaction({ add: [newRow] });
  }

  // ---------------------------------------------------------------------------
  // handlePopConfirm — the POP modal writes its lines back into the kit row.
  // Sets popLines + rolled-up totalCost, marks dirty (the Save bar flushes it via
  // saveExecutionsBatch → savePopKit). Does NOT persist directly (D3-13/14).
  // ---------------------------------------------------------------------------
  const handlePopConfirm = useCallback(
    (rowKey: string, lines: PopLineInput[]) => {
      const row = rowsRef.current.get(rowKey);
      if (row) {
        const total =
          Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
        const updatedRow: UnitRow = {
          ...row,
          popLines: lines,
          fields: { ...row.fields, totalCost: total },
          dirty: true,
          isPlaceholder: false,
        };
        rowsRef.current.set(rowKey, updatedRow);
        apiRef.current?.applyTransaction({ update: [updatedRow] });
        setDirtyKeys((prev) =>
          prev.has(rowKey) ? prev : new Set(prev).add(rowKey),
        );
      }
      setPopRowKey(null);
      const node = apiRef.current?.getRowNode(rowKey);
      if (node) apiRef.current?.refreshCells({ rowNodes: [node], force: true });
    },
    [],
  );

  // ---------------------------------------------------------------------------
  // clearOverrideForRow — called from a "reset to formula" affordance (inline button).
  // ---------------------------------------------------------------------------
  const handleClearOverride = useCallback((rowKey: string, fieldKey: string) => {
    const row = rowsRef.current.get(rowKey);
    if (row) {
      const newFields = { ...row.fields };
      clearOverride(newFields, fieldKey);
      // Clear the stored value so the valueGetter recomputes.
      delete newFields[fieldKey];
      const updatedRow: UnitRow = { ...row, fields: newFields, dirty: true };
      rowsRef.current.set(rowKey, updatedRow);
      apiRef.current?.applyTransaction({ update: [updatedRow] });
      setDirtyKeys((prev) =>
        prev.has(rowKey) ? prev : new Set(prev).add(rowKey),
      );
    }
    // Refresh the specific cell so the valueGetter fires again.
    const node = apiRef.current?.getRowNode(rowKey);
    if (node) {
      apiRef.current?.refreshCells({ rowNodes: [node], force: true });
    }
  }, []);
  void handleClearOverride; // referenced in future 03-05 reset affordance

  // ---------------------------------------------------------------------------
  // Dirty rows (for SaveBar) — derived from the dirtyKeys Set, recomputed only when
  // the Set changes (i.e. a row becomes first-dirty or is cleared on save), NOT on
  // every keystroke. Each key resolves to its latest object in rowsRef.
  // ---------------------------------------------------------------------------
  const dirtyRows = useMemo(
    () =>
      [...dirtyKeys]
        .map((k) => rowsRef.current.get(k))
        .filter((r): r is UnitRow => Boolean(r) && Boolean(r?.dirty)),
    [dirtyKeys],
  );

  // ---------------------------------------------------------------------------
  // onSaveResult — called by SaveBar after saveExecutionsBatch returns.
  // D3-11: savedIds → clear dirty + update executionId+version.
  //         conflicts → mark row with conflict flag (do NOT clear value).
  // ---------------------------------------------------------------------------
  const handleSaveResult = useCallback((result: SaveBatchState) => {
    if (!result.ok) return;

    const rows = rowsRef.current;
    const updated: UnitRow[] = [];
    const clearedKeys: string[] = [];

    // Saved rows → clear dirty, set executionId + version (D3-11). The conflict
    // rows below are still version-bumped from the same saved set when applicable.
    for (const saved of result.savedIds) {
      const row = rows.get(saved.rowKey);
      if (!row) continue;
      const next: UnitRow = {
        ...row,
        executionId: saved.id,
        version: saved.version,
        dirty: false,
        isPlaceholder: false,
      };
      rows.set(saved.rowKey, next);
      updated.push(next);
      clearedKeys.push(saved.rowKey);
    }

    // Mark conflict rows — do NOT overwrite values (D3-11). Conflicts are execution
    // IDs; find the matching row by executionId.
    for (const conflictId of result.conflicts) {
      for (const [key, row] of rows) {
        if (row.executionId === conflictId) {
          const next: UnitRow = {
            ...row,
            fields: { ...row.fields, __conflict: true },
          };
          rows.set(key, next);
          updated.push(next);
        }
      }
    }

    // Refresh the affected nodes in one transaction (matched by getRowId).
    if (updated.length > 0) {
      apiRef.current?.applyTransaction({ update: updated });
    }

    // Remove cleared (saved) keys from the dirty set — drives the save-bar count down.
    if (clearedKeys.length > 0) {
      setDirtyKeys((prev) => {
        const next = new Set(prev);
        for (const k of clearedKeys) next.delete(k);
        return next;
      });
    }

    // Bump the render version so the conflict-banner list re-derives from rowsRef.
    if (result.conflicts.length > 0) {
      setRowsVersion((v) => v + 1);
    }
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
  // Conflict-banner rows — derived from the authoritative rowsRef. Recomputed when
  // rowsVersion bumps (handleSaveResult flags conflicts). The grid itself reflects
  // conflict state per-node via applyTransaction; this list drives the banners only.
  // ---------------------------------------------------------------------------
  const conflictRows = useMemo(
    () => [...rowsRef.current.values()].filter((r) => r.fields.__conflict),
    // rowsVersion is the explicit dependency: rowsRef is mutable, so the version
    // counter is what tells React the conflict set may have changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsVersion],
  );

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
      {/* Filter bar — drives the AG Grid external filter. Facets are derived from the
          plan context, which the initial row set already covers (edits don't change
          the facet domain), so we feed it the seed array. */}
      <FilterBar
        allRows={initialRowData}
        onFacetChange={(sel) => setFacetSelections(sel)}
        onSfidChange={(s) => setSfidSearch(s)}
      />

      {/* Grid container — explicit height required by AG Grid (A4).
          rowData is seeded ONCE; subsequent edits patch nodes via applyTransaction
          (GRID-09). getRowId is REQUIRED for transaction node-matching (R10).
          singleClickEdit: status opens on one click. animateRows=false: no layout
          cost on bulk updates for a data-entry grid. Virtualization stays ON. */}
      <div style={{ height: 600, width: "100%" }}>
        <AgGridReact<UnitRow>
          rowData={initialRowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDefWithClasses}
          getRowId={(p) => p.data.rowKey}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
          onCellValueChanged={handleCellValueChanged}
          stopEditingWhenCellsLoseFocus
          singleClickEdit
          animateRows={false}
        />
      </div>

      {/* Conflict row markers — surfaced via data-slot for e2e */}
      {conflictRows.map((r) => (
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

      {/* POP/Dealer-Kit multi-item modal (item-list activities) */}
      {popRowKey &&
        (() => {
          const row = rowsRef.current.get(popRowKey);
          if (!row) return null;
          return (
            <PopModal
              planContext={row.plan}
              initialLines={row.popLines ?? []}
              items={items}
              onConfirm={(lines) => handlePopConfirm(popRowKey, lines)}
              onClose={() => setPopRowKey(null)}
            />
          );
        })()}

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
