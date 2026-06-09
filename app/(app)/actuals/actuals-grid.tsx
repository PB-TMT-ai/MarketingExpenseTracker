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
 *
 * GRID-09 hot path (phase-3.1): rowsRef + applyTransaction for per-row writes.
 * GRID-12 (phase-3.1): dual sticky SaveBar (top + bottom) via useSaveExecutions
 *        — one submit / one pending / one count; Ctrl/Cmd+S routes here too.
 * GRID-13 (phase-3.1): DOM paste listener on the grid wrapper — full Excel/Sheets
 *        TSV block paste, respects displayed-row order, coerces by FieldKind.
 *
 * design-pass features layered on top of the GRID-09 hot path:
 *   P1-1: shared Notes column with override-justification prompt
 *   P1-2: smart per-row conflict reload via fetchExecutionForRow (no full reload)
 *   P1-3: beforeunload guard + faded placeholder row indicator
 *   P2-1: live GridStats (Coverage / Done / In progress / Pending / Cancelled)
 *   P2-3: paste/edit values matching the formula no longer flip the override flag
 *   P2-4: persistent "Last saved HH:MM" stamp
 *   P2-5: URL filter persistence (initialFacets/initialSfid + history.replaceState)
 *   P3:   single consolidated conflict summary + clickable Pending stat
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
  type ColDef,
  type Column,
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
import {
  useSaveExecutions,
  type UnitPatch,
} from "@/lib/actuals/use-save-executions";
import { coerceForKind } from "@/lib/actuals/coerce";
import { getActivity } from "@/lib/activities/registry";
import type { FieldKind } from "@/lib/activities/types";
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

  // GRID-13: map each actual-column key → its FieldDef.kind, built ONCE from the resolved
  // activity config. The paste handler resolves a target column's coercion kind via this
  // lookup (default "text" for any unmapped column — safe, no numeric coercion).
  const kindByKey = useMemo(
    () =>
      new Map<string, FieldKind>(
        (activityCfg?.actualColumns ?? []).map((f) => [f.key, f.kind]),
      ),
    [activityCfg],
  );

  // AG Grid API ref
  const apiRef = useRef<GridApi<UnitRow> | null>(null);

  // Grid container element ref — the GRID-13 paste listener attaches here (scoped to grid
  // focus, NOT document, so we don't hijack pastes elsewhere on the page).
  const gridWrapRef = useRef<HTMLDivElement>(null);

  // POP/Dealer-Kit modal: which kit row is open (rowKey), or null when closed (D3-13/14).
  const [popRowKey, setPopRowKey] = useState<string | null>(null);

  // GRID-13 overflow note — set when a pasted block has cells outside the editable area.
  const [pasteNote, setPasteNote] = useState<string | null>(null);

  // P2-4: persistent "last saved HH:MM" stamp. The SaveBar's "Saved" flash
  // expires in 3s; this survives so a reviewer who saved and Alt-Tabbed away
  // can still see the last successful save time when they come back.
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

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

  // version counter bumped when the React-side view of rowsRef needs to update
  // (conflict banners, GridStats, POP modal). AG Grid itself reflects edits via
  // applyTransaction — it does NOT depend on this counter.
  const [rowsVersion, setRowsVersion] = useState(0);
  const bumpRowsVersion = useCallback(() => setRowsVersion((v) => v + 1), []);

  // ---------------------------------------------------------------------------
  // Filter state — driven by FilterBar, consumed by AG Grid external filter.
  // P2-5: seed from the URL-derived initial filters so a shared/reloaded link
  // (or filters carried across an activity switch) apply on first paint.
  // ---------------------------------------------------------------------------
  const [facetSelections, setFacetSelections] = useState<FacetSelections>(
    initialFacets ?? {},
  );
  const [sfidSearch, setSfidSearch] = useState<string>(initialSfid);

  // GRID-09 Fix 3: defer the typed SFID search so onFilterChanged() does not re-run
  // once per keystroke. facetSelections changes are discrete (dropdown clicks) and
  // don't need deferral — only the free-text search does.
  const deferredSfid = useDeferredValue(sfidSearch);

  // Refs so the AG Grid callbacks (isExternalFilterPresent / doesExternalFilterPass)
  // always see the latest values without stale closures.
  const facetRef = useRef<FacetSelections>(initialFacets ?? {});
  const sfidRef = useRef<string>(initialSfid);

  useEffect(() => {
    facetRef.current = facetSelections;
    sfidRef.current = deferredSfid;
    apiRef.current?.onFilterChanged();
    // P2-5: keep the URL in sync with whatever drives the filter (the bar or
    // the clickable Pending stat). Uses the DEFERRED sfid so the URL only
    // updates after typing settles — saves history churn.
    syncFilterUrl(facetSelections, deferredSfid);
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
  // P3: highlight rows flagged as version-conflicts so the single summary banner
  // ("N rows conflicted") points at something visible in the grid.
  const rowClassRules = useMemo(
    () => ({
      "ag-row-placeholder": (p: { data?: UnitRow }) =>
        Boolean(p.data?.isPlaceholder) && !p.data?.dirty,
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
          // Typed/pasted value matches the formula — clear any prior override
          // flag so the cell goes back to "tracking the formula."
          clearOverride(newFields, fieldsKey);
        }
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

      // P2-1: let GridStats re-derive (status changes per cell-commit, NOT per
      // keystroke — AG Grid commits on blur/Enter, so this is one render per
      // cell change, not a typing storm).
      bumpRowsVersion();
    },
    [activityKey, bumpRowsVersion],
  );

  // ---------------------------------------------------------------------------
  // handleAddUnit — clone the row's plan context for a new "+ add unit" row.
  // ---------------------------------------------------------------------------
  function handleAddUnit(row: UnitRow) {
    const newRow = cloneUnitForAdd(row);
    rowsRef.current.set(newRow.rowKey, newRow);
    // Insert ONLY the new node — no full rowData rebuild (GRID-09).
    apiRef.current?.applyTransaction({ add: [newRow] });
    bumpRowsVersion();
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
        bumpRowsVersion();
      }
      setPopRowKey(null);
      const node = apiRef.current?.getRowNode(rowKey);
      if (node) apiRef.current?.refreshCells({ rowNodes: [node], force: true });
    },
    [bumpRowsVersion],
  );

  // ---------------------------------------------------------------------------
  // clearOverrideForRow — called from a "reset to formula" affordance (inline button).
  // ---------------------------------------------------------------------------
  const handleClearOverride = useCallback(
    (rowKey: string, fieldKey: string) => {
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
        bumpRowsVersion();
      }
      // Refresh the specific cell so the valueGetter fires again.
      const node = apiRef.current?.getRowNode(rowKey);
      if (node) {
        apiRef.current?.refreshCells({ rowNodes: [node], force: true });
      }
    },
    [bumpRowsVersion],
  );
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
  // P2-4: stamp the last successful save time when at least one row committed.
  // ---------------------------------------------------------------------------
  const handleSaveResult = useCallback((result: SaveBatchState) => {
    if (!result.ok) return;

    if (result.savedIds.length > 0) {
      setLastSavedAt(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    }

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
    if (result.conflicts.length > 0 || updated.length > 0) {
      bumpRowsVersion();
    }
  }, [bumpRowsVersion]);

  // ---------------------------------------------------------------------------
  // handleConflictReload — P1-2: re-fetch the ONE stale row, patch it in place.
  // Previously this did window.location.reload(), which discarded every other
  // unsaved edit in the batch. Now we call fetchExecutionForRow for the single
  // conflicting executionId and patch only that row into rowsRef via
  // applyTransaction. All other dirty rows survive. Falls back to a full reload
  // only if the action fails hard (network, deleted row) — correctness escape
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
        // A full reload re-syncs the whole grid (the row's identity is gone).
        window.location.reload();
        return;
      }

      const existing = rowsRef.current.get(rowKey);
      if (!existing) return;
      const patched: UnitRow = {
        ...existing,
        version: result.version,
        fields: result.fields, // server-fresh; __conflict cleared by replacement
        popLines: result.popLines, // undefined for non-kit rows; intentional
        dirty: false,
        isPlaceholder: false,
      };
      rowsRef.current.set(rowKey, patched);
      apiRef.current?.applyTransaction({ update: [patched] });

      // Reloaded rows are no longer dirty.
      setDirtyKeys((prev) => {
        if (!prev.has(rowKey)) return prev;
        const next = new Set(prev);
        next.delete(rowKey);
        return next;
      });

      // Bump so the conflict summary banner re-derives (this row is no longer
      // flagged as a conflict).
      bumpRowsVersion();
    },
    [activityCfg, bumpRowsVersion],
  );

  // ---------------------------------------------------------------------------
  // Save flow (GRID-12) — SINGLE source of truth.
  //
  // useSaveExecutions owns the ONE useActionState / submit / onResult. Both SaveBar
  // instances (top + bottom) and the Ctrl/Cmd+S shortcut call the SAME `submit`, share
  // the SAME `pending`, and read the SAME dirtyCount — so there is never a double-submit
  // or a divergent count.
  // ---------------------------------------------------------------------------
  const dirtyRowsRef = useRef<UnitRow[]>(dirtyRows);
  dirtyRowsRef.current = dirtyRows;

  const getDirtyUnits = useCallback((): UnitPatch[] => {
    return dirtyRowsRef.current.map((row) => ({
      rowKey: row.rowKey,
      planRowId: row.planRowId,
      executionId: row.executionId,
      version: row.version,
      fields: row.fields,
      isPlaceholder: row.isPlaceholder,
      // POP/Dealer-Kit lines (undefined for non-POP rows → normal insert/update path;
      // an array → the action routes through savePopKit: one execution + N execution_items).
      popLines: row.popLines,
    }));
  }, []);

  const { submit, pending, state: saveState } = useSaveExecutions(
    getDirtyUnits,
    activityKey,
    periodId,
    handleSaveResult,
  );

  const dirtyCount = dirtyKeys.size;

  // ---------------------------------------------------------------------------
  // Ctrl/Cmd+S — ONE window keydown listener calling the SAME submit (GRID-12).
  // Works regardless of which bar is visible. Guards on dirty && !pending so it never
  // double-submits and never fires an empty save. preventDefault suppresses the browser's
  // own Save dialog.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirtyCount > 0 && !pending) submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirtyCount, pending, submit]);

  // ---------------------------------------------------------------------------
  // P1-3: warn before leaving with unsaved edits. A reviewer who Alt-Tabs to an
  // Excel reference and then closes/navigates the tab would otherwise lose every
  // unsaved correction silently. The browser shows its native "Leave site?"
  // prompt only while there is at least one dirty row.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy requirement for some browsers to actually show the prompt.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  // ---------------------------------------------------------------------------
  // GRID-13 — paste-block handler.
  //
  // AG Grid Community has NO clipboard/range/fill (all Enterprise, R7) — so this is a plain
  // DOM `paste` listener on the grid container ref (scoped to grid focus, not document).
  //
  // Flow:
  //   1. Read clipboardData text/plain; require a focused cell (the anchor).
  //   2. Parse Excel/Sheets TSV into a 2-D array (\n rows, \t cols).
  //   3. Map onto the EDITABLE fields.* columns at/after the anchor, left→right
  //      (read-only plan.* and action columns are SKIPPED — security + default rule).
  //   4. Walk DISPLAYED rows from the anchor down via getDisplayedRowAtIndex (R5 — respects
  //      the active sort/filter; never the rowData array order).
  //   5. Coerce each cell per its column kind (coerceForKind); derived cells get the override
  //      flag (setOverride — LOCKED, identical to a manual edit).
  //   6. Write the WHOLE block via ONE applyTransaction({ update }) (GRID-09 batched path),
  //      mark the changed rows dirty in ONE setState, and surface an overflow note for any
  //      cells that fell off the right edge or the bottom.
  //
  // Security invariant (LOCKED): writes ONLY fields.* on EXISTING displayed rows (each
  // already has a planRowId). It can NEVER introduce an SFID or bypass the off-plan guard.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const el = gridWrapRef.current;
    if (!el) return;

    const onPaste = (e: ClipboardEvent) => {
      const api = apiRef.current;
      if (!api) return;

      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;

      const focused = api.getFocusedCell();
      if (!focused) return;
      e.preventDefault();

      // (2) Parse TSV: strip a single trailing newline, then split rows + columns.
      const matrix = text
        .replace(/\r\n?$|\n$/, "")
        .split(/\r\n|\n|\r/)
        .map((line) => line.split("\t"));

      // (3) Editable fields.* columns at/after the anchor (skip read-only plan.* + actions).
      const allCols = api.getAllDisplayedColumns();
      const anchorColIdx = allCols.findIndex(
        (c) => c.getColId() === focused.column.getColId(),
      );
      if (anchorColIdx < 0) return;
      const editableCols = allCols.slice(anchorColIdx).filter((c) => {
        const def = c.getColDef();
        return (
          def.editable === true &&
          typeof def.field === "string" &&
          def.field.startsWith("fields.")
        );
      });

      // Resolve a column's coercion kind via the activity registry (default "text").
      const kindOf = (col: Column): FieldKind => {
        const field = col.getColDef().field;
        const key =
          typeof field === "string" && field.startsWith("fields.")
            ? field.slice("fields.".length)
            : "";
        return kindByKey.get(key) ?? "text";
      };

      // (4)+(5) Walk displayed rows from the anchor down; coerce + write into cloned fields.
      const changed: UnitRow[] = [];
      let dropped = 0;

      for (let i = 0; i < matrix.length; i++) {
        const node = api.getDisplayedRowAtIndex(focused.rowIndex + i);
        if (!node?.data) {
          // Ran off the bottom — every cell in this pasted row is dropped.
          dropped += matrix[i].length;
          continue;
        }
        const row = rowsRef.current.get(node.data.rowKey);
        if (!row) {
          dropped += matrix[i].length;
          continue;
        }

        const newFields = { ...row.fields };
        for (let j = 0; j < matrix[i].length; j++) {
          const col = editableCols[j];
          if (!col) {
            dropped++; // Ran off the right edge (no editable column here).
            continue;
          }
          const def = col.getColDef();
          const key = (def.field as string).slice("fields.".length);
          const coerced = coerceForKind(matrix[i][j], kindOf(col));
          newFields[key] = coerced;
          // Derived cell (has a valueGetter): a pasted value overrides the formula (LOCKED).
          if (def.valueGetter && coerced != null) {
            setOverride(newFields, key, true);
          }
        }

        const updated: UnitRow = {
          ...row,
          fields: newFields,
          dirty: true,
          isPlaceholder: false, // pasting promotes a placeholder to a real row
        };
        rowsRef.current.set(node.data.rowKey, updated);
        changed.push(updated);
      }

      // (6) ONE transaction for the whole block (GRID-09 batched write).
      if (changed.length > 0) {
        api.applyTransaction({ update: changed });
        setDirtyKeys((prev) => {
          const next = new Set(prev);
          for (const r of changed) next.add(r.rowKey);
          return next;
        });
        bumpRowsVersion();
      }

      // Overflow note — neutral inline note (planner copy). Auto-dismisses.
      if (dropped > 0) {
        setPasteNote(
          `Pasted block; ${dropped} cell${dropped === 1 ? "" : "s"} outside the editable area ${dropped === 1 ? "was" : "were"} ignored.`,
        );
      } else {
        setPasteNote(null);
      }
    };

    el.addEventListener("paste", onPaste);
    return () => el.removeEventListener("paste", onPaste);
    // `mounted` is REQUIRED in deps: the A3 mounted-guard renders a placeholder on the first
    // render, so gridWrapRef.current is null then and the effect bails at `if (!el) return`.
    // Without `mounted`, the effect never re-runs after the real grid div mounts (kindByKey is
    // stable), leaving the paste listener permanently unattached (GRID-13 dead). Re-running on
    // mount attaches it once gridWrapRef.current exists.
  }, [kindByKey, mounted, bumpRowsVersion]);

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
  // Live row view — derived from the authoritative rowsRef on every rowsVersion
  // bump. Used by GridStats (P2-1) and the conflict summary banner (P3). The
  // grid itself does NOT consume this — it owns its own node data via
  // applyTransaction (GRID-09).
  // ---------------------------------------------------------------------------
  const liveRows = useMemo(
    () => [...rowsRef.current.values()],
    // rowsRef is mutable; rowsVersion is the explicit dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowsVersion],
  );

  const conflictRows = useMemo(
    () => liveRows.filter((r) => r.fields.__conflict),
    [liveRows],
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
      {/* Filter bar — controlled (P2-5). selected/sfid + onFacetChange/onSfidChange. */}
      <FilterBar
        allRows={initialRowData}
        selected={facetSelections}
        sfid={sfidSearch}
        onFacetChange={(sel) => setFacetSelections(sel)}
        onSfidChange={(s) => setSfidSearch(s)}
      />

      {/* P2-1: live status breakdown updates as the manager edits.
          Honest first cut — doesn't try to define "% executed" precisely
          (that's a Phase 4 spec call). Surfaces what we can measure cheaply:
          plan rows covered (≥1 execution) and status counts on recorded rows. */}
      <GridStats
        rows={liveRows}
        lastSavedAt={lastSavedAt}
        onFilterPending={handleFilterPending}
        pendingFilterActive={
          (facetSelections.status ?? []).length === 1 &&
          facetSelections.status?.[0] === "Pending"
        }
      />

      {/* Top save bar (GRID-12) — sticky top-0, ABOVE the grid container and BELOW
          FilterBar. z-30 clears AG Grid's pinned-header stacking context (R6). Shares the
          SAME submit/pending/dirtyCount/lastResult as the bottom bar (single source of
          truth). Rendered as a sibling of the grid container inside this flex column. */}
      <SaveBar
        slot="save-bar-top"
        dirtyCount={dirtyCount}
        pending={pending}
        lastResult={saveState}
        onSave={submit}
        className="sticky top-0 z-30"
      />

      {/* Grid container — explicit height required by AG Grid (A4).
          rowData is seeded ONCE; subsequent edits patch nodes via applyTransaction
          (GRID-09). getRowId is REQUIRED for transaction node-matching (R10).
          singleClickEdit: status opens on one click. animateRows=false: no layout
          cost on bulk updates for a data-entry grid. Virtualization stays ON.
          gridWrapRef: the GRID-13 paste listener attaches here (scoped to grid focus). */}
      <div
        ref={gridWrapRef}
        data-slot="grid-wrap"
        style={{ height: 600, width: "100%" }}
      >
        <AgGridReact<UnitRow>
          rowData={initialRowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDefWithClasses}
          getRowId={(p) => p.data.rowKey}
          rowClassRules={rowClassRules}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
          onCellValueChanged={handleCellValueChanged}
          stopEditingWhenCellsLoseFocus
          singleClickEdit
          animateRows={false}
        />
      </div>

      {/* GRID-13 paste overflow note — shown when a pasted block had cells outside the
          editable area (off the right edge or below the last displayed row). Dismissable. */}
      {pasteNote && (
        <div
          data-slot="paste-note"
          className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800"
        >
          <span>{pasteNote}</span>
          <button
            onClick={() => setPasteNote(null)}
            className="ml-4 rounded border border-amber-400 px-3 py-1 text-xs font-medium hover:bg-amber-100"
            aria-label="Dismiss paste note"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* P3: ONE collapsed conflict summary instead of a banner per row.
          Lists the conflicted SFIDs, points at the highlighted grid rows, and
          offers a single "Reload all" that re-fetches each conflicted row in
          place (preserving every other unsaved edit). The per-row data-slot is
          kept on hidden markers so existing e2e selectors still resolve. */}
      {conflictRows.length > 0 && (() => {
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

      {/* Bottom save bar (GRID-12) — sticky bottom-0. Shares the SAME save flow as the
          top bar via the useSaveExecutions hook (one submit / one pending / one count). */}
      <SaveBar
        slot="save-bar-bottom"
        dirtyCount={dirtyCount}
        pending={pending}
        lastResult={saveState}
        onSave={submit}
        className="sticky bottom-0"
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
// active recorded rows" (excludes Cancelled) — that avoids cancelling a
// dealer dragging the completion number down.
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
