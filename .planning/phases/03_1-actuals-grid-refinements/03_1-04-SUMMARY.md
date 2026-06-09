# Plan 03_1-04 — SUMMARY (GRID-12 save bar top+bottom · GRID-13 paste-block)

**Status:** COMPLETE
**Requirements:** GRID-12, GRID-13
**Completed:** 2026-06-09

## What was built

- **GRID-12 — top + bottom save bar, single source of truth.** Lifted the save flow into a
  `useSaveExecutions` hook (one `useActionState`, one submit, one onResult). `save-bar.tsx` is now
  presentational (props in); two instances render — a sticky `top-0 z-30` bar above the grid and the
  existing sticky `bottom-0` bar, both reading the same dirty count / pending / result, so there is
  no double-submit or divergent count. Added one window `keydown` listener for **Ctrl/Cmd+S** that
  triggers the same submit. Bar roots carry `data-slot="save-bar-top"` / `"save-bar-bottom"`; inner
  `unsaved-count`/`save-button`/`save-confirmation` slots nest under each.
- **GRID-13 — paste a block from Excel/Sheets.** AG Grid Community has no clipboard/range/fill, so a
  plain DOM `paste` listener on the grid wrapper parses clipboard TSV, anchors on
  `getFocusedCell()`, maps onto editable `fields.*` columns left-to-right and displayed rows
  downward (respects sort/filter), coerces per column kind (`coerceForKind`: number/currency via
  `num`; DD/MM/YY date passthrough; lat/long/text as-is), sets the override flag on derived cells,
  writes the whole block in ONE `applyTransaction`, marks rows dirty, and shows an overflow note
  (`data-slot="paste-note"`) for cells outside the editable area. Writes ONLY `fields.*` on existing
  rows — never introduces an SFID (off-plan guard intact).

## Commits

- `aeea4a2` feat — GRID-12 single-source save flow (useSaveExecutions + top/bottom bars + Ctrl/Cmd+S)
- `3b96ed9` feat — GRID-13 paste-block handler (coerceForKind + DOM paste listener + one applyTransaction)
- `366abc3` fix — attach paste listener after mount (checkpoint-found bug, see below)
- `781d45a` test — GRID-12 two-bar + GRID-13 synthetic-paste e2e; re-scoped existing save selectors to `save-bar-bottom`

## Checkpoint (human-verify) — performed by orchestrator via gstack /browse

Against a live ~500-row seed (`npm run perf:seed`, 84 counter-wall rows, period set active):

| Check | Result |
|-------|--------|
| Two bars, same count | ✅ edit → both `save-bar-top` and `save-bar-bottom` show the same unsaved count |
| Top-bar save clears both | ✅ single submit; executions +1 (no double-submit) |
| Ctrl/Cmd+S | ✅ count "1" → "Saved successfully" → count gone |
| Paste 3×2 block | ✅ fills actualSqft + perUnitCost across, down 3 rows, all dirty |
| Overflow | ✅ "Pasted block; 2 cells outside the editable area were ignored" |
| Read-only plan cell | ✅ `plan.sfid` untouched by paste |
| Derived override | ✅ pasted value into `totalCost` set the override |
| Persistence | ✅ Save → executions persisted, survive reload |

### Checkpoint-found bug (fixed: `366abc3`)

GRID-13 was initially **dead**: the paste `useEffect` deps were `[kindByKey]` (stable), but it
reads `gridWrapRef.current`, which is null on the first render because of the A3 mounted-guard
placeholder. The effect bailed at `if (!el) return` and never re-ran, so the listener was never
attached. Fix: add `mounted` to the deps so the effect re-runs once the real grid div exists.
Re-verified working after the fix. This is exactly the failure the human-verify gate exists to catch.

## Deviations / notes

- **DEF-03_1-02-01** (carried): no ESLint configured in the project — eslint gates skipped; `tsc --noEmit` clean.
- e2e Test B dispatches the synthetic `ClipboardEvent` on the grid-wrapper/focused-cell (a descendant
  of `[data-slot="actuals-grid"]`), NOT the outer slot — events bubble up, so an ancestor dispatch
  never reaches the descendant listener.

## Self-Check: PASSED
