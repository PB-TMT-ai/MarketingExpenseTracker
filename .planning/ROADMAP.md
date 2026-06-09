# Roadmap: Marketing Expense Tracker

## Overview

This roadmap builds an internal plan-vs-actual spend tracker for the JSW marketing team along a strictly dependency-driven path. We first lay a load-bearing foundation (the typed activity registry, the period-scoped Postgres schema with the structural off-plan guard, item master, and the shared-password gate) because every write path depends on it. We then ingest approved plans — which define the master list of allowed SFIDs — before any actuals can be entered. With plan rows in place, the editable grid becomes the daily-use core for recording executions (multi-unit per SFID, POP line items, auto-calculated totals). Only once clean actuals exist do we layer on the compliance dashboard (% executed, budget vs spend) and, finally, filtered Excel export, which reuses the query and column order already built. Each phase produces something runnable and unblocks the next.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Activity registry, period-scoped schema with structural off-plan guard, item master, and shared-password gate (completed 2026-06-04)
- [x] **Phase 2: Plan Upload & Periods** - Per-activity Excel plan ingestion that establishes the allowed-SFID master list per period (completed 2026-06-05)
- [x] **Phase 3: Actuals Grid** - Editable spreadsheet-style grid for recording executions, filtering, and POP multi-item entry (completed 2026-06-06)
- [ ] **Phase 3.1: Actuals Grid Refinements** - INSERTED — fix input lag, default In-Progress status, unlock Done-row edits, off-plan exception path with audit trail, paste-block bulk entry, top+bottom save bar
- [ ] **Phase 4: Compliance & Dashboard** - Completeness math and the headline plan-executed / budget-vs-spend dashboard
- [ ] **Phase 5: Excel Export** - Export the current filtered grid to a correctly-typed `.xlsx`

## Phase Details

### Phase 1: Foundation
**Goal**: A new contributor can authenticate behind the shared password and the system has a working, period-scoped data model in which the off-plan guard is structurally impossible to bypass and every activity (plus its item list) is defined as config.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: ACCESS-01, ACCESS-02, ACTV-01, ACTV-02, ACTV-03, ACTV-04, PRD-01, PRD-02, COMP-01
**Success Criteria** (what must be TRUE):
  1. A user who enters the correct shared password gets a persistent signed-cookie session; without it, every data page and action is blocked on the deployed URL.
  2. All six activity types exist as config entries that declare their own plan/actual columns and type (measurement / item-list / status), and a seventh could be added by editing config alone.
  3. A user can create a planning period (month / quarter / FY), mark it active, and all plan/actual data is scoped to a period.
  4. The database makes it structurally impossible to attach an actual to an SFID that has no plan row for that activity + period (NOT NULL FK + UNIQUE match key), independent of any app-layer check.
  5. A user can manage the selectable item master used later for POP / dealer-kit entry.
  6. The entire app runs and is usable on a local machine with no cloud dependency (local embedded Postgres / PGlite), and switching to Supabase later requires only changing `DATABASE_URL`.
**Plans**: 5 plans (2 shipped, 3 gap-closure)
- [x] 01-01-PLAN.md — Walking skeleton: auth gate + dual-driver PGlite seam (ACCESS-01, ACCESS-02)
- [x] 01-02-PLAN.md — Period-scoped schema + structural off-plan guard (COMP-01)
- [x] 01-03-PLAN.md — Typed activity config registry, six activities (ACTV-01, ACTV-02, ACTV-03)
- [x] 01-04-PLAN.md — Period create + active-period scoping + switcher (PRD-01, PRD-02)
- [x] 01-05-PLAN.md — Item-master management UI + Server Actions (ACTV-04)
**UI hint**: yes

