# Project Research Summary

**Project:** Marketing Expense Tracker
**Domain:** Internal trade-marketing plan-vs-actual spend compliance tracker (Next.js/Vercel + Postgres; Excel round-trip; Indian retail/dealer context)
**Researched:** 2026-06-04
**Confidence:** HIGH (stack/architecture/pitfalls verified against official docs + advisories; features MEDIUM-HIGH)

## Executive Summary

This is an **internal spreadsheet-replacement tool**, not a SaaS retail-execution suite. A small, trusted JSW team uploads an approved marketing plan (per activity, per period) as Excel, transcribes vendor-reported actuals into an editable grid, and reads plan-vs-actual compliance. The headline value is narrow and load-bearing: **spend can only be recorded against SFIDs that are in the plan, and "% of plan executed" is always visible.** Because the team enters data centrally, the entire field-mobile market (photos, GPS, per-rep roles, AI shelf recognition, live CRM sync) is deliberately out of scope. The real table stakes are the table stakes of internal data tools: trustworthy Excel import, a fast editable grid, reliable filtering, and clear rollups.

The prescriptive stack is **Next.js 16 (App Router) + React 19 on Vercel, Neon serverless Postgres, Drizzle ORM, AG Grid Community for the grid, SheetJS CE for Excel I/O, and a hand-rolled `jose` shared-password cookie.** Two non-obvious decisions are load-bearing and must not be missed: (1) **SheetJS must be installed from the SheetJS CDN tarball, never `npm i xlsx`** -- the npm package is frozen at a vulnerable 0.18.5 (prototype-pollution-on-read CVE, directly in scope since we read uploads); (2) **the grid is AG Grid Community, not Glide Data Grid** despite the brief naming Glide -- Glide does not support React 19, which Next 16 ships, so it is a hard blocker, not a preference. The architecture is **config-driven**: a single typed Activity Registry feeds the grid, filter bar, importer, and exporter, so a 7th activity is a data change, not a release. The off-plan guard is **structural** -- a `NOT NULL` FK from `executions.plan_row_id` to `plan_rows.id` -- so no code path (import, bulk paste, future script) can bypass it.

The risk profile is dominated by **data integrity, not scale** (about 10 users, about 10k rows/period). Four pitfalls can genuinely hurt this project and must be designed against from the schema phase: **(1)** the off-plan guard living only in app code; **(2)** re-uploading a plan destroying existing actuals; **(3)** serverless connection exhaustion (use the **pooled** Neon connection string); and **(4)** lost edits on the shared login (per-field saves + a version column). Two correctness traps round out the must-fix list: **money/totals must be Postgres `numeric`, never floats**, and **computed sq ft / totals must be calculated in a shared app-layer module and persisted to plain indexed numeric columns -- NOT in a Postgres generated column off jsonb** (the `::numeric` cast is not immutable and will either reject the schema or crash on dirty Excel input). Excel type coercion (DD/MM dates, IDs-as-text, currency strings) is the single highest-effort correctness area and deserves its own milestone with a corpus of real vendor files.

## Key Findings

### Recommended Stack

For an internal single-app tool on Vercel serverless with no external API consumers, the research converges on a lean, cold-start-optimized, server-first stack. Versions below were verified against the npm registry and official docs on 2026-06-04 (full detail in [STACK.md](./STACK.md)).

