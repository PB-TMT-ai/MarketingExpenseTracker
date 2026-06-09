"use client";

/**
 * AdhocGrid — editable AG Grid surface for adhoc (off-plan) expenses.
 *
 * Single-period scope. "Add row" appends a row with id=null, version=0; user edits
 * cells; Save dispatches saveAdhocExpenses. activityDate accepts DD/MM/YY or
 * DD/MM/YYYY and is normalised to ISO YYYY-MM-DD (the Server Action's Zod schema
 * requires ISO). The "Month of activity" column is read-only and derived at render
 * time from activityDate.
 *
 * Module registration is side-effect-imported via ./ag-grid-setup to mirror
 * actuals-grid.tsx (A2 finding: AllCommunityModule registered once per bundle).
 * No theme className on the wrapper — AG Grid v33+ Theming API auto-injects the
 * default themeQuartz, matching actuals-grid.
 *
 * Wiring into page.tsx is Task 3.9.
 */

import "./ag-grid-setup";
import { useCallback, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridReadyEvent } from "ag-grid-community";
import { saveAdhocExpenses } from "@/lib/actions/adhoc";
import { ACTIVITIES, ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { AdhocRow } from "@/lib/db/adhoc";

type GridRow = {
  id: number | null;
  periodId: number;
  region: string | null;
  state: string | null;
  district: string | null;
  taluka: string | null;
  activity: string | null;
  activityDate: string | null;
  budgetHeader: string | null;
  expenseAmount: number | null;
  vendorName: string | null;
  remarks: string | null;
  version: number;
  _dirty?: boolean;
};

function toGridRow(r: AdhocRow): GridRow {
  return {
    id: r.id,
    periodId: r.periodId,
    region: r.region,
    state: r.state,
    district: r.district,
    taluka: r.taluka,
    activity: r.activity,
    activityDate: r.activityDate,
    budgetHeader: r.budgetHeader,
    expenseAmount: r.expenseAmount == null ? null : Number(r.expenseAmount),
    vendorName: r.vendorName,
    remarks: r.remarks,
    version: r.version,
  };
}

const ACTIVITY_LABEL_SUGGESTIONS = ACTIVITY_KEYS.map((k) => ACTIVITIES[k].label);

function monthOf(dateIso: string | null): string {
  if (!dateIso) return "";
  const d = new Date(dateIso + "T00:00:00Z");
  return d.toLocaleString("en-IN", { month: "short", year: "numeric" });
}

export default function AdhocGrid({
  initialRows,
  periodId,
}: {
  initialRows: AdhocRow[];
  periodId: number;
}) {
  const gridRef = useRef<AgGridReact<GridRow>>(null);
  const [rowData, setRowData] = useState<GridRow[]>(() =>
    initialRows.map(toGridRow),
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  const columnDefs = useMemo<ColDef<GridRow>[]>(
    () => [
      { field: "region", headerName: "Region", editable: true },
      { field: "state", headerName: "State", editable: true },
      { field: "district", headerName: "District", editable: true },
      { field: "taluka", headerName: "Taluka", editable: true },
      {
        field: "activity",
        headerName: "Activity",
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: ACTIVITY_LABEL_SUGGESTIONS },
      },
      {
        field: "activityDate",
        headerName: "Date of activity",
        editable: true,
        valueParser: (p) => {
          const v = p.newValue;
          if (!v) return null;
          const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
          if (m) {
            const dd = m[1].padStart(2, "0");
            const mm = m[2].padStart(2, "0");
            let yyyy = m[3];
            if (yyyy.length === 2) yyyy = `20${yyyy}`;
            return `${yyyy}-${mm}-${dd}`;
          }
          if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return String(v);
          return p.oldValue;
        },
      },
      {
        headerName: "Month of activity",
        editable: false,
        valueGetter: (p) => monthOf(p.data?.activityDate ?? null),
      },
      { field: "budgetHeader", headerName: "Budget header", editable: true },
      {
        field: "expenseAmount",
        headerName: "Expense (₹, ex-GST)",
        editable: true,
        valueParser: (p) => {
          const n = Number(p.newValue);
          return Number.isFinite(n) && n >= 0 ? n : p.oldValue;
        },
      },
      { field: "vendorName", headerName: "Vendor name", editable: true },
      { field: "remarks", headerName: "Remarks", editable: true },
    ],
    [],
  );

  const onCellValueChanged = useCallback((e: { data: GridRow }) => {
    e.data._dirty = true;
  }, []);

  function addRow() {
    setRowData((rows) => [
      ...rows,
      {
        id: null,
        periodId,
        region: null,
        state: null,
        district: null,
        taluka: null,
        activity: null,
        activityDate: null,
        budgetHeader: null,
        expenseAmount: null,
        vendorName: null,
        remarks: null,
        version: 0,
        _dirty: true,
      },
    ]);
  }

  async function save() {
    const grid = gridRef.current;
    if (!grid) return;
    setSaving(true);
    setStatus("Saving…");

    const dirty: GridRow[] = [];
    grid.api.forEachNode((node) => {
      if (node.data?._dirty) dirty.push(node.data);
    });

    if (dirty.length === 0) {
      setStatus("Nothing to save.");
      setSaving(false);
      return;
    }

    try {
      const res = await saveAdhocExpenses({
        periodId,
        rows: dirty.map((r) => ({
          id: r.id,
          region: r.region,
          state: r.state,
          district: r.district,
          taluka: r.taluka,
          activity: r.activity,
          activityDate: r.activityDate,
          budgetHeader: r.budgetHeader,
          expenseAmount: r.expenseAmount ?? 0,
          vendorName: r.vendorName,
          remarks: r.remarks,
          version: r.version,
        })),
      });
      setStatus(
        `Saved ${res.inserted + res.updated} row(s).${
          res.conflicts.length
            ? ` ${res.conflicts.length} conflict(s) — reload.`
            : ""
        }`,
      );
      window.location.reload();
    } catch (err) {
      setStatus(`Save failed: ${(err as Error).message}`);
      setSaving(false);
    }
  }

  const onGridReady = useCallback((_e: GridReadyEvent) => {
    /* no-op */
  }, []);

  return (
    <div data-slot="adhoc-grid" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={addRow}
          data-slot="adhoc-add-row"
          className="inline-flex h-10 items-center rounded-md border border-neutral-300 bg-white px-3 text-sm font-medium hover:bg-neutral-50"
        >
          + Add row
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-500" aria-live="polite">
            {status}
          </span>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-slot="adhoc-save"
            className="inline-flex h-10 items-center rounded-md bg-neutral-900 px-3 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ height: 480, width: "100%" }}>
        <AgGridReact<GridRow>
          ref={gridRef}
          rowData={rowData}
          columnDefs={columnDefs}
          onCellValueChanged={onCellValueChanged}
          onGridReady={onGridReady}
          singleClickEdit
          stopEditingWhenCellsLoseFocus
        />
      </div>
    </div>
  );
}
