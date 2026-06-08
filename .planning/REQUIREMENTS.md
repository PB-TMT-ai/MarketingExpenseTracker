# Requirements: Marketing Expense Tracker

**Defined:** 2026-06-04
**Core Value:** Spend stays inside the plan, and execution progress is always visible (only planned SFIDs can receive actuals; "% of plan executed" is the headline metric).

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Access

- [x] **ACCESS-01**: User can unlock the app with a shared password; the session persists via a secure signed cookie until logout/expiry
- [x] **ACCESS-02**: All data pages and actions are blocked until the password is entered (no public access on the Vercel URL)

### Activities (config registry)

- [x] **ACTV-01**: System supports six activity types — Counter Wall Painting, GSB, NLB, In-shop Branding, POP/Dealer Kit, Dealer Certificate — each defined by a config entry
- [x] **ACTV-02**: Each activity declares its own plan columns and actual columns (type: measurement / item-list / status); the grid, import, and export all read from this config
- [x] **ACTV-03**: Adding a new activity later is a config change — no new screens or bespoke code
- [x] **ACTV-04**: User can manage the selectable item list (item master) used for POP / dealer-kit entry

### Periods

- [x] **PRD-01**: User can create a planning period (month / quarter / FY) and mark it active
- [x] **PRD-02**: Plans and actuals are scoped to a period; selecting a period shows only that period's data

### Plan Upload

- [x] **PLAN-01**: User can download an Excel template for a selected activity, pre-filled with the exact expected headers
- [x] **PLAN-02**: User can upload an `.xlsx` plan for an activity + period; headers are validated against the activity config before anything is saved
- [x] **PLAN-03**: Upload shows a preview with per-row results (valid / duplicate SFID / error) before the user commits
- [x] **PLAN-04**: On commit, plan rows become the master list of allowed SFIDs for that activity + period
- [x] **PLAN-05**: Plan rows capture shared who/where fields (Region, State, District, Taluka, Distributor, Dealer) plus activity-specific plan fields, including planned cost/budget
- [x] **PLAN-06**: Re-uploading a plan for a period that already has actuals is non-destructive — existing executions are preserved (merge/reconcile, with a warning)

### Actuals Grid

- [x] **GRID-01**: User can view a period's plan rows for an activity in an editable, spreadsheet-style grid
- [x] **GRID-02**: Plan columns are read-only; actual columns are editable inline
- [x] **GRID-03**: User can filter rows by Region, State, District, Distributor, and Status, and search by SFID
- [x] **GRID-04**: System auto-calculates derived values (sq ft from dimensions; total cost from sq ft × rate) and stores them; derived cells are auto-filled but **overridable** — a manual override is sticky, with a "reset to formula" affordance (per decision D3-05)
- [x] **GRID-05**: A planned dealer (SFID) can have multiple execution entries (e.g. several walls/boards), each with its own measurements and cost, summing toward that dealer's plan
- [x] **GRID-06**: User can record POP / dealer-kit executions as multiple line items via a popup (item, qty, rate → total), rolled up to the dealer row
- [x] **GRID-07**: Edits are saved reliably (batched, with a clear saved/dirty indicator) and the grid stays responsive at large row counts
- [x] **GRID-08**: Dealer Certificate entry captures issuance status, date, and cost
- [ ] **GRID-09**: Cell-input responsiveness in the actuals grid is no longer perceptibly laggy — edits land in-place without a full re-render on each keystroke, derived state (rowData, dirtyRows, external-filter triggers) is memoised, and a baseline profile proves the improvement (Phase 3.1)
- [x] **GRID-10**: Status defaults to "In Progress" for new placeholder rows and "+ add unit" clones; a one-time backfill sets `status = 'In Progress'` for executions where status IS NULL (Phase 3.1)
- [x] **GRID-11**: Done-row edits are unlocked — the P3 lock-on-Done is removed and every cell on a Done execution is editable like any other row (Phase 3.1)
- [ ] **GRID-12**: The Save control is reachable from the top of the grid as well as the bottom — a sticky save bar at the top mirrors the existing bottom save bar (same dirty count, same action) so save is always in reach on long grids (Phase 3.1)
- [ ] **GRID-13**: User can paste a block of cells copied from Excel/Sheets into the grid — pasting at a selected cell fills across columns and down rows, writing to multiple editable cells at once (custom clipboard handler; AG Grid Community has no built-in range paste). Read-only plan cells and derived/override cells are respected; pasted rows become dirty and save through the normal batch path (Phase 3.1)

### Compliance

