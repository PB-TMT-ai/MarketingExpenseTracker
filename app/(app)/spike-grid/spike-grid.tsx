"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  ModuleRegistry,
  AllCommunityModule,
  type ColDef,
  type GridApi,
  type GridReadyEvent,
  type IRowNode,
} from "ag-grid-community";

// v33+ requires explicit module registration once, before first render.
// AllCommunityModule = the full free (MIT) feature set, no Enterprise key.
ModuleRegistry.registerModules([AllCommunityModule]);

type SpikeRow = {
  rowKey: string;
  // A1 probe: nested objects so dotted field paths ("plan.region") can be tested.
  plan: { region: string; state: string; sfid: string };
  fields: { length: number; breadth: number; status: string };
};

const REGIONS = ["North", "South", "East", "West"];
const STATES = ["Maharashtra", "Gujarat", "Karnataka", "Punjab"];
const STATUSES = ["Pending", "In Progress", "Done"];

function makeRows(n: number): SpikeRow[] {
  const rows: SpikeRow[] = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      rowKey: `r${i}`,
      plan: {
        region: REGIONS[i % REGIONS.length],
        state: STATES[i % STATES.length],
        sfid: `SFID-${String(i + 1).padStart(5, "0")}`,
      },
      fields: {
        length: (i % 10) + 1,
        breadth: (i % 5) + 1,
        status: STATUSES[i % STATUSES.length],
      },
    });
  }
  return rows;
}

export default function SpikeGrid() {
  // Mounted guard: render the grid only client-side (A3 — avoid SSR window access
  // without a dynamic import). If AG Grid still errors on the server *import*,
  // switch this file to a next/dynamic({ ssr: false }) wrapper and record A3.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rowData = useMemo(() => makeRows(800), []);
  const apiRef = useRef<GridApi<SpikeRow> | null>(null);
  const regionRef = useRef<string>(""); // read by the external-filter callbacks
  const [region, setRegion] = useState<string>("");
  const [sfidSearch, setSfidSearch] = useState<string>("");

  const columnDefs = useMemo<ColDef<SpikeRow>[]>(
    () => [
      // A1: dotted nested field paths, read-only plan columns
      { headerName: "Region (plan, RO)", field: "plan.region", editable: false },
      { headerName: "SFID (plan, RO)", field: "plan.sfid", editable: false },
      {
        headerName: "Length",
        field: "fields.length",
        editable: true,
        cellEditor: "agNumberCellEditor",
      },
      {
        headerName: "Breadth",
        field: "fields.breadth",
        editable: true,
        cellEditor: "agNumberCellEditor",
      },
      {
        // Derived column (D3-04/05 mechanic): valueGetter + change detection
        headerName: "Total Sq Ft (derived)",
        editable: false,
        valueGetter: (p) =>
          p.data ? p.data.fields.length * p.data.fields.breadth : null,
      },
      {
        // Custom select editor in Community (no Enterprise key needed)
        headerName: "Status",
        field: "fields.status",
        editable: true,
        cellEditor: "agSelectCellEditor",
        cellEditorParams: { values: STATUSES },
      },
    ],
    [],
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({ flex: 1, minWidth: 120, resizable: true }),
    [],
  );

  // External (custom) filter — Set Filter is Enterprise, so we drive an external
  // predicate from a plain <select> (the D3-06 mechanic, in miniature).
  const isExternalFilterPresent = useCallback(() => regionRef.current !== "", []);
  const doesExternalFilterPass = useCallback(
    (node: IRowNode<SpikeRow>) =>
      !node.data || node.data.plan.region === regionRef.current,
    [],
  );

  const onGridReady = useCallback((e: GridReadyEvent<SpikeRow>) => {
    apiRef.current = e.api;
    // Spike-only: expose the API so the GO/NO-GO check can drive filters/values
    // programmatically (avoids column-virtualization DOM flakiness). Removed with the spike.
    (window as unknown as { __spikeApi?: GridApi<SpikeRow> }).__spikeApi = e.api;
  }, []);

  function onRegionChange(value: string) {
    regionRef.current = value;
    setRegion(value);
    apiRef.current?.onFilterChanged();
  }

  if (!mounted) {
    return <div className="p-6 text-sm text-neutral-500">Loading grid…</div>;
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <label className="text-sm">
          Region:{" "}
          <select
            value={region}
            onChange={(e) => onRegionChange(e.target.value)}
            className="rounded border border-neutral-300 px-2 py-1 text-sm"
          >
            <option value="">(all)</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <input
          value={sfidSearch}
          onChange={(e) => setSfidSearch(e.target.value)}
          placeholder="Search SFID…"
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        />
        <span className="text-xs text-neutral-500">{rowData.length} rows</span>
      </div>
      <div style={{ height: 600, width: "100%" }}>
        <AgGridReact<SpikeRow>
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={(p) => p.data.rowKey}
          quickFilterText={sfidSearch}
          isExternalFilterPresent={isExternalFilterPresent}
          doesExternalFilterPass={doesExternalFilterPass}
          onGridReady={onGridReady}
        />
      </div>
    </div>
  );
}
