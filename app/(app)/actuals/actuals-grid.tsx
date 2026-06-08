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
  type ColDef,
} from "ag-grid-community";
import { buildColumnDefs } from "@/lib/actuals/colDefs";
import { cloneUnitForAdd, type UnitRow, type PopLineInput } from "@/lib/actuals/rows";
import { setOverride, clearOverride, computeDerived } from "@/lib/actuals/calc";
import {
  matchesFacets,
  matchesSfid,
  type FacetSelections,
  type FacetKey,
} from "@/lib/actuals/filter";
import { getActivity } from "@/lib/activities/registry";
import {
  type SaveBatchState,
  fetchExecutionForRow,
} from "@/lib/actions/executions";
import FilterBar from "./filter-bar";
import SaveBar from "./save-bar";
import PopModal from "./pop-modal";

// ---------------------------------------------------------------------------
// P2-5: write filter selections into the URL via history.replaceState (no Next
// navigation → no server re-query, no scroll jump). Preserves `activity`. Facets
// are repeated params (?region=A&region=B); SFID a single `sfid`. Centralized
// here so every filter source (the bar AND the clickable Pending stat) syncs.
// ---------------------------------------------------------------------------
const URL_FACETS: FacetKey[] = [
  "region",
  "state",
  "district",
  "distributor",
  "status",
];