> **Discuss-step questions to resolve before locking the schema** (do not resolve now): plan-row grain for multi-unit activities (confirmed YES — one SFID maps to multiple executions/walls, so the UNIQUE match key and whether executions are unique per plan row must reflect this); budget/planned-cost column is confirmed PRESENT and must be modeled on plan rows as a numeric column; choose numeric (never float) money columns, a version column for optimistic concurrency, and `ON DELETE RESTRICT`. **Runtime: local-first** — develop/run against PGlite (embedded Postgres, zero install) behind a single `DATABASE_URL`, then deploy to **Supabase** by swapping that value (use Supabase's **pooled / transaction-mode** connection string on Vercel). Drizzle keeps the schema identical across both.

### Phase 2: Plan Upload & Periods
**Goal**: A user can load an approved Excel plan for a given activity + period and trust that, on commit, those plan rows become the authoritative master list of allowed SFIDs — with bad rows surfaced before anything is saved and existing actuals never destroyed by a re-upload.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05, PLAN-06, COMP-02
**Success Criteria** (what must be TRUE):
  1. A user can download an Excel template for a selected activity pre-filled with the exact expected headers.
  2. On upload, headers are validated against the activity config and the user sees a per-row preview (valid / duplicate SFID / error / off-plan) before committing anything.
  3. On commit, plan rows — including shared who/where fields and the planned-cost/budget column — are saved in one transaction and become the allowed-SFID master list for that activity + period.
  4. Re-uploading a plan for a period that already has actuals preserves existing executions (non-destructive merge/reconcile) and warns the user.
  5. Rows rejected as off-plan during an actuals import are listed so the user can see what was rejected and why.
**Plans**: 4 plans
- [ ] 04-01-PLAN.md — Status registry (STATUS_VALUES/TERMINAL_STATUSES + Cancelled rollout) + shared computeCompleteness helper (COMP-03, DASH-05)
- [ ] 04-02-PLAN.md — lib/db/dashboard.ts aggregate helpers + PGlite integration tests (COMP-03, DASH-01..07)
- [ ] 04-03-PLAN.md — Recharts install + /dashboard RSC + StatStrip/ByActivity/ByRegion/Exception cards + FilterBar + redirect from / (DASH-01..05, DASH-07)
- [ ] 04-04-PLAN.md — Recharts weekly trend + spend charts + rolling-N toggle + Zone-Taluka drill tree + Playwright e2e (DASH-06, DASH-07)
**UI hint**: yes

> **Discuss-step questions to resolve here** (do not resolve now): exact re-upload semantics (append vs upsert vs replace; policy for a plan row removed on re-upload that already has actuals — block / soft-archive / flag, never silent delete). Plan against a corpus of real vendor Excel files; handle DD/MM dates, IDs-as-text, rupee/comma stripping, header aliasing, and zero/multi-match cases.

### Phase 3: Actuals Grid
**Goal**: A user can open a period's plan rows for an activity in a fast, spreadsheet-style grid and record on-ground executions — including several walls/boards per dealer and multi-item POP kits — with totals auto-calculated and edits saved reliably without clobbering a teammate's work.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: GRID-01, GRID-02, GRID-03, GRID-04, GRID-05, GRID-06, GRID-07, GRID-08
**Success Criteria** (what must be TRUE):
  1. A user can view a period's plan rows for an activity in an editable grid where plan columns are read-only and actual columns are editable inline.
  2. A user can filter rows by Region, State, District, Distributor, and Status, and search by SFID, with the grid staying responsive at large row counts.
  3. A single planned dealer (SFID) can hold multiple execution entries (e.g. several walls/boards), each with its own measurements and cost, summing toward that dealer's plan.
  4. The system auto-calculates derived values (sq ft from dimensions; total cost from sq ft × rate), stores them, and shows derived cells as read-only.
  5. A user can record POP / dealer-kit executions as multiple line items via a popup (item × qty × rate → total) rolled up to the dealer row, and Dealer Certificate entry captures issuance status, date, and cost; edits are batched with a clear saved/dirty indicator.
**Plans**: 5 plans
- [x] 03-01-PLAN.md — Throwaway AG Grid Community spike with GO/NO-GO vs TanStack fallback (D3-00)
- [x] 03-02-PLAN.md — Pure lib/actuals/ core: calc engine, flat row model, registry→colDef mapper, cascading filter + status enumValues
- [x] 03-03-PLAN.md — executions data layer + saveExecutionsBatch action (per-unit version optimistic concurrency, server recompute)
- [x] 03-04-PLAN.md — End-to-end grid slice: page + AG Grid client + filter bar + save bar + Actuals nav + e2e
- [x] 03-05-PLAN.md — POP multi-item modal (GRID-06) + Dealer Certificate inline (GRID-08) + POP/cert e2e
**UI hint**: yes

> **Discuss-step note** (do not resolve now): begin with a short spike to confirm AG Grid Community editing / virtualization / server-side filtering feel against a real period of data (TanStack Table is the documented fallback). Saves are per-field patches with optimistic concurrency (version check) to prevent lost edits on the shared login.

### Phase 3.1: Actuals Grid Refinements
**Goal**: The actuals grid feels fast and intuitive — no input lag, sensible defaults, no surprise locks — and the ops reality of dealers being painted off-plan has a clear, audited path that does NOT weaken the structural off-plan guard.
**Mode:** mvp
**Inserted**: 2026-06-08 (between Phase 3 and Phase 4)
**Depends on**: Phase 3
**Requirements**: GRID-09, GRID-10, GRID-11, GRID-12, GRID-13, COMP-04
**Success Criteria** (what must be TRUE):
  1. Cell-input responsiveness in the actuals grid is no longer perceptibly laggy at realistic dataset sizes (single-tap edit, no full re-render on each keystroke, dirty-state derivation memoised) — measured against a baseline.
  2. New placeholder rows AND new "+ add unit" clones default `status = "In Progress"`; a one-time backfill sets `status = 'In Progress'` for executions whose status is currently NULL, and the "No status" stat surfaces zero rows after the backfill.
  3. The P3 lock-on-Done is removed — a row whose status is `Done` is fully editable like any other row (Status cell already was; this extends to every other cell).
  4. There is a deliberate, audited path to record an execution at an SFID that is NOT in the uploaded plan ("off-plan exception"): the user provides minimum identifying fields (SFID, dealer, who/where) + reason, the system creates ONE plan_row tagged as an exception (source/flag column) in the same transaction as the execution, and the dashboard / "% executed" can later count plan-uploaded vs exception spend separately.
  5. The structural off-plan guard for **plan uploads** is unchanged — the only legitimate way to introduce an off-plan SFID is through the explicit exception affordance; bulk Excel actuals upload (if/when added) still rejects unknown SFIDs.
  6. The Save control is reachable from the top of the grid as well as the bottom — a sticky top save bar mirrors the existing bottom one (same dirty count, same save action).
  7. A user can copy a block of cells from Excel/Sheets and paste it into the grid at a selected cell; the paste fills across the editable columns and down the rows, marks the affected rows dirty, and saves through the normal batch path. Read-only plan cells are never overwritten and the structural guards (server trust-recompute, version concurrency) still hold.
**Plans**: 5 plans
- [x] 03_1-01-PLAN.md — Migration 0002 (plan_rows source/audit cols + status backfill) + default "In Progress" (rows.ts) + Done-lock regression (GRID-10, GRID-11)
- [x] 03_1-02-PLAN.md — GRID-09 hot-path perf refactor (applyTransaction + dirtyKeys Set + useDeferredValue + singleClickEdit) + before/after baseline (GRID-09)
- [x] 03_1-03-PLAN.md — COMP-04 backend: addOffPlanExecution action + insertExceptionPlanRow + 23505 catch + re-upload preservation guard (COMP-04)
- [x] 03_1-04-PLAN.md — GRID-12 top+bottom save bar (single source of truth + Ctrl/Cmd+S) + GRID-13 paste-block handler (GRID-12, GRID-13)
- [ ] 03_1-05-PLAN.md — COMP-04 frontend: off-plan modal + "+ off-plan execution" button + exception pill + e2e (COMP-04)
**UI hint**: yes

> **Discuss-step questions to resolve before locking the plan** (do not resolve now): exact audit fields on the exception row (who/when/why-text only, vs photo/link); whether the exception affordance lives inside the grid (e.g. a "+ add off-plan dealer" button below the grid) or on a separate route (`/actuals/exception`); whether exceptions count toward "% plan executed" denominator in Phase 4 (recommended: NO — they live in a parallel "exception spend" bucket) — final answer is a Phase-4 decision; for Phase 3.1 we just persist the marker correctly. Performance baseline must be captured BEFORE the fix (snapshot a profile against a realistic period) so the success criterion is verifiable. Paste-block scope: AG Grid Community has NO range-select/clipboard — the paste handler is custom (parse clipboard TSV, map to the editable columns left-to-right from the anchor cell, skip read-only/derived columns); decide column-mapping rule for derived/override cells and how off-grid paste overflow (more pasted columns than editable columns remain) is handled.

### Phase 4: Compliance & Dashboard
**Goal**: On login a user immediately sees, for the active period, planned / executed / cancelled counter counts (with a week-wise trend) and planned vs actual expense — drillable from Zone → State → District → Taluka — honoring the current filters and sharing one authoritative "% executed" calc with the grid and export.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: COMP-03, DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07
**Success Criteria** (what must be TRUE):
  1. On login, a user sees a dashboard with "% plan executed" and planned / executed / pending counts for the active period.
  2. The dashboard breaks down execution and spend by activity and by region.
  3. The dashboard shows planned budget vs actual spend.
  4. The dashboard respects the active period and the Region / State / Distributor filters, and "% executed" is computed by one authoritative shared calc path so the grid, export, and dashboard never disagree.
  5. Cancelled counters are surfaced as a first-class stat alongside Planned / Executed / Pending and are excluded from the "% executed" denominator (consistent with the grid `TERMINAL_STATUSES` treatment).
  6. Within the active period the dashboard shows a week-wise trend (planned vs executed vs cancelled counters and weekly actual spend) bucketed by `executions.executionDate`, AND a standalone rolling "recent N weeks" view is selectable independently of the active period.
  7. The user can drill Zone (= `plan_rows.region`) → State → District → Taluka; each level shows planned / executed / cancelled counter counts and planned-vs-actual expense for the rows below it, reusing the cascade utility from `lib/actuals/filter.ts`.
**Plans**: TBD
**UI hint**: yes

> **Discuss-step questions to resolve before locking the plan** (do not resolve now): exact completeness math for partial / in-progress actuals — when a plan row has some but not all of its executions, how does it count toward "% executed"? (Interacts with Status enum + multi-unit plan-row grain from Phase 1.) How are Cancelled rows treated in the denominator vs numerator separately from Done? What does "recent N weeks" default to (4 / 8 / 12)? Does the week-wise trend live on the main dashboard or in a drawer? Is Zone→Taluka drill-down a collapsible tree on one page or router-pushed breadcrumb pages? How do exception-source plan rows from Phase 3.1 (`source = 'exception'`) appear in the Zone breakdown — folded in, sidelined as a parallel "exception spend" bucket, or both views toggleable?

### Phase 5: Excel Export
**Goal**: A user can export exactly what they are currently looking at — the filtered grid — to a clean `.xlsx` with correct numeric/currency typing and the activity's column order.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: EXPT-01
**Success Criteria** (what must be TRUE):
  1. A user can export the current filtered grid to `.xlsx`.
  2. The export uses correct numeric / currency typing (₹) and the activity's column order, reusing the same filtered query and registry as the grid.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 3.1 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 5/5 | Complete   | 2026-06-05 |
| 2. Plan Upload & Periods | 3/3 | Complete   | 2026-06-05 |
| 3. Actuals Grid | 5/5 | Complete   | 2026-06-06 |
| 3.1. Actuals Grid Refinements | 4/5 | In progress | - |
| 4. Compliance & Dashboard | 0/TBD | Not started | - |
| 5. Excel Export | 0/TBD | Not started | - |
