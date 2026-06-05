# Phase 3: Actuals Grid - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The editable, spreadsheet-style **actuals grid** (GRID-01..08) — where the team opens **one activity's** plan rows for the active period and records on-ground executions against them, on the substrate Phase 1 built (`executions` / `execution_items`) and the plan rows Phase 2 ingested.

In scope:
- **Per-activity editable grid** (GRID-01/02) — plan columns read-only, actual columns editable inline; columns come entirely from the registry.
- **Multi-unit executions** (GRID-05) — a planned dealer (SFID) holds many execution units, each with its own measurements / cost / status / date / location.
- **Auto-calculated derived values** (GRID-04) — sq ft from dimensions, total cost from sq ft × rate; computed app-side, persisted to numeric columns.
- **Filter + search** (GRID-03) — Region / State / District / Distributor / Status + SFID search, responsive at the expected row counts.
- **POP / Dealer-Kit multi-item popup** (GRID-06) and **Dealer Certificate issuance** (GRID-08).
- **Reliable saves** (GRID-07) — batched, with a saved/dirty indicator and per-unit optimistic concurrency.

Out of scope here: completeness math / "% executed" and the dashboard (Phase 4); Excel export (Phase 5); proof-photo upload (v2); per-user accounts; autosave / real-time collaboration (PROJECT.md out-of-scope — directly informs the save model below).

</domain>

<decisions>
## Implementation Decisions

### Grid Engine & Spike *(carried from ROADMAP / PROJECT — not re-litigated)*
- **D3-00:** Grid engine is **AG Grid Community** (MIT, React 19); **TanStack Table is the documented fallback**. Begin with a **short throwaway spike** against a real period of data to confirm editing / virtualization / client-side filtering feel before committing (ROADMAP Phase 3 discuss-note). **Enterprise-only features are OFF-LIMITS** — master-detail, row grouping, Set Filter, native Excel export, aggregation — design strictly within Community.

### Multi-Unit Entry & Display *(discussed)*
- **D3-01:** Display model is a **FLAT grid — one row per execution unit**, sorted/clustered under each dealer (SFID). Plan columns are **read-only and repeat** on each unit row; actual columns are editable. No Enterprise master-detail or row grouping. (Chosen over "row-per-dealer + side drawer" and over a custom expandable-row build — most Excel-like, simplest reliable saves.)
- **D3-02:** **All planned dealers are visible on open.** A dealer with zero executions shows as a single **empty, ready-to-fill row** so un-executed dealers stay in view (feeds the % executed story in Phase 4). That empty row is a **placeholder bound to the plan_row**; it becomes a real `executions` row only when data is entered and saved — no empty execution rows are persisted.
- **D3-03:** **Adding a unit clones the dealer's plan context** into a new editable unit row (a "+ add unit" affordance at the dealer level). Exact placement (action cell vs persistent add-row) is planner discretion.

### Derived Calculations *(discussed)*
- **D3-04:** **Sq ft formulas by activity:** Counter Wall = **entered Actual Sq Ft** (no derivation); In-shop = **Length × Breadth**; **GSB & NLB = Length × Breadth** (Height is **stored for reference, NOT part of the area**). **Total Cost** (measurement activities) = Total Sq Ft × Per-unit cost. **POP line total** = Qty × Rate. All computed **app-side** and persisted to the plain numeric columns (D-05), never Postgres generated columns.
- **D3-05:** Derived totals (Total Sq Ft, Total Cost) **auto-fill as you type but are OVERRIDABLE** — a deliberate softening of GRID-04's "read-only" wording. A manual override is **STICKY** for that cell (later edits to its inputs do not clobber it); a **"reset to formula"** affordance restores auto-calc. ⚠ **Downstream verifier:** treat "auto-filled + overridable" as the intended GRID-04 behavior, **not a miss**. Recommend updating REQUIREMENTS.md GRID-04 wording to match.

