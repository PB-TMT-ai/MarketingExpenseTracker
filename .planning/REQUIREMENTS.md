# Requirements: Marketing Expense Tracker

**Defined:** 2026-06-04
**Core Value:** Spend stays inside the plan, and execution progress is always visible (only planned SFIDs can receive actuals; "% of plan executed" is the headline metric).

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Access

- [ ] **ACCESS-01**: User can unlock the app with a shared password; the session persists via a secure signed cookie until logout/expiry
- [ ] **ACCESS-02**: All data pages and actions are blocked until the password is entered (no public access on the Vercel URL)

### Activities (config registry)

- [ ] **ACTV-01**: System supports six activity types — Counter Wall Painting, GSB, NLB, In-shop Branding, POP/Dealer Kit, Dealer Certificate — each defined by a config entry
- [ ] **ACTV-02**: Each activity declares its own plan columns and actual columns (type: measurement / item-list / status); the grid, import, and export all read from this config
- [ ] **ACTV-03**: Adding a new activity later is a config change — no new screens or bespoke code
- [ ] **ACTV-04**: User can manage the selectable item list (item master) used for POP / dealer-kit entry

### Periods

- [ ] **PRD-01**: User can create a planning period (month / quarter / FY) and mark it active
- [ ] **PRD-02**: Plans and actuals are scoped to a period; selecting a period shows only that period's data

### Plan Upload

- [ ] **PLAN-01**: User can download an Excel template for a selected activity, pre-filled with the exact expected headers
- [ ] **PLAN-02**: User can upload an `.xlsx` plan for an activity + period; headers are validated against the activity config before anything is saved
- [ ] **PLAN-03**: Upload shows a preview with per-row results (valid / duplicate SFID / error) before the user commits
- [ ] **PLAN-04**: On commit, plan rows become the master list of allowed SFIDs for that activity + period
- [ ] **PLAN-05**: Plan rows capture shared who/where fields (Region, State, District, Taluka, Distributor, Dealer) plus activity-specific plan fields, including planned cost/budget
- [ ] **PLAN-06**: Re-uploading a plan for a period that already has actuals is non-destructive — existing executions are preserved (merge/reconcile, with a warning)

### Actuals Grid

- [ ] **GRID-01**: User can view a period's plan rows for an activity in an editable, spreadsheet-style grid
- [ ] **GRID-02**: Plan columns are read-only; actual columns are editable inline
- [ ] **GRID-03**: User can filter rows by Region, State, District, Distributor, and Status, and search by SFID
- [ ] **GRID-04**: System auto-calculates derived values (sq ft from dimensions; total cost from sq ft × rate) and stores them; derived cells are read-only
- [ ] **GRID-05**: A planned dealer (SFID) can have multiple execution entries (e.g. several walls/boards), each with its own measurements and cost, summing toward that dealer's plan
- [ ] **GRID-06**: User can record POP / dealer-kit executions as multiple line items via a popup (item, qty, rate → total), rolled up to the dealer row
- [ ] **GRID-07**: Edits are saved reliably (batched, with a clear saved/dirty indicator) and the grid stays responsive at large row counts
- [ ] **GRID-08**: Dealer Certificate entry captures issuance status, date, and cost

### Compliance

- [ ] **COMP-01**: The system structurally prevents recording an actual against an SFID not present in the plan (off-plan guard enforced at the database level)
- [ ] **COMP-02**: Off-plan rows from an actuals import are listed so the user can see what was rejected and why
- [ ] **COMP-03**: System computes "% of plan executed" (completeness) for the active period, per activity and per filter scope

### Dashboard

- [ ] **DASH-01**: On login, user sees a dashboard with % plan executed and planned/executed/pending counts for the active period
- [ ] **DASH-02**: Dashboard breaks down execution and spend by activity and by region
- [ ] **DASH-03**: Dashboard shows planned budget vs actual spend
- [ ] **DASH-04**: Dashboard respects the active period and the Region/State/Distributor filters

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
| (to be mapped by roadmapper) | — | Pending |

**Coverage:**
- v1 requirements: 30 total
- Mapped to phases: 0 (pending roadmap)
- Unmapped: 30 ⚠️ (resolved when ROADMAP.md is created)

---
*Requirements defined: 2026-06-04*
*Last updated: 2026-06-04 after initial definition*