**Core technologies:**
- **Next.js 16.2.7 (App Router) + React 19.2.x** -- locked by charter; current GA, native Vercel target. React 19 is the reason Glide Data Grid is excluded.
- **Vercel (Fluid Compute, default)** -- keeps functions warm so DB connection reuse is cheap and leak-safe.
- **Neon (Serverless Postgres) + `@neondatabase/serverless` 1.1.0** -- Vercel-native Postgres; HTTP driver means no TCP pool to exhaust on serverless. **Use the pooled (`-pooler`) connection string.** (See reconciliation below -- Neon is the pick over Supabase.)
- **Drizzle ORM 0.45.2 + drizzle-kit 0.31.10** -- about 7.4 KB vs Prisma about 1.6 MB runtime, so far faster cold starts; schema-as-TypeScript (no codegen drift); raw control for jsonb + GIN indexes and the FK off-plan guard.
- **AG Grid Community 35.3.1 (MIT)** -- React 19 supported, row/column virtualization on by default, inline edit + Text/Number/Date filters out of the box. (See reconciliation below -- this resolves the grid conflict.)
- **SheetJS CE 0.20.3 -- from the SheetJS CDN, NOT npm** -- all Excel I/O; the npm `xlsx@0.18.5` carries unpatched CVE-2023-30533 (prototype pollution on read) + CVE-2024-22363 (ReDoS).
- **`jose` 6.2.3 signed JWT cookie + middleware** -- single shared password; Edge-runtime compatible (unlike `jsonwebtoken`). A full auth library is overkill for one shared secret.
- **Zod 4.4.3** -- validate every Server Action payload and every parsed Excel row before it touches the DB.
- **Server Actions** for all mutations (grid edits, import commit, POP saves); a Route Handler only for `GET /api/export` (streaming a file download). Tailwind 4 + shadcn/ui for the dashboard/forms/popups.

### Expected Features

The MVP maps 1:1 to the locked Active requirements in PROJECT.md. Full landscape and dependencies in [FEATURES.md](./FEATURES.md).

**Must have (table stakes -- v1):**
- **Activity config registry** (6 activities; measurement / item-list / status) -- the spine everything reads from
- **Per-activity plan upload** with template download, header validation, preview-before-commit, per-row error reporting
- **Off-plan guard** on both Excel-actuals import and in-grid entry -- the Core Value, enforced structurally via FK
- **Editable grid** -- inline edit, paste-from-Excel, locked plan columns, status dropdown, auto-calc totals, dirty-state + explicit save
- **Filtering** (Region/State/District/Distributor/Status) + **SFID/dealer search**, **period scoping** (month/qtr/FY)
- **Compliance + spend dashboard** -- % executed, planned/executed/pending counts, spend by activity and region
- **POP / Dealer-Kit multi-item popup** (item x qty x rate gives total) with managed item-name list
- **Filtered Excel export** (current view, rupee/number formats via SheetJS CE) and the **shared-password gate**

**Should have (competitive -- v1 low-cost adds, then v1.x):**
- **Off-plan rejections shown as a reviewable list** after import -- low cost, directly reinforces Core Value (strong v1 add)
- **URL-encoded filter state** (shareable, back-button-safe) -- cheap 80 percent of saved views (strong v1 add)
- **Completeness drill-down** (click the "% executed" tile through to a pre-filtered grid), **named saved views**, **period-over-period comparison**, **bulk status update**, **import fuzzy column-mapping** -- v1.x

**Defer (v2+):**
- **Photo/proof-image upload, per-user accounts/roles, live Salesforce/ERP sync, threshold notifications, richly styled Excel export, in-app activity-config editor, field-mobile/GPS** -- all explicitly out of scope or wrong-shaped for a central-entry team
- **Anti-features to actively resist:** pure autosave (breaks the validation/off-plan commit boundary), real-time collaborative editing (architecturally incompatible with batch-save), compliance-by-tolerance (compliance is off-plan + completeness only -- sq ft/cost are spend metrics, never pass/fail)

### Architecture Approach

A **single typed Activity Registry** (`lib/activities/`, framework- and dependency-free so it imports on client and server alike) is the source of truth that drives the grid columns, filter bar, Excel header validation/match key, and export column order -- one array, four consumers. One dynamic `[activity]` route serves all six activities. The data model is the **hybrid schema** locked in the charter: shared who/where columns (region/state/district/distributor/SFID/dealer/status) are real B-tree-indexed columns for fast filtering; activity-specific measurements live in a typed `jsonb` column on the same row. The off-plan guard is structural (FK), and Excel import is **client-parse then server-commit** (SheetJS parses in the browser to sidestep the Vercel 4.5 MB body limit and keep the heavy lib off the server; the Server Action re-validates against the registry and DB before insert). Full diagrams, project structure, and anti-patterns in [ARCHITECTURE.md](./ARCHITECTURE.md).

