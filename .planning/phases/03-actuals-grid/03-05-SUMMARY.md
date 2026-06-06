---
phase: 03-actuals-grid
plan: 05
subsystem: pop-modal-and-cert
tags: [pop, dealer-kit, dealer-certificate, modal, item-master, e2e, D3-13, D3-14, D3-15, GRID-06, GRID-08]

# Dependency graph
requires:
  - phase: 03-02
    provides: computeDerived("pop-dealer-kit","lineTotal",{qty,rate}) for live line totals
  - phase: 03-03
    provides: saveExecutionsBatch popLines path + savePopKit (one execution + N execution_items, replace-all, name snapshot)
  - phase: 03-04
    provides: the /actuals grid + page (loads active item master) + Save bar this plan extends
provides:
  - "app/(app)/actuals/pop-modal.tsx → PopModal (ACTIVE item picker, add/remove lines, qty×rate live total, subtotal rollup)"
  - "actuals-grid: item-list activities render a 'Kit' column (count + total) whose button opens PopModal; non-item-list unchanged"
  - "lib/db/executions.ts → listKitLines(executionIds) (loads existing kit lines so re-open shows them / re-save doesn't wipe)"
  - "lib/actuals/rows.ts → UnitRow.popLines + PopLineInput type"
  - "e2e/fixtures: plan-pop-dealer-kit.xlsx + plan-dealer-certificate.xlsx"
affects: [phase-4 dashboard (kit total_cost rolls up as spend), phase-5 export (POP rows export the rolled total)]

# Tech tracking
tech-stack:
  patterns:
    - "POP kit = ONE row per dealer edited via a Tailwind modal (NOT inline per-line cells). The grid's item-list branch shows plan cols + a single 'Kit' button column; everything else stays the registry-driven inline grid (ACTV-03 preserved)."
    - "Modal writes popLines + rolled totalCost back into the kit UnitRow and marks it dirty; the EXISTING Save bar flushes it through saveExecutionsBatch → savePopKit. The modal never persists directly (one batched, guarded save path)."
    - "itemName is a TEXT SNAPSHOT (D-08): the picker offers ACTIVE master names plus any snapshot name already on a line (so re-editing a kit whose item was retired still shows it); the stored value is the name string, never the item id/FK."
    - "Existing kit lines are loaded (listKitLines) and attached to rows server-side — closes the re-save-wipes-lines footgun inherent in savePopKit's replace-all semantics."
    - "Dealer Certificate (status-type) needed NO grid change — Status (Pending/In Progress/Done, Done=Issued) + Date + Cost record through the registry-driven inline grid from 03-04; this plan only verified it + added e2e."

key-files:
  created:
    - app/(app)/actuals/pop-modal.tsx
    - e2e/fixtures/plan-pop-dealer-kit.xlsx
    - e2e/fixtures/plan-dealer-certificate.xlsx
  modified:
    - app/(app)/actuals/actuals-grid.tsx
    - app/(app)/actuals/save-bar.tsx
    - app/(app)/actuals/page.tsx
    - lib/db/executions.ts
    - lib/actuals/rows.ts
    - e2e/actuals.spec.ts
    - e2e/fixtures/build-fixtures.ts

status: complete
requirements: [GRID-06, GRID-08]
commits:
  - "898f392: feat(03-05): POP/Dealer-Kit multi-item modal + kit-row wiring (GRID-06)"
  - "c16a774: test(03-05): POP-kit + Dealer-Certificate e2e + fixtures (GRID-06/08)"
---

# Phase 03 · Plan 05 — POP multi-item modal + Dealer Certificate — SUMMARY

The two activity shapes that don't fit plain inline cells, completing GRID-01..08.

## POP / Dealer-Kit (GRID-06, D3-13/14)

- **`PopModal`** (`app/(app)/actuals/pop-modal.tsx`) — a plain Tailwind overlay opened for one
  kit row. Props: `{ planContext, initialLines: PopLineInput[], items, onConfirm(lines), onClose }`.
  Each line = an ACTIVE item-master `<select>` (value = item **name**, snapshot per D-08) + Qty +
  Rate; **Line Total = computeDerived("pop-dealer-kit","lineTotal",{qty,rate}) = qty×rate** live;
  add/remove lines; a **subtotal** rolls up to the kit row total. On **Done** it writes
  `popLines` + `fields.totalCost` back to the row and marks it dirty — it does **not** save.
- **Grid wiring** — for `activityCfg.type === "item-list"` the grid renders plan columns +
  a single **"Kit"** column (`data-slot="pop-edit"`) showing `N items · ₹total` that opens the modal.
  No inline per-line cells, no "+ add unit" (one kit per dealer).
- **Persistence** — the Save bar sends `popLines` in the unit patch; `saveExecutionsBatch`
  routes it to `savePopKit` (one execution + N `execution_items`, atomic, **replace-all**,
  item NAME snapshot — confirmed in 03-03). The kit's `total_cost` = sum of line totals (server).
- **Re-open safety** — `listKitLines(executionIds)` (added to `lib/db/executions.ts`) loads a
  saved kit's lines; `page.tsx` attaches them to the kit row so re-opening shows the items.
  Without this, savePopKit's replace-all would silently wipe lines on a re-save.

## Dealer Certificate (GRID-08, D3-15)

- **No grid change required.** A status-type activity records **Status (Pending / In Progress /
  Done — "Done" = Issued) + Date + Cost inline** through the registry-driven grid from 03-04
  (the status enum was added to the registry in 03-02). Verified + covered by e2e.

## Verification

- `npx tsc --noEmit`: clean. `npm run build`: passes (`/actuals` dynamic).
- `npm test`: **195/195** unit tests green (no regression).
- `npx playwright test e2e/actuals.spec.ts`: **5/5 green** —
  - POP: open modal → Poster×2@100 (200.00) + Banner×3@50 (150.00) → subtotal **₹350.00** →
    confirm → kit cell "2 items · ₹350.00" → Save → **reload persists** (1 execution + 2 items).
  - Dealer Certificate: Status=Done + Date + Cost set inline → Save → **reload persists**; no POP modal.

## Phase 3 coverage — GRID-01..08 ALL DELIVERED

| Req | Where |
|-----|-------|
| GRID-01 editable grid | 03-04 `/actuals` |
| GRID-02 plan read-only / actual editable | 03-02 colDefs (dotted plan.* vs fields.*) |
| GRID-03 filter + SFID search | 03-02 filter + 03-04 FilterBar (cascading) |
| GRID-04 derived sq ft / total (overridable, D3-05) | 03-02 calc + 03-04 valueGetter |
| GRID-05 multi-unit per dealer | 03-02 rows + 03-04 "+ add unit" |
| GRID-06 POP multi-item popup | **03-05 PopModal** |
| GRID-07 batched save + dirty indicator + concurrency | 03-03 saveExecutionsBatch + 03-04 SaveBar |
| GRID-08 Dealer Certificate issuance | **03-05 (inline, registry-driven)** |

## Deviation note

03-05's planned `files_modified` was {pop-modal, actuals-grid, e2e}. To close the
re-save-wipes-lines footgun, this plan also touched `lib/db/executions.ts` (+listKitLines),
`app/(app)/actuals/page.tsx` (load lines), `lib/actuals/rows.ts` (UnitRow.popLines),
`save-bar.tsx` (send popLines), and `e2e/fixtures/build-fixtures.ts` (POP/cert fixtures).
All additive; full suite green.
