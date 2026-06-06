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
**Plans**: TBD
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

### Phase 4: Compliance & Dashboard
**Goal**: On login a user immediately sees, for the active period, how much of the plan has been executed and how spend compares to budget — broken down by activity and region, and honoring the current filters.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: COMP-03, DASH-01, DASH-02, DASH-03, DASH-04
**Success Criteria** (what must be TRUE):
  1. On login, a user sees a dashboard with "% plan executed" and planned / executed / pending counts for the active period.
  2. The dashboard breaks down execution and spend by activity and by region.
  3. The dashboard shows planned budget vs actual spend.
  4. The dashboard respects the active period and the Region / State / Distributor filters, and "% executed" is computed by one authoritative shared calc path so the grid, export, and dashboard never disagree.
**Plans**: TBD
**UI hint**: yes

> **Discuss-step question to resolve here** (do not resolve now): exact completeness math for partial / in-progress actuals — when a plan row has some but not all of its executions, how does it count toward "% executed"? Document the rule unambiguously (it interacts with the Status enum and the multi-unit plan-row grain from Phase 1).

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
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 5/5 | Complete   | 2026-06-05 |
| 2. Plan Upload & Periods | 3/3 | Complete   | 2026-06-05 |
| 3. Actuals Grid | 5/5 | Complete   | 2026-06-06 |
| 4. Compliance & Dashboard | 0/TBD | Not started | - |
| 5. Excel Export | 0/TBD | Not started | - |
