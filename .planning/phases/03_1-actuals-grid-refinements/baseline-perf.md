# GRID-09 — Actuals Grid Hot-Path Performance Baseline (D3.1-06)

Markdown notes only — **NO git LFS, no binary `.json` Chrome profiles committed.** Numbers are
transcribed from the Chrome DevTools Performance panel (scripting time per keystroke + frame
behaviour) into the tables below.

This file proves the GRID-09 refactor. It is captured in two passes:

- **BEFORE** — the current clone-on-edit path, measured *before* any perf change lands (Task 1).
- **AFTER** — the `applyTransaction` + `useDeferredValue` path, measured at the human-verify
  checkpoint and transcribed in Task 3.

---

## Test setup

| Item | Value |
|------|-------|
| Dataset | ~500 `plan_rows` across all 6 activities (round-robin), one period |
| Seed command | `npm run perf:seed` (dev-only `lib/db/__smoke__/perf-seed.ts`, never in the prod bundle) |
| Screen | `/actuals?activity=counter-wall` (derived-totals activity — the worst case for the hot path) |
| Tool | Chrome DevTools → Performance panel, 4× CPU throttle, record while typing |
| Build | `next dev` (dev build; relative deltas are what matter, not absolute ms) |

### Scripted scenario (identical for BEFORE and AFTER)

1. Open `/actuals?activity=counter-wall` on the ~500-row seed period.
2. Focus the **Actual Sq Ft** cell on a mid-list row; type **10 characters**, then **Tab**.
3. Toggle the **Status** cell.
4. Type a query into the **SFID search** box (watch `onFilterChanged` re-runs).
5. Read off: **scripting time per keystroke**, **longest task (ms)**, and whether frames stay
   under the 16 ms (60 fps) budget.

---

## BEFORE — current clone-on-edit path

### What the current code does on EVERY keystroke (verified, `actuals-grid.tsx` pre-refactor)

The per-keystroke hot path was driven entirely off React state, so each `onCellValueChanged`
fired a cascade that touches all N rows:

1. `onCellValueChanged` → `setRowMap(prev => new Map(prev))` — **O(N)** Map clone on every edit
   (line 232 pre-refactor).
2. State change → `rowData = useMemo(() => Array.from(rowMap.values()), [rowMap])` rebuilds the
   **entire rowData array** (O(N), new array identity).
3. New `rowData` array identity → `<AgGridReact rowData={rowData}>` triggers a **full
   client-side row-model reconcile** (AG Grid diffs the whole array by `getRowId`).
4. State change → `dirtyRows = useMemo(() => Array.from(rowMap.values()).filter(r=>r.dirty),
   [rowMap])` **re-scans all N rows** to recompute the save-bar count — every keystroke, even
   when the dirty *set* did not change.
5. The conflict-marker render `Array.from(rowMap.values()).filter(...)` and the `FilterBar
   allRows={rowData}` prop also re-run on the new array identity.

Separately, the **SFID search** filter `useEffect` (`[facetSelections, sfidSearch]`) called
`apiRef.current?.onFilterChanged()` **once per keystroke with no debounce** — every character
re-ran `doesExternalFilterPass` across the row set.

**Complexity per keystroke: O(N)** in row count, with a full AG Grid reconcile each time — this
is the lag GRID-09 targets. At ~500 rows the per-edit work scales with the whole grid even
though a single cell changed.

### BEFORE measurements

> Transcribe from the Chrome Performance panel for the scenario above (Task 1).

| Metric | Value (BEFORE) |
|--------|----------------|
| Scripting time per keystroke (Actual Sq Ft) | _<fill at capture — current path>_ |
| Longest task during the 10-char type | _<fill>_ |
| Frames over 16 ms budget while typing | _<fill — observed jank: yes/no>_ |
| `onFilterChanged` runs while typing SFID search | one per keystroke (no debounce) |
| Reconcile scope per edit | full rowData array (all ~500 rows) |

**Qualitative BEFORE note:** visible input lag on the ~500-row counter-wall grid — the value
trails the keystrokes because each character pays the O(N) clone + full reconcile + full
dirty re-scan described above.

---

## AFTER — applyTransaction + dirtyKeys Set + useDeferredValue path

> Filled in Task 3, transcribed from the checkpoint capture on the SAME scenario/dataset.

### What the refactored code does on every keystroke

1. `handleCellValueChanged` reads/mutates the row in `rowsRef` (off-React Map) — **no React
   state churn, no Map clone per keystroke**.
2. `api.applyTransaction({ update: [updated] })` — AG Grid matches the node by `getRowId`
   (`rowKey`) and refreshes **only that one row's cells** (re-runs its `valueGetter` +
   `cellClassRules`). No full rowData rebuild, no full reconcile.
3. `setDirtyKeys` only changes state on the **first dirty edit of a row** (count change), so the
   save-bar re-render is rare, not per-keystroke.
4. `dirtyRows` is derived from `dirtyKeys` (recomputes only when the dirty *set* changes).
5. SFID search is deferred via `useDeferredValue(sfidSearch)` so `onFilterChanged` runs on the
   settled value, not once per keystroke.

**Complexity per keystroke: O(1)** for the edited row (single-node transaction) instead of O(N).

### AFTER measurements

| Metric | Value (AFTER) |
|--------|---------------|
| Scripting time per keystroke (Actual Sq Ft) | _<fill at checkpoint>_ |
| Longest task during the 10-char type | _<fill>_ |
| Frames over 16 ms budget while typing | _<fill>_ |
| `onFilterChanged` runs while typing SFID search | deferred (settles, not per keystroke) |
| Reconcile scope per edit | single row node (applyTransaction `update`) |

---

## Side-by-side & verdict

> Completed in Task 3.

| Metric | BEFORE | AFTER | Δ |
|--------|--------|-------|---|
| Scripting ms / keystroke | _<fill>_ | _<fill>_ | _<fill>_ |
| Reconcile scope | full array (O(N)) | single node (O(1)) | structural |
| SFID filter | per keystroke | deferred | structural |

**Target (D3.1-06):** `< 16 ms` scripting per keystroke (one frame) **OR** `>= 50%` reduction in
scripting time per edit vs BEFORE.

**Verdict:** _<MET / NOT MET — fill at checkpoint>_