**Major components:**
1. **Activity Registry** -- typed config per activity (plan/actual columns, type, validation, computed-field formulas, Excel headers); drives grid, filters, import, export
2. **Editable Data Grid + Filter Bar** -- AG Grid Community rendering `config.actualColumns`; filters from shared indexed columns; dirty cells batched into one Zod-validated Server Action
3. **Excel Importer/Exporter** -- client-parse, validate header vs registry, match `(activity, period, SFID)`, preview (matched/off-plan/new), `commitImport`; export reuses the grid filtered query
4. **Postgres schema** -- `periods`, `plan_rows` (shared cols + jsonb, `UNIQUE(period_id, activity, sfid)`), `executions` (FK to plan_rows, promoted `numeric` totals), `execution_items` (POP children), `item_master`
5. **Auth middleware + Server Actions / data-access layer** -- `jose` cookie gate (re-checked in actions, not middleware-only); `lib/db/*` holds parameterized SQL, no business rules

### Critical Pitfalls

Top items from [PITFALLS.md](./PITFALLS.md). The first four are the ones that can actually hurt this project; the rest are correctness/hygiene that are cheap now and expensive after data exists.

1. **Off-plan guard in app code only** -- enforce as a `NOT NULL` FK (`executions.plan_row_id` to `plan_rows.id`) + `UNIQUE(period_id, activity, sfid)`. The DB is the enforcer; app checks only produce friendly previews. *Schema phase.*
2. **Destructive plan re-upload wipes actuals** -- treat re-upload as a reconcile/merge (diff added/removed/changed), never delete+insert; use `ON DELETE RESTRICT` (never CASCADE) so a destructive mistake fails loudly; show a pre-commit diff summary. *Schema sets RESTRICT; import phase implements merge.*
3. **Serverless connection exhaustion** -- use the Neon **pooled (`-pooler`)** connection string via `@neondatabase/serverless`; one shared module-scope client; never a raw unpooled direct connection per request. *Foundation/DB phase, day one.*
4. **Lost edits on the shared login** -- save **per-field patches** (not whole rows) + optimistic concurrency (`UPDATE ... WHERE id=? AND version=?`, reject on 0 rows, prompt "row changed, reload"). *Schema adds version col; grid phase implements.*
5. **Money/totals as floats + generated columns off jsonb** -- store money/measures as Postgres `numeric` (keep as strings end-to-end; never wrap a `numeric` in `Number()`); **compute sq ft/totals in a single shared app-layer module and persist to plain indexed numeric columns -- do NOT use a generated column off jsonb** (`::numeric` cast is not immutable; crashes on dirty input). *Schema + auto-calc phase.* (See reconciliation below.)
6. **Excel type coercion + header drift** -- read with `cellDates:true`/`UTC:true`, treat all IDs (SFID/GST/mobile/pin) as text, strip rupee/commas and validate `Number.isFinite`, parse DD/MM explicitly; map headers via the registry normalized aliases (never by position) and reject unmatched/missing columns; wrap the whole import in one transaction (validate-all, insert-all, rollback on any error). *Excel import phase -- highest-effort correctness area; give it real vendor files.*

## Reconciled Decisions (cross-researcher conflicts resolved)

The four researchers mostly agree; three points needed an explicit ruling so the roadmap inherits one answer:

