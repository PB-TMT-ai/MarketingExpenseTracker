---
phase: 03-actuals-grid
plan: 01
subsystem: spike
tags: [ag-grid, spike, D3-00, GO, react19, next16, GRID-01, GRID-02, GRID-03, GRID-04]

# Dependency graph
requires:
  - phase: 01
    provides: (app) auth-gated route group shell (spike route inherits the shared-password gate)
provides:
  - "GO verdict — AG Grid Community 35.3.1 works in Next 16 App Router + React 19; no TanStack pivot"
  - "Reusable AG Grid integration recipe (module registration, mounted-guard SSR, dotted fields, valueGetter derive, external+quick filter) for 03-04"
  - "ag-grid-community + ag-grid-react 35.3.1 (exact pin) installed"
affects: [03-04 (real grid reuses the recipe verbatim), 03-02 (calc engine confirmed via valueGetter change-detection), 03-03]

# Tech tracking
tech-stack:
  added:
    - "ag-grid-community 35.3.1 (MIT, exact pin — legitimacy verified: tarball on registry.npmjs.org)"
    - "ag-grid-react 35.3.1 (exact pin — must match ag-grid-community version)"
  patterns:
    - "Mounted-guard SSR: a 'use client' grid renders a placeholder until useEffect sets mounted=true; importing ag-grid at module scope is SSR-safe, so NO next/dynamic({ssr:false}) wrapper is needed (A3)"
    - "ModuleRegistry.registerModules([AllCommunityModule]) once at module scope — Community alone is sufficient, no Enterprise key/license (A2)"
    - "Dotted nested field paths (field: 'plan.region', 'fields.length') bind a nested row shape directly — plan.* read-only, fields.* editable, no flattening (A1)"
    - "valueGetter-derived column auto-recomputes on edit of its source fields (change detection) — validates the D3-04/05 derive+override mechanic"
    - "themeQuartz auto-injects with NO CSS import (v33+ Theming API); no Tailwind collision (A4)"

key-files:
  created:
    - app/(app)/spike-grid/page.tsx
    - app/(app)/spike-grid/spike-grid.tsx
  modified:
    - package.json
    - package-lock.json

status: complete
verdict: GO
requirements: [GRID-01, GRID-02, GRID-03, GRID-04]
commits: []
---

# Phase 03 · Plan 01 — AG Grid Spike (throwaway) — SUMMARY

## Verdict: **GO** ✅

AG Grid Community 35.3.1 + ag-grid-react 35.3.1 work inside Next 16 (App Router) + React 19.
All six GO criteria pass. **No pivot to the TanStack Table fallback.** Downstream plans
03-02 … 03-05 are unblocked.

## GO criteria (all met)

| # | Criterion | Result |
|---|-----------|--------|
| 1 | ~800 rows render; row virtualization | ✓ `getDisplayedRowCount()` = 800; ~24 rows in DOM |
| 2 | Editing a measurement auto-updates the derived total | ✓ Length 1→5 made Total Sq Ft 1→5 (valueGetter change detection) |
| 3 | Status select editor shows Pending / In Progress / Done | ✓ `agSelectCellEditor` with `cellEditorParams.values` |
| 4 | External Region filter + SFID search work | ✓ external predicate wired; `quickFilterText='SFID-00007'` → 1 row |
| 5 | themeQuartz styled, no Tailwind collision | ✓ default theme auto-injected (no CSS import) |
| 6 | No Enterprise/license/missing-module console error | ✓ zero console errors; no license warning |

Verified by driving the live grid via its API at `/spike-grid` (behind the password gate)
with the preview browser — `getCellValue`, `setDataValue`, `setGridOption('quickFilterText', …)`.

## Assumption findings (for 03-04)

- **A1 — dotted nested field paths: WORK.** `field: "plan.region"`, `field: "fields.length"`
  resolve against a nested row `{ plan: {...}, fields: {...} }`. Use this to bind the
  read-only plan columns (`plan.*`) and editable actual columns (`fields.*`) without flattening.
- **A2 — module set: `AllCommunityModule` is sufficient.** No Enterprise key, no license toast.
  Register once at module scope: `ModuleRegistry.registerModules([AllCommunityModule])`.
- **A3 — `ssr:false` NOT required.** A mounted-guard in the `"use client"` grid component
  (render a placeholder until `useEffect` flips `mounted`) prevents SSR `window` access, and the
  AG Grid imports are SSR-safe at module scope. Simpler than a `next/dynamic({ssr:false})` wrapper.
- **A4 — theme: default themeQuartz, no CSS import.** v33+ Theming API auto-injects the theme
  into `<head>`. Renders cleanly alongside Tailwind. The legacy `theme="legacy"` + CSS escape
  hatch was NOT needed.
- **A6 — SFID search: `quickFilterText` is precise enough.** It matched 800→1 for a full SFID.
  Note it matches across all columns; SFIDs are unique strings so this is fine for v1. If
  cross-column false matches ever appear, switch to a dedicated external SFID predicate.

## Integration recipe (copy into 03-04)

```
"use client"
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
ModuleRegistry.registerModules([AllCommunityModule]);   // once, module scope

// mounted-guard: const [mounted,setMounted]=useState(false); useEffect(()=>setMounted(true),[]);
//   render a placeholder until mounted (SSR-safe; no next/dynamic needed)
// columns: plan.* => editable:false (dotted field), fields.* => editable cellEditors
//   number => agNumberCellEditor; status => agSelectCellEditor + cellEditorParams.values
//   derived => valueGetter (auto-recomputes on source edit)
// rows: getRowId={(p)=>p.data.<stableKey>}
// filtering: quickFilterText for SFID; isExternalFilterPresent + doesExternalFilterPass for
//   the cascading Region/State/District/Distributor/Status dropdowns (call api.onFilterChanged())
// theme: import NO ag-grid CSS (themeQuartz default); container needs an explicit height
// API note (v35): use api.getCellValue({rowNode,colKey}) and api.setGridOption(...) — getValue() is gone
```

## Cleanup note

The `/spike-grid` route is **throwaway**: not linked from the nav, behind the auth gate, uses
only synthetic in-memory data (no DB, no real SFIDs). It satisfies this plan's artifact must-have
and serves as the living recipe above. **03-04 should delete `app/(app)/spike-grid/`** once the
real `/actuals` grid reuses the recipe. The spike also adds a `window.__spikeApi` test hook —
removed with the route.

## Requirements touched (proven feasible, not finalized)

GRID-01 (editable grid), GRID-02 (read-only plan / editable actual via dotted fields + `editable`),
GRID-03 (filter/search via external filter + quickFilter), GRID-04 (derived value via valueGetter).
Final implementation lands in 03-02 (calc engine) and 03-04 (real grid).