function syncFilterUrl(facets: FacetSelections, sfidVal: string): void {
  if (typeof window === "undefined") return;
  const existing = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const activity = existing.get("activity");
  if (activity) params.set("activity", activity);
  for (const facet of URL_FACETS) {
    for (const v of facets[facet] ?? []) params.append(facet, v);
  }
  const s = sfidVal.trim();
  if (s !== "") params.set("sfid", s);
  const qs = params.toString();
  window.history.replaceState(
    null,
    "",
    qs ? `${window.location.pathname}?${qs}` : window.location.pathname,
  );
}

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
  /** P2-5: initial facet selections from the URL (so a shared/reloaded link lands filtered) */
  initialFacets?: FacetSelections;
  /** P2-5: initial SFID search from the URL */
  initialSfid?: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ActualsGrid({
  initialRows,
  activityKey,
  periodId,
  items = [],
  initialFacets,
  initialSfid = "",
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

  // P2-4: persistent "last saved HH:MM" stamp. The SaveBar's "Saved" flash
  // expires in 3s; this survives so a reviewer who saved and Alt-Tabbed away
  // can still see the last successful save time when they come back.
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

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
  // P2-5: seed from the URL-derived initial filters so a shared/reloaded link
  // (or filters carried across an activity switch) apply on first paint.
  const [facetSelections, setFacetSelections] = useState<FacetSelections>(
    initialFacets ?? {},
  );
  const [sfidSearch, setSfidSearch] = useState<string>(initialSfid);

  // Refs so the AG Grid callbacks (isExternalFilterPresent / doesExternalFilterPass)
  // always see the latest values without stale closures.
  const facetRef = useRef<FacetSelections>(initialFacets ?? {});
  const sfidRef = useRef<string>(initialSfid);

  useEffect(() => {
    facetRef.current = facetSelections;
    sfidRef.current = sfidSearch;
    apiRef.current?.onFilterChanged();
    // P2-5: keep the URL in sync with whatever drives the filter (the bar or
    // the clickable Pending stat). replaceState → reloadable + shareable, no nav.
    syncFilterUrl(facetSelections, sfidSearch);
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

  // P3: clicking the "Pending" stat applies a status=Pending facet (replacing
  // any prior status selection, keeping the geo/distributor facets). Toggles
  // off if Pending is already the sole status filter. Goes through the same
  // setFacetSelections path so the dropdown + URL stay in sync.
  const handleFilterPending = useCallback(() => {
    setFacetSelections((prev) => {
      const cur = prev.status ?? [];
      const alreadyOnlyPending = cur.length === 1 && cur[0] === "Pending";
      return { ...prev, status: alreadyOnlyPending ? [] : ["Pending"] };
    });
  }, []);

  // ---------------------------------------------------------------------------
  // Column definitions — built from the activity config.
  // ---------------------------------------------------------------------------
  const columnDefs = useMemo(() => {
    if (!activityCfg) return [];

    // P1-1: shared Notes column — appears for every activity type. Editable
    // text the reviewer can use to justify an override ("vendor invoice
    // attached", "re-measured at handover"). When the row has any active
    // override flag, the placeholder nudges the reviewer to add a note.
    const notesCol: ColDef = {
      headerName: "Notes",
      field: "fields.notes",
      colId: "__notes",
      minWidth: 220,
      flex: 2,
      editable: true,
      cellEditor: "agLargeTextCellEditor",
      cellEditorPopup: true,
      cellRenderer: (p: { data?: UnitRow }) => {
        if (!p.data) return null;
        const notes =
          (p.data.fields["notes"] as string | null | undefined) ?? "";
        const overrides =
          (p.data.fields["__overrides"] as
            | Record<string, boolean>
            | undefined) ?? {};
        const overrideCount = Object.values(overrides).filter(Boolean).length;
        if (notes) {
          return (
            <span data-slot="notes-text" className="text-neutral-800">
              {notes}
            </span>
          );
        }
        if (overrideCount > 0) {
          return (
            <span
              data-slot="notes-prompt"
              className="italic text-amber-700"
              title={`${overrideCount} override${overrideCount === 1 ? "" : "s"} active on this row — recording a note here justifies the change for audit.`}
            >
              ★ {overrideCount} override{overrideCount === 1 ? "" : "s"} — add a note
            </span>
          );
        }
        // P1-3: an untouched placeholder row carries a "Draft" pill so the
        // reviewer can see it has no execution recorded yet (and won't be saved
        // until edited). This scrolls with the Notes cell but is meaningful.
        if (p.data.isPlaceholder && !p.data.dirty) {
          return (
            <span
              data-slot="notes-draft"
              className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-500"
              title="No execution recorded yet — edit any cell to start; this row is not saved until you do."
            >
              Draft — not yet recorded
            </span>
          );
        }
        return <span className="text-neutral-400">—</span>;
      },
    };

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
        notesCol,
      ];
    }

    const cols = buildColumnDefs(activityCfg);
    // Append the Notes col + "+ Add unit" action column at the far right.
    return [
      ...cols,
      notesCol,
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

  // P1-3: fade placeholder rows so a reviewer can tell a pristine draft from a
  // saved execution at a glance. A row that has been edited (dirty) is no longer
  // treated as a faded placeholder even if it started as one.
  const rowClassRules = useMemo(
    () => ({
      "ag-row-placeholder": (p: { data?: UnitRow }) =>
        Boolean(p.data?.isPlaceholder) && !p.data?.dirty,
      // P3: highlight rows flagged as version-conflicts so the single summary
      // banner ("N rows conflicted") points at something visible in the grid.
      "ag-row-conflict": (p: { data?: UnitRow }) =>
        Boolean(p.data?.fields?.__conflict),
    }),
    [],
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

        // D3-05 + P2-3 audit hygiene: only mark a derived cell as overridden
        // when the new value actually differs from what the formula would
        // compute. Without this, an Excel paste that happens to match the
        // formula's natural answer (or a single-cell paste of the same number)
        // would silently flip the override flag — which would then bloat the
        // P1-1 override audit log with no-op entries.
        const isDerived = Boolean(colDef.valueGetter);
        if (isDerived && newValue !== null && newValue !== undefined) {
          const naturalVal = computeDerived(activityKey, fieldsKey, {
            ...newFields,
            __overrides: {
              ...((newFields["__overrides"] as
                | Record<string, boolean>
                | undefined) ?? {}),
              [fieldsKey]: false,
            },
          });
          const newNum = Number(newValue);
          const matchesFormula =
            naturalVal != null &&
            Number.isFinite(newNum) &&
            Math.abs(newNum - naturalVal) < 0.005;
          if (!matchesFormula) {
            setOverride(newFields, fieldsKey, true);
          } else {
            // Pasted/typed value matches formula — make sure any prior override
            // flag is cleared so the cell goes back to "tracking the formula."
            clearOverride(newFields, fieldsKey);
          }
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
    [activityKey],
  );

  // ---------------------------------------------------------------------------
  // P2-3: clipboard paste sanitization.
  // Excel-pasted values often arrive with ₹, commas, or trailing whitespace
  // ("₹1,234.56", "1,500 "). Strip those at the boundary so the cell editor
  // receives a clean number string. AG Grid Community supports single-cell
  // paste out of the box; range paste is Enterprise-only — but even single-
  // cell paste is meaningfully better than the row-by-row typing it replaces.
  // ---------------------------------------------------------------------------
  const processCellFromClipboard = useCallback(
    (params: { value: unknown }): unknown => {
      const v = params.value;
      if (typeof v !== "string") return v;
      // Strip ₹, commas, percent signs, and surrounding whitespace.
      // Keep digits, decimal point, and minus sign.
      const cleaned = v.replace(/[₹,%\s]/g, "").trim();
      return cleaned;
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
  // handlePopConfirm — the POP modal writes its lines back into the kit row.
  // Sets popLines + rolled-up totalCost, marks dirty (the Save bar flushes it via
  // saveExecutionsBatch → savePopKit). Does NOT persist directly (D3-13/14).
  // ---------------------------------------------------------------------------
  const handlePopConfirm = useCallback(
    (rowKey: string, lines: PopLineInput[]) => {
      setRowMap((prev) => {
        const next = new Map(prev);
        const row = next.get(rowKey);
        if (!row) return prev;
        const total =
          Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
        next.set(rowKey, {
          ...row,
          popLines: lines,
          fields: { ...row.fields, totalCost: total },
          dirty: true,
          isPlaceholder: false,
        });
        return next;
      });
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
  // P1-3: warn before leaving with unsaved edits. A reviewer who Alt-Tabs to an
  // Excel reference and then closes/navigates the tab would otherwise lose every
  // unsaved correction silently. The browser shows its native "Leave site?"
  // prompt only while there is at least one dirty row.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (dirtyRows.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy requirement for some browsers to actually show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyRows.length]);

  // ---------------------------------------------------------------------------
  // onSaveResult — called by SaveBar after saveExecutionsBatch returns.
  // D3-11: savedIds → clear dirty + update executionId+version.
  //         conflicts → mark row with conflict flag (do NOT clear value).
  // ---------------------------------------------------------------------------
  const handleSaveResult = useCallback((result: SaveBatchState) => {
    if (!result.ok) return;

    // P2-4: stamp the last successful save time when at least one row committed.
    if (result.savedIds.length > 0) {
      setLastSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }

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
  // handleConflictReload — P1-2: re-fetch the ONE stale row, patch it in place.
  // Previously this did window.location.reload(), which discarded every other
  // unsaved edit in the batch. Now we call fetchExecutionForRow for the single
  // conflicting executionId and patch only that row into rowMap. All other
  // dirty rows survive. Falls back to a full reload only if the action fails
  // hard (network error, deleted row, etc.) — that's the correctness escape
  // hatch, not the default path.
  // ---------------------------------------------------------------------------
  const handleConflictReload = useCallback(
    async (rowKey: string, executionId: number) => {
      const withKitLines = activityCfg?.type === "item-list";

      let result;
      try {
        result = await fetchExecutionForRow({ executionId, withKitLines });
      } catch (err) {
        console.error("fetchExecutionForRow failed", err);
        // Last-resort fallback: at least the user sees fresh server data.
        window.location.reload();
        return;
      }

      if (!result.ok) {
        // Server says the row no longer exists or input was bad.
        // A full reload re-syncs the whole grid (which is correct here:
        // the row's identity is gone, the rowKey is dead).
        window.location.reload();
        return;
      }

      setRowMap((prev) => {
        const next = new Map(prev);
        const existing = next.get(rowKey);
        if (!existing) return prev;
        next.set(rowKey, {
          ...existing,
          version: result.version,
          fields: result.fields, // server-fresh; __conflict cleared by replacement
          popLines: result.popLines, // undefined for non-kit rows; intentional
          dirty: false,
          isPlaceholder: false,
        });
        return next;
      });

      // AG Grid needs an explicit refresh so the patched cells re-render
      // (rowData identity changes via the new Map, but force the cells too).
      const node = apiRef.current?.getRowNode(rowKey);
      if (node) {
        apiRef.current?.refreshCells({ rowNodes: [node], force: true });
      }
    },
    [activityCfg],
  );

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
        selected={facetSelections}
        sfid={sfidSearch}
        onFacetChange={(sel) => setFacetSelections(sel)}
        onSfidChange={(s) => setSfidSearch(s)}
      />

      {/* P2-1: live status breakdown that updates as the manager edits.
          Honest first cut — doesn't try to define "% executed" precisely
          (that's a Phase 4 spec call). Surfaces what we can measure cheaply:
          plan rows covered (≥1 execution) and status counts on recorded rows. */}
      <GridStats
        rows={rowData}
        lastSavedAt={lastSavedAt}
        onFilterPending={handleFilterPending}
        pendingFilterActive={
          (facetSelections.status ?? []).length === 1 &&
          facetSelections.status?.[0] === "Pending"
        }
      />

      {/* Grid container — explicit height required by AG Grid (A4) */}
      <div style={{ height: 600, width: "100%" }}>
        <AgGridReact<UnitRow>
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDefWithClasses}
          getRowId={(p) => p.data.rowKey}
          rowClassRules={rowClassRules}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
          onCellValueChanged={handleCellValueChanged}
          stopEditingWhenCellsLoseFocus
          // P2-3: enable Excel paste. Text selection lets the user copy out;
          // processCellFromClipboard sanitizes incoming Indian-format values.
          enableCellTextSelection
          processCellFromClipboard={processCellFromClipboard}
          // P3: per-cell undo/redo (Ctrl+Z / Ctrl+Y) for the last edits.
          undoRedoCellEditing
          undoRedoCellEditingLimit={20}
        />
      </div>

      {/* P3: ONE collapsed conflict summary instead of a banner per row.
          Lists the conflicted SFIDs, points at the highlighted grid rows, and
          offers a single "Reload all" that re-fetches each conflicted row in
          place (preserving every other unsaved edit). The per-row data-slot is
          kept on hidden markers so existing e2e selectors still resolve. */}
      {(() => {
        const conflictRows = Array.from(rowMap.values()).filter(
          (r) => r.fields.__conflict,
        );
        if (conflictRows.length === 0) return null;
        const sfids = conflictRows
          .map((r) => String(r.plan["sfid"] ?? "").trim())
          .filter((s) => s !== "");
        return (
          <div
            data-slot="conflict-summary"
            className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <span className="font-medium">
                {conflictRows.length} row
                {conflictRows.length === 1 ? "" : "s"} conflicted
              </span>{" "}
              — another session updated{" "}
              {conflictRows.length === 1 ? "this record" : "these records"} while
              you were editing. Highlighted below.
              {sfids.length > 0 && (
                <span className="mt-0.5 block text-xs text-amber-700">
                  SFID: {sfids.join(", ")}
                </span>
              )}
              {/* Hidden per-row markers preserve the original e2e contract. */}
              <span className="hidden">
                {conflictRows.map((r) => (
                  <span
                    key={r.rowKey}
                    data-slot="row-conflict"
                    data-rowkey={r.rowKey}
                  />
                ))}
              </span>
            </div>
            <button
              onClick={() => {
                for (const r of conflictRows) {
                  if (r.executionId != null) {
                    void handleConflictReload(r.rowKey, r.executionId);
                  }
                }
              }}
              className="shrink-0 rounded border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100"
            >
              Reload {conflictRows.length === 1 ? "row" : "all"}
            </button>
          </div>
        );
      })()}

      {/* POP/Dealer-Kit multi-item modal (item-list activities) */}
      {popRowKey &&
        (() => {
          const row = rowMap.get(popRowKey);
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

// ---------------------------------------------------------------------------
// GridStats — live status breakdown (P2-1)
//
// Computes from the current rowData so values update as the manager edits
// statuses (the reviewer's whole job). Honest metrics: coverage = plan rows
// with at least one execution; status counts = execution rows grouped by
// their `status` field. % Done is intentionally framed as "Done out of
// covered rows" not "out of plan rows" — that avoids overstating progress
// when many plan rows are entirely unrecorded.
//
// Cancelled is wired in already (P2-2 will surface it as a status option;
// for now the count will read zero until "Cancelled" appears in the enum).
// ---------------------------------------------------------------------------
function GridStats({
  rows,
  lastSavedAt,
  onFilterPending,
  pendingFilterActive,
}: {
  rows: UnitRow[];
  lastSavedAt?: string | null;
  onFilterPending?: () => void;
  pendingFilterActive?: boolean;
}) {
  const stats = useMemo(() => {
    let done = 0;
    let inProgress = 0;
    let pending = 0;
    let cancelled = 0;
    let noStatus = 0;
    let recorded = 0;

    const planRowIds = new Set<number>();
    const coveredPlanRowIds = new Set<number>();

    for (const r of rows) {
      planRowIds.add(r.planRowId);
      if (r.isPlaceholder) continue;
      recorded++;
      coveredPlanRowIds.add(r.planRowId);
      const status = String(r.fields["status"] ?? "")
        .trim()
        .toLowerCase();
      // Count by EXACT status so the "Pending" chip matches the Pending filter
      // (which matches the literal value). Recorded rows with a blank status are
      // their own honest "No status" bucket, not silently folded into Pending —
      // otherwise clicking "Pending N" would filter to zero rows.
      if (status === "done") done++;
      else if (status === "in progress") inProgress++;
      else if (status === "cancelled") cancelled++;
      else if (status === "pending") pending++;
      else noStatus++;
    }

    const totalPlanRows = planRowIds.size;
    const coveredPlanRows = coveredPlanRowIds.size;
    const coveragePct =
      totalPlanRows > 0
        ? Math.round((coveredPlanRows / totalPlanRows) * 100)
        : 0;
    // P2-2: Cancelled rows are recorded but are NOT pending work — exclude them
    // from the % done denominator so cancelling a dealer can never drag the
    // completion number down. "Active" = recorded minus cancelled.
    const activeRecorded = recorded - cancelled;
    const donePct =
      activeRecorded > 0 ? Math.round((done / activeRecorded) * 100) : 0;

    return {
      done,
      inProgress,
      pending,
      cancelled,
      noStatus,
      recorded,
      activeRecorded,
      totalPlanRows,
      coveredPlanRows,
      coveragePct,
      donePct,
    };
  }, [rows]);

  if (stats.totalPlanRows === 0) return null;

  return (
    <div
      data-slot="grid-stats"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs"
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-neutral-500">Coverage</span>
        <span
          data-slot="stat-coverage"
          className="font-semibold tabular-nums text-neutral-900"
        >
          {stats.coveredPlanRows}/{stats.totalPlanRows}
        </span>
        <span className="text-neutral-500">({stats.coveragePct}%)</span>
      </div>
      <span aria-hidden className="h-3 w-px bg-neutral-200" />
      <div className="flex items-baseline gap-1.5">
        <span className="text-neutral-500">Done</span>
        <span
          data-slot="stat-done"
          className="font-semibold tabular-nums text-emerald-700"
        >
          {stats.done}
        </span>
        <span className="text-neutral-500">({stats.donePct}% of active)</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-neutral-500">In progress</span>
        <span
          data-slot="stat-in-progress"
          className="font-semibold tabular-nums text-sky-700"
        >
          {stats.inProgress}
        </span>
      </div>
      {/* P3: clicking Pending applies/removes a status=Pending filter so the
          reviewer can jump straight to "what still needs work". */}
      <button
        type="button"
        onClick={onFilterPending}
        disabled={!onFilterPending}
        aria-pressed={pendingFilterActive}
        title={
          pendingFilterActive
            ? "Showing only Pending rows — click to clear"
            : "Show only Pending rows"
        }
        className={`flex items-baseline gap-1.5 rounded px-1.5 py-0.5 enabled:hover:bg-amber-50 ${
          pendingFilterActive ? "bg-amber-100 ring-1 ring-amber-300" : ""
        }`}
      >
        <span className="text-neutral-500">Pending</span>
        <span
          data-slot="stat-pending"
          className="font-semibold tabular-nums text-amber-700"
        >
          {stats.pending}
        </span>
      </button>
      {stats.noStatus > 0 && (
        <div
          className="flex items-baseline gap-1.5"
          title="Recorded executions with no status set — give them a status so they count toward completion."
        >
          <span className="text-neutral-500">No status</span>
          <span
            data-slot="stat-no-status"
            className="font-semibold tabular-nums text-rose-700"
          >
            {stats.noStatus}
          </span>
        </div>
      )}
      {stats.cancelled > 0 && (
        <div className="flex items-baseline gap-1.5">
          <span className="text-neutral-500">Cancelled</span>
          <span
            data-slot="stat-cancelled"
            className="font-semibold tabular-nums text-neutral-500"
          >
            {stats.cancelled}
          </span>
        </div>
      )}
      {lastSavedAt && (
        <div className="ml-auto flex items-baseline gap-1.5">
          <span className="text-neutral-400">Last saved</span>
          <span
            data-slot="stat-last-saved"
            className="font-medium tabular-nums text-neutral-600"
          >
            {lastSavedAt}
          </span>
        </div>
      )}
    </div>
  );
}