- [x] **COMP-01**: The system structurally prevents recording an actual against an SFID not present in the plan (off-plan guard enforced at the database level)
- [x] **COMP-02**: Off-plan rows from an actuals import are listed so the user can see what was rejected and why
- [ ] **COMP-03**: System computes "% of plan executed" (completeness) for the active period, per activity and per filter scope
- [ ] **COMP-04**: User can record an "off-plan exception" execution (a dealer painted that wasn't in the uploaded plan) via a deliberate, audited affordance that creates ONE plan_row marked `source = 'exception'` plus the execution in a single transaction; bulk plan-upload off-plan rejection (COMP-01/COMP-02) is unchanged; exception rows are distinguishable from plan-uploaded rows for later dashboard reporting (Phase 3.1)

### Dashboard

- [ ] **DASH-01**: On login, user sees a dashboard with % plan executed and planned/executed/pending counts for the active period
- [ ] **DASH-02**: Dashboard breaks down execution and spend by activity and by region
- [ ] **DASH-03**: Dashboard shows planned budget vs actual spend
- [ ] **DASH-04**: Dashboard respects the active period and the Region/State/Distributor filters
- [ ] **DASH-05**: Dashboard surfaces a distinct **Cancelled** counter count alongside Planned / Executed / Pending; Cancelled rows are excluded from the "% executed" denominator (consistent with `TERMINAL_STATUSES` in `lib/activities/status.ts`)
- [ ] **DASH-06**: Within the active period the dashboard shows a week-wise trend of planned vs executed vs cancelled counters and weekly actual spend, bucketed by `executions.executionDate`; a standalone rolling "recent N weeks" view is selectable independently of the active period
- [ ] **DASH-07**: User can drill Zone (= `plan_rows.region`) → State → District → Taluka; each level shows planned / executed / cancelled counter counts and planned-vs-actual expense for the rows below it, reusing the cascade utility in `lib/actuals/filter.ts`

### Export

- [ ] **EXPT-01**: User can export the current filtered grid to `.xlsx` with correct numeric/currency typing and the activity's column order

## v2 Requirements

Acknowledged but deferred — not in the current roadmap.

### Reporting

- **RPT-01**: Period-over-period comparison views (requires ≥2 periods of data to be useful)
- **RPT-02**: Saved / shareable filter views (URL-encoded filter state)

### Evidence

- **EVID-01**: Upload proof photos per execution (deferred from v1 by decision; link-paste can bridge in the meantime)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Per-user accounts, roles, approval chains | Small trusted team shares one password; simplicity over per-user audit trails |
| Field-mobile capture with auto-GPS | Team enters data centrally; coordinates pasted from what vendors send |
| Compliance via sq-ft/cost tolerance vs plan | Compliance is off-plan guard + completeness only; sizes/cost are spend metrics, not pass/fail |
| Live Salesforce integration | SFID is a key only; no API sync in v1 |
| Richly-styled Excel export (fonts/fills/borders) | SheetJS Community Edition can't style cells; v1 exports clean, correctly-typed data |
| Autosave / real-time collaboration | Incompatible with the batch-commit model the off-plan guard and total calc rely on |

## Traceability

Which phases cover which requirements. Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ACCESS-01 | Phase 1 — Foundation | Complete |
| ACCESS-02 | Phase 1 — Foundation | Complete |
| ACTV-01 | Phase 1 — Foundation | Complete |
| ACTV-02 | Phase 1 — Foundation | Complete |
| ACTV-03 | Phase 1 — Foundation | Complete |
| ACTV-04 | Phase 1 — Foundation | Complete |
| PRD-01 | Phase 1 — Foundation | Complete |
| PRD-02 | Phase 1 — Foundation | Complete |
| COMP-01 | Phase 1 — Foundation | Complete |
| PLAN-01 | Phase 2 — Plan Upload & Periods | Complete |
| PLAN-02 | Phase 2 — Plan Upload & Periods | Complete |
| PLAN-03 | Phase 2 — Plan Upload & Periods | Complete |
| PLAN-04 | Phase 2 — Plan Upload & Periods | Complete |
| PLAN-05 | Phase 2 — Plan Upload & Periods | Complete |
| PLAN-06 | Phase 2 — Plan Upload & Periods | Complete |
| COMP-02 | Phase 2 — Plan Upload & Periods | Complete |
| GRID-01 | Phase 3 — Actuals Grid | Complete |
| GRID-02 | Phase 3 — Actuals Grid | Complete |
| GRID-03 | Phase 3 — Actuals Grid | Complete |
| GRID-04 | Phase 3 — Actuals Grid | Complete |
| GRID-05 | Phase 3 — Actuals Grid | Complete |
| GRID-06 | Phase 3 — Actuals Grid | Complete |
| GRID-07 | Phase 3 — Actuals Grid | Complete |
| GRID-08 | Phase 3 — Actuals Grid | Complete |
| GRID-09 | Phase 3.1 — Actuals Grid Refinements | Pending |
| GRID-10 | Phase 3.1 — Actuals Grid Refinements | Complete |
| GRID-11 | Phase 3.1 — Actuals Grid Refinements | Complete |
| GRID-12 | Phase 3.1 — Actuals Grid Refinements | Pending |
| GRID-13 | Phase 3.1 — Actuals Grid Refinements | Pending |
| COMP-04 | Phase 3.1 — Actuals Grid Refinements | Pending |
| COMP-03 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-01 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-02 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-03 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-04 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-05 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-06 | Phase 4 — Compliance & Dashboard | Pending |
| DASH-07 | Phase 4 — Compliance & Dashboard | Pending |
| EXPT-01 | Phase 5 — Excel Export | Pending |

**Coverage:**
- v1 requirements: 36 total
- Mapped to phases: 36
- Unmapped: 0

---
*Requirements defined: 2026-06-04*
*Last updated: 2026-06-08 — Phase 3.1 inserted; GRID-09/10/11/12/13 and COMP-04 added (36 total).*