### Filtering, Search & Scale *(discussed)*
- **D3-06:** Filtering uses a **CUSTOM filter bar above the grid** with multi-select dropdowns for Region / State / District / Distributor / Status, plus an **SFID search box**. Dropdown option lists are built from the current period+activity data (AG Grid Set-Filter is Enterprise, so we supply our own). Built-in AG Grid column filters are **not** the primary mechanism.
- **D3-07:** Location filters **CASCADE** — Region narrows State, State narrows District, etc., following the geographic hierarchy.
- **D3-08:** Data loading is **CLIENT-SIDE**. The typical biggest activity-period is **≤ ~1k dealers**, so load the full activity-period dataset into AG Grid and filter/search in the browser. The `plan_rows_filter_idx` (period_id, activity, region, state, district) is already in place for a future server-side path; **revisit only if a period crosses ~5–10k rows**.

### Status Vocabulary *(discussed)*
- **D3-09:** Status enum = **Pending / In Progress / Done**, **shared** across every activity that has a `status` field (counter-wall, gsb, nlb, in-shop, dealer-certificate). For **Dealer Certificate, "Done" = "Issued."** Add these as `enumValues` on each status `FieldDef` in the registry — a **config-only** change consistent with ACTV-03. (POP/Dealer-Kit has no status field; its executions leave `status` null.)

### Saving & Concurrency *(default locked — user accepted defaults; area not deep-dived)*
- **D3-10:** Save model is **BATCH-EDIT + EXPLICIT SAVE** (NOT autosave — PROJECT.md rules out autosave/real-time). Edits accumulate as "dirty"; a visible **"N unsaved changes / Save"** bar flushes them. This reconciles GRID-07 ("batched, saved/dirty indicator") with the ROADMAP per-field-patch note: **on Save, changes are sent as per-unit patches**, each carrying that execution's `version`.
- **D3-11:** **Concurrency:** each per-unit Save carries the row's `version` (D-04). A **version mismatch BLOCKS that unit's save** (no silent last-write-wins) and surfaces a "changed by someone else — reload this row" notice; unaffected units in the same batch still save. New (placeholder) rows insert with version 0.
- **D3-12:** **Dirty/saved indicator:** per-cell (or per-row) dirty highlight + the global unsaved-count Save bar; a clear "saved" confirmation after a successful flush.