1. **Data grid: AG Grid Community 35.3.1 (MIT).** STACK.md treats this as a hard blocker with HIGH confidence: Glide Data Grid caps its React peer at 18 (open issue #1021 since Feb 2025) and Next 16 ships React 19, so Glide install fails and the `--legacy-peer-deps` flag is a runtime gamble. ARCHITECTURE.md still names Glide (MEDIUM confidence, written before the version check) and FEATURES.md mentions react-data-grid; **both are superseded.** **React 19 compatibility is non-negotiable, so AG Grid Community wins.** Runner-up: **TanStack Table 8 + TanStack Virtual** (React-19-safe, smallest bundle, but headless -- you build edit/filter/virtualization yourself). Note that AG Grid Set/Multi filter and native Excel export are Enterprise-only, which pushes filtering server-side onto indexed columns (the correct design for lakhs of rows anyway) and export through SheetJS. **Flag:** the final grid selection warrants a short spike at the start of the grid phase to confirm AG Grid Community editing/virtualization/filtering feel against a real period of data before committing.
2. **DB provider: Neon (over Supabase).** We need plain Postgres + jsonb, not the Supabase auth/storage/realtime suite (all of which we explicitly cut). Neon is Vercel-native, has the HTTP serverless driver, and offers branching for safe migration testing. PITFALLS.md is provider-agnostic on pooling; the requirement carries forward unchanged: **use the pooled (`-pooler`) connection string for all app traffic, reserve the direct string for migrations.** Reasonable to revisit only if the team wants Supabase Studio as an ops console or plans to un-defer photo upload via Supabase Storage soon.
3. **Computed totals: shared app-layer module + plain numeric columns (NOT generated columns off jsonb).** ARCHITECTURE.md and PITFALLS.md fully agree and this is now a first-class rule. Computing `total_sqft`/`total_cost` as a Postgres `GENERATED ALWAYS AS (... ::numeric ...)` column off jsonb is rejected because the `::numeric` cast is not immutable, and even an `IMMUTABLE` wrapper crashes on a sloppy Excel cell (`"abc"`, empty string) at write time, blocking the row. **Compute once in a single shared util (`lib/compliance/`, used by client + server) and persist to plain indexed numeric columns** so the grid, export, and dashboard never disagree and aggregation stays fast.

## Open Questions (resolve in schema / discuss-phase, NOT now)

The researchers raised four cross-cutting questions that directly shape the data model and the import-matching logic. These are **not blockers for roadmap creation**, but each must be answered before the schema phase is locked, because retrofitting them after data exists is expensive.

1. **Plan-row grain for multi-unit activities (highest priority).** The architecture and several pitfalls assume one-execution-per-plan-row (`UNIQUE(plan_row_id)` on executions, `UNIQUE(period_id, activity, sfid)` on plan_rows). But **Counter Wall Painting can have multiple walls per dealer/SFID** (the actuals already carry a Wall/Shop No field), so one SFID may legitimately need multiple executions. This challenges the unique match key and the off-plan FK design. **Decision needed:** is a plan row one-dealer-per-activity-per-period, or one-execution-unit (wall/board)? If multi-unit, the match key likely needs a per-unit component (Wall/Shop No) or a quantity-planned model, and executions may not be unique per plan row.
2. **Re-upload semantics for an existing `(period, activity)`** -- append vs upsert vs replace. Must be a non-destructive reconcile/merge that preserves existing actuals (see Pitfall 2). Define the policy for a plan row removed in re-upload but having actuals: block, soft-archive, or flag -- never silently delete.
3. **Exact completeness definition with partial/in-progress actuals** -- when a plan row has some but not all actuals, does it count toward "% executed"? The headline metric math must be unambiguous and documented (interacts with the Status enum and with question 1 grain).
4. **Whether incoming plans carry a planned-cost/budget column** -- if present, it unlocks budget-vs-actual *reporting* (a v1.x differentiator, never a compliance pass/fail). Confirm data availability before committing to it.

## Implications for Roadmap

Research dictates a strictly **dependency-driven** build order: the registry + schema underpin everything; plan rows must exist before actuals; actuals must exist before aggregation; export reuses the query + registry built earlier. The most expensive-to-retrofit decisions (off-plan FK, match-key grain, numeric types, version column, `ON DELETE RESTRICT`, pooled connection) all land in the **earliest** phase by design.

### Phase 1: Foundation -- Registry, Schema, Auth, DB connection
**Rationale:** Nothing reads correctly without the registry, and the structural guarantees (off-plan FK, UNIQUE match key, numeric types, version column, RESTRICT, pooled connection) are load-bearing and must precede any write path. This is where the open questions get resolved.
**Delivers:** Typed ActivityConfig + all six activity configs; migrations for periods/plan_rows/executions/execution_items/item_master with FK + UNIQUE + numeric + version columns; Neon pooled connection wired; jose cookie middleware + /login.
**Uses:** Drizzle + drizzle-kit (test migrations on a Neon branch), @neondatabase/serverless (pooled), jose, Zod.
**Avoids:** Off-plan-in-app-code (Pitfall 1), connection exhaustion (Pitfall 3), money-as-float (Pitfall 9), shared-password misconfig (Pitfall 10 -- re-check auth in actions, no NEXT_PUBLIC_ secret, signed cookie, Deployment Protection).
**Requires resolving:** all four Open Questions (especially #1, plan-row grain, which determines the UNIQUE key and whether executions are unique per plan row).

### Phase 2: Plan Upload + Period Scoping
**Rationale:** Populates plan_rows, which every later flow depends on; proves the registry-driven import and the period model. Strictly precedes actuals.
**Delivers:** Client-parse, header validation vs registry, SFID match within period, preview (matched/off-plan/new), commitImport in one transaction; non-destructive re-upload (reconcile/merge); template download per activity; off-plan rejections list.
**Implements:** Excel Importer; client-parse then server-commit pattern.
**Avoids:** Destructive re-upload (Pitfall 2), match-key ambiguity (Pitfall 5), Excel type coercion (Pitfall 6), header drift (Pitfall 7), partial/half-written import (Pitfall 8).

### Phase 3: Editable Grid + Filters + POP popup
**Rationale:** Requires plan rows to edit against; this is the daily-use core. Grid library and save strategy are chosen together.
**Delivers:** Generic AG Grid from config.actualColumns; filter bar from shared indexed columns + SFID/dealer search; per-field debounced saveCells (FK enforces on-plan); locked plan columns, status dropdown, paste-from-Excel, dirty-state + explicit save; POP multi-item popup writing execution_items; URL-encoded filter state.
**Uses:** AG Grid Community (server-side filtering on indexed columns), Server Actions + Zod, shadcn/ui for the popup.
**Avoids:** Lost edits on shared login (Pitfall 4), non-virtualized grid / per-keystroke save (Pitfall 13), jsonb misuse (Pitfall 12 -- validate payloads against the registry, expression B-tree indexes not blanket GIN for filtered keys).

### Phase 4: Compliance + Dashboard
**Rationale:** Requires actuals to aggregate; delivers the headline compliance metric.
**Delivers:** Shared app-layer computed totals (sq ft, cost) persisted to numeric columns; SQL aggregation for % executed, planned/executed/pending counts, spend by activity and region; completeness drill-down.
**Avoids:** Generated-column-off-jsonb trap and float drift (Reconciled Decision 3 + Pitfall 9 -- one authoritative calc path so grid/export/dashboard agree).

### Phase 5: Excel Export
**Rationale:** Last because it reuses the grid filtered query and the registry column order -- both must exist first.
**Delivers:** GET /api/export Route Handler reusing buildFilteredQuery, column order from registry, streamed .xlsx with rupee/number formats; exports exactly the current filtered view.
**Uses:** SheetJS CE (Route Handler is the one justified non-Server-Action endpoint).

> A **pre-launch hardening pass** (not a numbered feature phase) should verify the "Looks Done But Isnt" checklist: auth (CVE-2025-29927 patch, signed cookie, protected/non-indexable deploys), backup/PITR + soft-delete + change log (Pitfall 11 -- system of record with no audit trail), and the concurrency/re-upload/import-rollback tests.

### Phase Ordering Rationale
- **Dependency-driven:** registry/schema, then plan rows, then actuals, then aggregation, then export. Each phase produces something runnable and unblocks the next (per ARCHITECTURE.md build order).
- **Risk-front-loaded:** the four hardest-to-retrofit pitfalls and all four open questions concentrate in Phase 1/2, so the structural decisions are made before any data exists.
- **Architecture-grouped:** grid + filters + POP ship together because they all read the registry and share the per-field save model; export ships last because it reuses Phase 3 query and Phase 1 registry.

### Research Flags

Phases likely needing --research-phase during planning:
- **Phase 1 (schema):** the **plan-row grain / multi-unit** open question (#1) is genuinely undecided and reshapes the match key and FK -- worth a focused discuss-phase before locking migrations.
- **Phase 2 (Excel import):** highest-effort correctness area (date/number coercion across messy vendor files, header-alias mapping, transaction + zero/multi-match handling). Plan against a corpus of real vendor files.
- **Phase 3 (grid):** short **spike** to confirm AG Grid Community edit/virtualize/filter feel and server-side row model against a real period (resolves the residual grid-selection uncertainty; TanStack Table is the fallback).

Phases with standard patterns (skip research-phase):
- **Phase 4 (dashboard):** straightforward SQL GROUP BY/SUM over indexed columns once the calc rule is fixed.
- **Phase 5 (export):** SheetJS write + streamed Route Handler is well-documented and reuses existing query/registry.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All versions verified against npm + official docs 2026-06-04; grid/Excel/DB/ORM choices verified against current advisories and React-19 compatibility data. |
| Features | MEDIUM-HIGH | Scoped to internal-tool table stakes from strong import-UX / data-grid / plan-vs-actual sources; maps 1:1 to locked charter requirements. Uncertainty is in feature *grain* (open questions), not feature *set*. |
| Architecture | HIGH | Core stack verified against Next.js/Postgres/SheetJS/Vercel docs; the one real trap (jsonb-to-numeric generated column) verified and resolved. Grid reference (Glide) is the only superseded item, now reconciled to AG Grid. |
| Pitfalls | HIGH | Critical pitfalls verified against official docs, SheetJS issue tracker, Postgres docs, Vercel KB, and the CVE-2025-29927 advisory; a few domain-specific items are MEDIUM and flagged inline. |

**Overall confidence:** HIGH

### Gaps to Address
- **Plan-row grain for multi-unit activities (Open Question 1)** -- the most material gap; resolve in the Phase 1 discuss-phase before locking the schema, since it determines the UNIQUE match key and whether executions is unique per plan row.
- **Re-upload merge policy + completeness definition + budget column presence (Open Questions 2-4)** -- confirm with the team during schema/import planning; each shapes a constraint or a metric but none blocks roadmap creation.
- **Final grid selection** -- AG Grid Community is the evidence-based pick, but validate with a Phase 3 spike against real data (TanStack Table is the documented fallback if its enterprise feel or bundle size disappoints).
- **Backup/PITR for a system of record** -- Neon free-tier retention is short and there is no audit trail; decide the tier knowingly in Phase 1 and add an external pg_dump + soft-delete + change log before launch (Pitfall 11).

## Sources

### Primary (HIGH confidence)
- npm registry (npm view, 2026-06-04) -- verified current versions (next 16.2.7, react 19.2.7, drizzle-orm 0.45.2, ag-grid 35.3.1, @neondatabase/serverless 1.1.0, jose 6.2.3, zod 4.4.3, etc.); Glide peers cap at React 18
- SheetJS docs + advisories -- CE 0.20.3 CDN-only install; CVE-2023-30533 (prototype pollution on read), CVE-2024-22363 (ReDoS); date/number coercion (cellDates/UTC), sheet_to_json header:1
- AG Grid docs -- Community = MIT; Community vs Enterprise (Set/Multi filter + Excel export are Enterprise); React 19 compatibility; Modules + Next.js App Router
- Neon docs + Vercel KB -- serverless driver (HTTP/WS), pooled (-pooler) connection strings, Fluid Compute pooling
- PostgreSQL docs + mailing list -- generated-column immutability requirement; jsonb-to-numeric cast not immutable (the verified-and-resolved trap)
- Next.js docs -- Server Actions vs Route Handlers; Data Security; CVE-2025-29927 middleware-bypass advisory
- Context7 /drizzle-team/drizzle-orm-docs -- jsonb() column type and index().using(gin, ...) syntax
- Vercel docs -- Functions limitations (4.5 MB body limit, maxDuration)

### Secondary (MEDIUM confidence)
- Drizzle vs Prisma serverless bundle/cold-start comparisons (architectural claim HIGH; exact ms figures MEDIUM)
- Neon vs Supabase 2026 comparisons (when to pick each)
- exceljs maintenance status (Inactive classification; community forks)
- Import-UX, editable-data-grid, filtering/saved-views, invoice-line-item, and plan-vs-actual/spend-dashboard practitioner sources (FEATURES.md)
- jsonb indexing + money-in-Postgres + optimistic-concurrency + grid-virtualization references (PITFALLS.md)

### Tertiary (LOW confidence)
- Retail-execution / merchandising suites (SimplyDepo, Axonify, PepUpSales) -- included only as *contrast* to confirm this project is a deliberately different (central-entry) shape; not direct competitors

---
*Research completed: 2026-06-04*
*Ready for roadmap: yes*
