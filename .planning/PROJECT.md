# Marketing Expense Tracker

## What This Is

A web-based marketing-expense tracker for a small JSW marketing team, built on Next.js and deployed on Vercel. It loads an approved marketing plan (per activity, per period) and records the actual on-ground executions against it — measurements, costs, status, location — all keyed on Salesforce ID (SFID). It shows how much of the plan has been executed and how much has been spent, and it prevents spend being recorded against dealers that aren't in the plan.

## Core Value

Spend stays inside the plan, and execution progress is always visible. Only SFIDs present in the uploaded plan can receive actuals (off-plan entries are rejected), and "% of plan executed" is the headline compliance metric.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. All are hypotheses until shipped and validated. -->

- [ ] Upload an approved plan (Excel) for a given activity + period; the plan becomes the master list of allowed SFIDs
- [ ] Record actual executions against plan rows in a filterable, editable spreadsheet-style grid
- [ ] Filter rows by Region, State, District, Distributor, and Status
- [ ] Support six activity types, each with its own column set: Counter Wall Painting, GSB, NLB, In-shop Branding, POP/Dealer Kit (multi-item), Dealer Certificate (issuance status + date)
- [ ] Auto-calculate totals (sq ft, total cost) from entered measurements and rates
- [ ] Block/flag actuals recorded against SFIDs not present in the uploaded plan (off-plan guard)
- [ ] Organize plans by period (monthly / quarterly / FY) and keep each period's plan + actuals separate
- [ ] Dashboard showing % plan executed, planned/executed/pending counts, and spend, broken down by activity and region
- [ ] Multi-item entry popup for POP / dealer-kit activities (each line item with qty × rate)
- [ ] Export the current filtered grid to Excel
- [ ] Protect the app behind a single shared password

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Photo / proof-image upload — deferred to a later version (decided in brainstorm)
- Per-user accounts, roles, and approval chains — a small trusted team shares one password; simplicity over per-user audit trails
- Field-mobile capture with auto-GPS — the team enters data centrally; coordinates are pasted in from what vendors send
- Compliance based on sq-ft/cost tolerance vs plan — compliance is the off-plan guard + completeness only; sq ft and cost are captured for spend totals, not for pass/fail
- Live Salesforce integration — SFID is used as a key only; no API sync in v1

## Context

- **Users:** a small core marketing/data team at JSW (privatebrand.data@jsw.in) who manage everything themselves — upload plans, fill actuals, read reports.
- **Plans arrive as Excel files**, and the column format differs per activity. Formats captured in the brainstorm and recorded below.
- **Activity column specs (from brainstorm):**
  - **Counter Wall Painting** — Plan: Region, SFID, Dealer/Area, State, District, Taluka, Plan Sq Ft, Distributor. Actuals: Status, Latitude, Longitude, Wall/Shop No (VendorInitials_wallNo_DD/MM/YY), Execution Date, Execution Month, Remarks, Actual Sq Ft, Per-unit cost, Total cost.
  - **GSB / NLB** — Plan: Region, SFID, Dealer Name, State, District, Taluka, Distributor. Actuals: Status, GSB/NLB type, Length, Breadth, Height, Total Sq Ft, Per-unit cost, Total cost, Remarks.
  - **In-shop Branding** — Plan: Region, SFID, Dealer Name, State, District, Distributor, Pin code, GST No., Mobile No. Actuals: Status, Length, Breadth, Total Sq Ft, Per-unit cost, Total cost, Remarks.
  - **POP / Dealer Kit** — Parent: Region, State, District, Distributor, SFID, Dealer. Line items: item name, qty, per-unit cost, total. Item names come from a managed list.
  - **Dealer Certificate** — Issuance status + date + cost.
- **Data shape:** shared who/where columns (Region/State/District/Distributor/SFID/Dealer) stored as real indexed columns for fast filtering; activity-specific measurement fields stored in a `jsonb` column. POP line items live in a child table.
- **Compliance model:** the database makes the off-plan guard structural — an execution must reference an existing plan row, so spend cannot be recorded against an SFID that isn't in the plan. Excel actuals matching on (activity, period, SFID) with no match are rejected as off-plan.

## Constraints

- **Tech stack**: Next.js (App Router, React 19) on Vercel — single-app deploy, server + UI together
- **Database (local-first)**: develop and run against **PGlite** (embedded Postgres, zero install) locally; deploy against **Supabase** (cloud Postgres). The app reads a single `DATABASE_URL`, so local → cloud is a config swap, not a code change. Run it fully on the local machine first; connect Supabase only when ready.
- **ORM**: Drizzle — keeps the schema provider-agnostic (PGlite ↔ Supabase) and is lean on serverless
- **Excel I/O**: SheetJS Community Edition from the **official CDN tarball** (npm's `xlsx` is an outdated, CVE-bearing build); parse client-side and POST validated JSON to a server action
- **Auth**: single shared password stored as an env var, verified in middleware, sets a `jose`-signed `httpOnly` cookie — no user accounts in v1
- **UI grid**: **AG Grid Community** (MIT, React 19-compatible) for the editable spreadsheet feel; TanStack Table is the documented fallback
- **Extensibility**: activities defined in a typed config registry, so adding a 7th activity is a data change, not a code change
- **Region/locale**: Indian context — ₹ currency, Indian states/districts, DD/MM/YY dates

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Next.js on Vercel + Postgres + Drizzle + AG Grid Community + SheetJS CE | Cleanly supports multi-period data, off-plan guard, fast filtering, and Excel round-trip while staying "simple on Vercel" (stack verified in research, 2026-06) | — Pending |
| Local-first dev with PGlite; deploy to Supabase | Run and test entirely on the local machine first; switch to Supabase by changing only `DATABASE_URL` (Drizzle keeps the schema portable, PGlite is real Postgres) | — Pending |
| Cloud DB = Supabase (research narrowly preferred Neon) | User's choice; both are plain Postgres and the code is provider-agnostic, so no downside | — Pending |
| Activities defined as config (type: measurement / item-list / status) | One grid engine serves all six; new activities are config, not code (open/closed) | — Pending |
| Hybrid schema: shared columns real + indexed, activity-specific fields in `jsonb` | Instant filter dropdowns at scale without a migration per differing activity | — Pending |
| Off-plan guard enforced via FK (execution → plan_row) | Makes "only planned SFIDs" a structural rule, not app logic that can be bypassed | — Pending |
| Compliance = off-plan guard + completeness % (not size/cost tolerance) | Matches how the team actually judges the plan; sq ft/cost are spend metrics only | — Pending |
| Shared password, no per-user accounts | Small trusted team; minimizes friction and setup | — Pending |
| Plans organized per period (month/qtr/FY) | "Execution Month" fits monthly tracking; enables period-over-period comparison | — Pending |
| Photos deferred to a later version | Keep v1 lean; team can paste links if needed before native upload lands | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-04 after initialization*