### POP / Dealer-Kit & Dealer Certificate Entry *(default locked — user accepted defaults; area not deep-dived)*
- **D3-13:** A POP/Dealer-Kit dealer = **ONE execution ("kit") carrying N `execution_items`** (matches the schema — execution_items hang off a single execution). The flat-grid "unit row" for a POP dealer represents that kit; "edit" opens a popup/modal. (Multiple kits per dealer is deferred.)
- **D3-14:** The **POP popup** adds multiple line items: pick item from the **item master (ACTIVE items only, name SNAPSHOT at entry per D-08)**, enter Qty and Rate; **Line Total = Qty × Rate** auto-fills; the popup subtotal **rolls up to the dealer's row total**. Reuses the Phase-1 item master and the established modal/form pattern.
- **D3-15:** **Dealer Certificate** (GRID-08) entry captures **Status (issuance) + Date + Cost inline** on the execution row — no popup, no line items (it's a `status`-type activity).

### Claude's Discretion
- Exact AG Grid column / cellRenderer / cellEditor wiring; the throwaway spike's scope; and routing (likely `/actuals` with an activity+period selector, or `/actuals/[activity]`) — add an **"Actuals" link to the app nav** (`app/(app)/layout.tsx`).
- Sticky-override storage mechanism (e.g. a per-cell override flag in dirty state) and the "reset to formula" UI placement.
- "+ add unit" affordance placement; repeated read-only plan-cell visual treatment (muted vs blank-on-repeat).
- Delete-a-unit behavior — **recommend hard delete with a confirm dialog in v1** (no soft-void).
- Cascading-dropdown implementation (derive option sets from the loaded client-side rows).
- Per-unit patch Server Action shape — whether one action takes the whole batch array or one call per dirty unit (**batch array recommended**, mirrors Phase-2 `commitPlanUpload`); placement in `lib/actions/executions.ts` + a `lib/db/executions.ts` data-access module (mirrors `plan-rows.ts`).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 / 2 substrate (the tables, queries, and registry the grid reads/writes)
- `lib/db/schema.ts` — `plan_rows` (read-only source), `executions` (one-per-unit child: `status` / `unitNo` / `perUnitCost` / `totalCost` / `totalSqft` / `fields` jsonb / **`version`** / `updatedAt`), `execution_items` (POP lines: `itemName` snapshot, `qty`, `rate`, `lineTotal`), `item_master`. Off-plan guard is structural — **no `sfid` on `executions`**; spend attaches only via the NOT NULL `plan_row_id` FK.
- `lib/db/plan-rows.ts` — `listByPeriodActivity(periodId, activity)` already returns the grid's plan rows; `PlanRowRecord` (numeric columns arrive as STRING). `_seedExecutionForTest` / `_findPlanRowIdForTest` already exist (built for the e2e seed route) — reuse/extend for grid tests. Add an executions read + per-unit write helpers here or in a sibling `lib/db/executions.ts`.
- `lib/activities/registry.ts` + `lib/activities/types.ts` — the column source of truth: `planColumns` / `actualColumns`, `kind`, `computeFrom`, `enumValues`, `shared`. Grid columns, editors, filters, and derived calcs all read this. The D3-09 status `enumValues` are added in the per-activity config modules below.
- `lib/activities/{counter-wall,gsb,nlb,in-shop,pop-dealer-kit,dealer-certificate}.ts` — per-activity column specs and `computeFrom` markers (e.g. counter-wall `totalCost = [actualSqft, perUnitCost]`).

### Established patterns to mirror
- `lib/actions/periods.ts`, `lib/actions/items.ts`, `lib/actions/plans.ts` — Server Action pattern: `requireSession()` + Zod parse + `{ ok | error }` state + `revalidatePath()`; transactions via `db.transaction(async tx => …)`.
- `app/(app)/periods/period-form.tsx`, `app/(app)/items/item-form.tsx`, `app/(app)/plans/upload/upload-form.tsx` — `"use client"` + `useActionState` + ref-reset; the client-does-the-work / server-gets-validated-JSON split (D2-06).
- `lib/auth/session.ts` (`requireSession`) — every Server Action calls it at entry (CVE-2025-29927 lesson).
- `lib/db/index.ts` — dual-driver seam (PGlite local / Supabase via `DATABASE_URL`); transactions identical across both.
- PGlite test isolation: `lib/actions/*.test.ts` (`_resetXForTest` + mocked `next/headers`, `next/cache`, `verifySession`). Live smoke: `lib/db/__smoke__/*`.

### Architecture & pitfalls (read before designing the grid + calcs)
- `.planning/research/ARCHITECTURE.md` — hybrid schema, config-driven grid, recommended project structure (the grid consumes the registry, not bespoke per-activity code).
- `.planning/research/PITFALLS.md` — totals computed **app-side, never generated columns**; numeric-as-string handling; DD/MM dates; IDs-as-text; ₹/comma stripping; the AG Grid Community-vs-Enterprise boundary.
- `.planning/research/STACK.md` — AG Grid Community 35.x install, `ModuleRegistry` registration, and `"use client"` for the Next App Router grid component.

### Requirements & scope
- `.planning/REQUIREMENTS.md` — GRID-01..08 (**note GRID-04's "read-only" is intentionally softened by D3-05**).
- `.planning/ROADMAP.md` §"Phase 3: Actuals Grid" — goal, success criteria, and the spike + per-field-patch / version discuss-note.
- `.planning/PROJECT.md` — locked stack, the per-activity column specs, and the autosave/real-time out-of-scope entry that drives D3-10.
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-03 (one-per-unit executions), D-04 (per-unit `version`), D-05 (numeric / app-side totals), D-15 (registry) all flow into this phase unchanged.
- `.planning/phases/02-plan-upload-and-periods/02-CONTEXT.md` — D2-04 (POP plan = one row per dealer), D2-06 (client-side parse), and the Server Action / `useActionState` conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`listByPeriodActivity(periodId, activity)`** (`lib/db/plan-rows.ts`) — the grid's read query, built in Phase 2 specifically for this screen; currently unused in UI.
- **Item master** (`item_master` + `lib/db/items.ts` + `/items` UI) — the POP popup's picker source (active items only; name snapshot per D-08).
- **Server Action + `useActionState` + ref-reset** scaffolding from periods/items/plans — copy for the executions save action and any entry forms.
- **`getActivePeriod()`** (`lib/periods/active.ts`, used by `/plans`) — the grid scopes to the active period the same way; the nav `PeriodSwitcher` changes it.
- **e2e seed helpers** (`_seedExecutionForTest`, `_findPlanRowIdForTest`) and the `/api/test/seed-execution` triply-gated route — already model writing an execution; extend for grid e2e.

### Established Patterns
- **Layering:** `lib/db/executions.ts` (typed read/write, no business rules) + `lib/actions/executions.ts` (Server Action: session + Zod + version check + revalidate) + `app/(app)/actuals/…` (the `"use client"` AG Grid). Mirrors the periods/items/plans split.
- **Registry-driven everything** — never hardcode an activity's columns; read `getActivity(key).actualColumns` for editors/calcs, `planColumns` for the read-only side.
- **Tailwind only, no shadcn yet** — match existing pages; the POP popup is a plain modal with Tailwind.

### Integration Points
- **`executions.plan_row_id` FK** — the grid writes executions only against existing plan rows; the off-plan guard needs no app check.
- **`version` column** — the optimistic-concurrency contract for D3-11; every per-unit patch reads + bumps it.
- **`computeFrom` in the registry** — the declarative hook the grid's app-side calc engine reads (D3-04/05).
- **App nav** (`app/(app)/layout.tsx`) — add the "Actuals" entry next to Periods / Plans / Items.

</code_context>

<specifics>
## Specific Ideas

- **Spike first** (throwaway) to validate AG Grid editing + virtualization + client-side filtering against ~a real period of rows before building the real grid (ROADMAP note; TanStack fallback).
- **Flat grid feel:** read-only plan cells visually muted; editable actual cells clearly distinct; derived cells show an "overridden / reset" affordance when hand-edited (D3-05).
- **POP "kit" row** shows item count + rolled total and opens the line-item popup to edit; **Dealer Certificate row** is Status + Date + Cost inline (D3-13/15).
- **Save bar:** a persistent "N unsaved changes — Save" control; per-row dirty highlight; conflict rows flagged "reload" on a blocked version check (D3-10/11/12).
- **Status** rendered as a Pending/In Progress/Done picker everywhere a status field exists (D3-09).

</specifics>

<deferred>
## Deferred Ideas

- **Server-side row model / paging** — only if a period exceeds ~5–10k rows (per D3-08); index already exists.
- **True expandable master-detail rows** — Enterprise / custom build; deferred in favor of the flat model (D3-01).
- **Row-per-dealer + side-drawer UI** — considered, not chosen (D3-01).
- **Multiple kits (executions) per POP dealer** — v1 is one kit per dealer (D3-13).
- **Soft-void / audit trail for deleted execution units** — v1 uses hard delete + confirm.
- **Audit of who overrode a derived total** — not in v1 (D3-05 keeps it simple).
- **Period-over-period comparison & saved/shareable filter views** — v2 (RPT-01 / RPT-02).

</deferred>

---

*Phase: 3-Actuals-Grid*
*Context gathered: 2026-06-05*
