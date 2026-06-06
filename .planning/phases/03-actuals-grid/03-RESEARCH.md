# Phase 3: Actuals Grid - Research

**Researched:** 2026-06-05
**Domain:** Editable spreadsheet-style data grid (AG Grid Community 35.x) on Next.js 16 App Router + React 19, over a registry-driven hybrid Postgres schema, with app-side derived calcs, custom cascading filters, batch save + per-unit optimistic concurrency, and a POP multi-item modal.
**Confidence:** HIGH (stack versions verified against npm registry + AG Grid official docs 2026-06-05; codebase substrate read directly; the one genuinely new surface — AG Grid integration — verified against current v33–v35 docs. Save-model and POP details are locked decisions, so research is prescriptive not exploratory.)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Grid Engine & Spike**
- **D3-00:** Grid engine is **AG Grid Community** (MIT, React 19); **TanStack Table is the documented fallback**. Begin with a **short throwaway spike** against a real period of data to confirm editing / virtualization / client-side filtering feel before committing. **Enterprise-only features are OFF-LIMITS** — master-detail, row grouping, Set Filter, native Excel export, aggregation — design strictly within Community.

**Multi-Unit Entry & Display**
- **D3-01:** Display model is a **FLAT grid — one row per execution unit**, sorted/clustered under each dealer (SFID). Plan columns are **read-only and repeat** on each unit row; actual columns are editable. No Enterprise master-detail or row grouping.
- **D3-02:** **All planned dealers are visible on open.** A dealer with zero executions shows as a single **empty, ready-to-fill row** (a placeholder bound to the plan_row); it becomes a real `executions` row only when data is entered and saved — no empty execution rows are persisted.
- **D3-03:** **Adding a unit clones the dealer's plan context** into a new editable unit row (a "+ add unit" affordance at the dealer level). Exact placement (action cell vs persistent add-row) is planner discretion.

**Derived Calculations**
- **D3-04:** **Sq ft formulas by activity:** Counter Wall = **entered Actual Sq Ft** (no derivation); In-shop = **Length × Breadth**; **GSB & NLB = Length × Breadth** (Height is **stored for reference, NOT part of the area**). **Total Cost** (measurement activities) = Total Sq Ft × Per-unit cost. **POP line total** = Qty × Rate. All computed **app-side** and persisted to the plain numeric columns (D-05), never Postgres generated columns.
- **D3-05:** Derived totals (Total Sq Ft, Total Cost) **auto-fill as you type but are OVERRIDABLE**. A manual override is **STICKY** for that cell (later edits to its inputs do not clobber it); a **"reset to formula"** affordance restores auto-calc. ⚠ Downstream verifier: treat "auto-filled + overridable" as the intended GRID-04 behavior, **not a miss**. Recommend updating REQUIREMENTS.md GRID-04 wording to match.

**Filtering, Search & Scale**
- **D3-06:** Filtering uses a **CUSTOM filter bar above the grid** with multi-select dropdowns for Region / State / District / Distributor / Status, plus an **SFID search box**. Dropdown option lists are built from the current period+activity data. Built-in AG Grid column filters are **not** the primary mechanism.
- **D3-07:** Location filters **CASCADE** — Region narrows State, State narrows District, etc.
- **D3-08:** Data loading is **CLIENT-SIDE**. Typical biggest activity-period ≤ ~1k dealers; load the full activity-period dataset into AG Grid and filter/search in the browser. `plan_rows_filter_idx` already exists for a future server-side path; **revisit only if a period crosses ~5–10k rows**.

**Status Vocabulary**
- **D3-09:** Status enum = **Pending / In Progress / Done**, **shared** across every activity that has a `status` field. For **Dealer Certificate, "Done" = "Issued."** Add as `enumValues` on each status `FieldDef` in the registry — a **config-only** change consistent with ACTV-03. (POP/Dealer-Kit has no status field; its executions leave `status` null.)

**Saving & Concurrency**
- **D3-10:** Save model is **BATCH-EDIT + EXPLICIT SAVE** (NOT autosave). Edits accumulate as "dirty"; a visible **"N unsaved changes / Save"** bar flushes them. On Save, changes are sent as per-unit patches, each carrying that execution's `version`.
- **D3-11:** **Concurrency:** each per-unit Save carries the row's `version`. A **version mismatch BLOCKS that unit's save** (no silent last-write-wins) and surfaces a "changed by someone else — reload this row" notice; unaffected units in the same batch still save. New (placeholder) rows insert with version 0.
- **D3-12:** **Dirty/saved indicator:** per-cell (or per-row) dirty highlight + the global unsaved-count Save bar; a clear "saved" confirmation after a successful flush.

**POP / Dealer-Kit & Dealer Certificate Entry**
- **D3-13:** A POP/Dealer-Kit dealer = **ONE execution ("kit") carrying N `execution_items`**. The flat-grid "unit row" for a POP dealer represents that kit; "edit" opens a popup/modal. (Multiple kits per dealer is deferred.)
- **D3-14:** The **POP popup** adds multiple line items: pick item from the **item master (ACTIVE items only, name SNAPSHOT at entry per D-08)**, enter Qty and Rate; **Line Total = Qty × Rate** auto-fills; the popup subtotal **rolls up to the dealer's row total**.
- **D3-15:** **Dealer Certificate** (GRID-08) entry captures **Status (issuance) + Date + Cost inline** on the execution row — no popup, no line items.

### Claude's Discretion
- Exact AG Grid column / cellRenderer / cellEditor wiring; the throwaway spike's scope; routing (likely `/actuals` with an activity+period selector, or `/actuals/[activity]`) — add an **"Actuals" link to the app nav** (`app/(app)/layout.tsx`).
- Sticky-override storage mechanism (e.g. a per-cell override flag in dirty state) and the "reset to formula" UI placement.
- "+ add unit" affordance placement; repeated read-only plan-cell visual treatment (muted vs blank-on-repeat).
- Delete-a-unit behavior — **recommend hard delete with a confirm dialog in v1** (no soft-void).
- Cascading-dropdown implementation (derive option sets from the loaded client-side rows).
- Per-unit patch Server Action shape — **batch array recommended**, mirrors Phase-2 `commitPlanUpload`; placement in `lib/actions/executions.ts` + a `lib/db/executions.ts` data-access module.

### Deferred Ideas (OUT OF SCOPE)
- **Server-side row model / paging** — only if a period exceeds ~5–10k rows.
- **True expandable master-detail rows** — Enterprise / custom build; deferred for the flat model.
- **Row-per-dealer + side-drawer UI** — considered, not chosen.
- **Multiple kits (executions) per POP dealer** — v1 is one kit per dealer.
- **Soft-void / audit trail for deleted execution units** — v1 uses hard delete + confirm.
- **Audit of who overrode a derived total** — not in v1.
- **Period-over-period comparison & saved/shareable filter views** — v2.
- **Completeness math / "% executed" and the dashboard** — Phase 4.
- **Excel export** — Phase 5.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRID-01 | View a period's plan rows for an activity in an editable, spreadsheet-style grid | AG Grid `AgGridReact` + `ClientSideRowModel` over `listByPeriodActivity()`; columns built from registry `planColumns`+`actualColumns` (§Architecture Pattern 1, §Code Examples) |
| GRID-02 | Plan columns read-only; actual columns editable inline | `colDef.editable` boolean per FieldDef origin; read-only plan cells via `editable:false` + muted `cellClass` (§Pattern 2) |
| GRID-03 | Filter by Region/State/District/Distributor/Status + SFID search | Custom Tailwind filter bar + AG Grid external filter (`isExternalFilterPresent`/`doesExternalFilterPass`) + `quickFilterText`; cascading option sets derived from loaded rows (§Pattern 4, §Code Examples) |
| GRID-04 | Auto-calc derived values (sq ft, total cost), store them; derived cells read-only **(softened by D3-05 to auto-filled + overridable + sticky)** | App-side calc engine reading `computeFrom` (§Pattern 3); `valueGetter`/`valueSetter` + change detection; sticky-override flag (§Pitfall 4, §Code Examples) |
| GRID-05 | A dealer (SFID) can have multiple execution entries, each with own measurements/cost | FLAT grid: one row per execution unit; placeholder rows (D3-02); "+ add unit" clones plan context (D3-03) (§Pattern 2) |
| GRID-06 | POP/dealer-kit as multiple line items via popup (item×qty×rate→total), rolled up | Tailwind modal over `listItems()` (ACTIVE only); `executions` + `execution_items` in one transaction (§Pattern 6, §Code Examples) |
| GRID-07 | Edits saved reliably (batched, saved/dirty indicator), grid stays responsive | Batch-edit + explicit Save bar; per-unit patch array Server Action; optimistic concurrency on `version`; AG Grid virtualization on by default (§Pattern 5, §Pitfalls 1–3) |
| GRID-08 | Dealer Certificate captures issuance status, date, cost | Inline `status`/`date`/`currency` cells on the execution row; no popup (D3-15) |
</phase_requirements>

## Summary

This phase has exactly **one new technical surface**: AG Grid Community 35.x inside the Next.js 16 App Router / React 19 environment. Everything else — Server Actions with `requireSession()` + Zod + `db.transaction()`, the registry as the single column source of truth, numeric-as-string handling, the structural off-plan guard, `useActionState` client forms — is already established and battle-tested in Phases 1–2. The job of the planner is to wire AG Grid correctly and then reuse the existing patterns for everything around it.

AG Grid Community 35.3.1 is verified on npm with React 19 in its peer-dependency range (`^19.0.0`), confirming STACK.md's HIGH-confidence pick. Three integration facts dominate the risk: (1) AG Grid v33+ uses a **new Theming API by default** (no CSS imports; the grid injects `themeQuartz` styles into the document head automatically) — this both removes the old `ag-grid.css`/`ag-theme-quartz.css` import dance *and* introduces a Tailwind-coexistence consideration; (2) v33+ requires **module registration** (`ModuleRegistry.registerModules([...])`) before the first grid renders — `AllCommunityModule` is the simplest, or tree-shake to `ClientSideRowModelModule` + the editor/filter modules; (3) the grid component must be `"use client"` and is safest behind a **`next/dynamic` import with `ssr: false`** to avoid any server-render of a browser-only widget. The derived-cell + sticky-override + dirty-tracking requirements map cleanly onto AG Grid's `valueGetter`/`valueSetter`, change detection, `cellClassRules`, and `onCellValueChanged` primitives — no custom grid internals needed.

The locked decisions deliberately steer **away** from every Enterprise feature: the FLAT one-row-per-unit model (D3-01) avoids master-detail/row-grouping; the custom filter bar (D3-06) avoids Set Filter; client-side load (D3-08) avoids the server-side row model. This is the correct Community-only architecture and also the simplest reliable-save design. The save model (batch + explicit Save + per-unit `version` optimistic concurrency) is the direct, intended fix for PITFALLS Pitfall 4 ("lost edits on the shared login") — the single most important correctness property of this phase after the off-plan guard.

**Primary recommendation:** Run the throwaway spike first (one activity, ~500–1000 seeded rows, inline edit + one custom editor + the external filter) behind a `next/dynamic({ssr:false})` boundary using `AllCommunityModule` + the default theme. If editing/scroll/filter feel is good (it will be at ≤1k rows), proceed; the TanStack fallback is only triggered by a spike failure. Then build: registry→colDefs mapper, a pure `lib/actuals/calc.ts` derive engine, `lib/db/executions.ts` + `lib/actions/executions.ts` (batch patch array + per-unit version check in one transaction), the custom cascading filter bar, and the POP Tailwind modal — each mirroring an existing Phase-1/2 module.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Grid render + inline edit | Browser / Client (`"use client"`, `ssr:false`) | — | AG Grid is a browser-only widget; React 19 hydration only |
| Derived calc (sq ft, totals, line totals) | Shared pure module (`lib/`, client+server) | — | D3-04/05 compute app-side; same fn must run in the grid (live) AND be re-applied server-side on save for trust (PITFALLS Pitfall 9) |
| Filter option derivation + cascading + apply | Browser / Client | — | D3-08 client-side load; options derived from loaded rows; AG Grid external filter runs in-browser |
| Dirty tracking + batch collection + Save trigger | Browser / Client | — | D3-10/12 batch-edit accumulates client-side until explicit Save |
| Auth re-check | API / Server Action | — | `requireSession()` at entry of every action (CVE-2025-29927 lesson; PITFALLS Pitfall 10) |
| Zod validation of patch payload | API / Server Action | — | Never trust the client; re-validate every patch (mirrors `commitPlanUpload`) |
| Optimistic concurrency (version compare + bump) | API / Server Action + Database | Database (`UPDATE ... WHERE id AND version`) | D3-11; the `WHERE version = ?` predicate + rowCount check is the real enforcement |
| Off-plan guard | Database (FK) | — | Structural; `executions.plan_row_id NOT NULL` — grid needs no app check (COMP-01) |
| Persist executions + execution_items | API / Server Action → Data-access (`lib/db/executions.ts`) | Database (transaction) | Mirror periods/items/plans layering; POP kit write is one transaction |
| Initial row fetch | API / Server Component (page) → Data-access | — | Server Component loads `listByPeriodActivity()` + executions, hands to client grid |

## Standard Stack

### Core (already installed — verified in package.json)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | 16.2.7 | App Router, Server Actions, Server Components | Locked; current GA `[CITED: package.json]` |
| react / react-dom | 19.2.7 | UI runtime | Ships with Next 16; the reason Glide is excluded `[CITED: package.json]` |
| drizzle-orm | 0.45.2 | Typed queries, transactions, schema | Established; numeric→string seam already understood `[CITED: package.json]` |
| zod | 4.4.3 | Server Action payload validation | Established pattern across all actions `[CITED: package.json]` |
| @electric-sql/pglite | 0.5.1 | Local Postgres for dev + vitest | Dual-driver seam; transactions identical to Supabase `[CITED: package.json]` |
| tailwindcss | 4.3.0 | Styling (no shadcn) | Project standard; filter bar, Save bar, POP modal all hand-built `[CITED: package.json]` |

### Supporting (NEW — to install this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| ag-grid-community | 35.3.1 | Grid engine (rows, virtualization, editing, theming) | The grid; register modules before render `[VERIFIED: npm registry — see audit + slopcheck caveat]` |
| ag-grid-react | 35.3.1 | React wrapper (`AgGridReact`) | The React component; React 19 in peerDeps `[VERIFIED: npm registry — peerDeps react ^19.0.0]` |

**Installation:**
```bash
npm install ag-grid-community@35.3.1 ag-grid-react@35.3.1
```

**Version verification (run 2026-06-05):**
- `npm view ag-grid-community version` → **35.3.1** `[VERIFIED: npm registry]`
- `npm view ag-grid-react version` → **35.3.1** `[VERIFIED: npm registry]`
- `npm view ag-grid-react peerDependencies` → `react: '^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0'` — **React 19 supported** `[VERIFIED: npm registry]`
- Pin to exact `35.3.1` (no caret), consistent with how the project pins `next`, `react`, `drizzle-orm`, `zod` exactly. Keep `ag-grid-community` and `ag-grid-react` **identical** versions (AG Grid requires the two packages match).

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| AG Grid Community | TanStack Table 8.21.3 + TanStack Virtual 3.14.2 | The locked fallback (D3-00). Headless: you build editing, filter UI, virtualization yourself. Only triggered by a spike failure. `[CITED: STACK.md]` |
| AG Grid Theming API (default) | Legacy CSS themes (`theme="legacy"` + `import 'ag-grid-community/styles/ag-grid.css'`) | Only if the new Theming API conflicts badly with Tailwind. Default themeQuartz is recommended. `[CITED: ag-grid.com/react-data-grid/theming-migration]` |

## Package Legitimacy Audit

> slopcheck was **unavailable** in this environment (pip install failed, not on PATH). Per protocol, packages are normally tagged `[ASSUMED]` when slopcheck cannot run. However, both AG Grid packages are cross-verified through multiple authoritative channels below, so the planner should gate the **single install command** behind one `checkpoint:human-verify` task (not a blocker — a 5-second confirmation that the install pulled `ag-grid-community`/`ag-grid-react` 35.3.1 from the real npm registry).

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| ag-grid-community | npm | ~10 yrs (since 2015) | multi-million/wk | github.com/ag-grid/ag-grid | unavailable | Approved — verify at install checkpoint |
| ag-grid-react | npm | ~10 yrs | multi-million/wk | github.com/ag-grid/ag-grid | unavailable | Approved — verify at install checkpoint |

**Cross-verification (compensating for missing slopcheck):**
- Named with HIGH confidence in `.planning/research/STACK.md` (verified against npm + AG Grid official docs 2026-06-04). `[CITED: STACK.md]`
- Named in `CLAUDE.md` prescriptive stack table. `[CITED: CLAUDE.md]`
- `npm view` returns real version 35.3.1, real GitHub repo, React 19 peerDeps confirmed this session. `[VERIFIED: npm registry]`
- AG Grid official docs reachable and describe v35 APIs (modules, theming). `[CITED: ag-grid.com]`

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*No postinstall-script risk expected (AG Grid is a pure library), but the install checkpoint should glance at the npm output to confirm no unexpected scripts ran.*

## Architecture Patterns

### System Architecture Diagram

```
                         ACTUALS GRID — DATA FLOW
  ┌──────────────────────────────────────────────────────────────────────┐
  │ SERVER COMPONENT  app/(app)/actuals/[…]/page.tsx                       │
  │   getActivePeriod() ─┐                                                 │
  │   listByPeriodActivity(periodId, activity) ──┐  (plan rows, str nums)  │
  │   listExecutionsByPeriodActivity(...)  ──────┤  (executions + version) │
  │   listItems()  (for POP picker, ACTIVE) ─────┤                         │
  │                                              ▼                         │
  │            build initial row model (flat: plan row → N unit rows,      │
  │                      + 1 placeholder per zero-exec dealer)             │
  └───────────────────────────────┬──────────────────────────────────────┘
                                   │ props (rows, activityKey, items)
                                   ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ CLIENT  <ActualsGrid>  (next/dynamic ssr:false, "use client")         │
  │  ┌────────────┐    reads colDefs from REGISTRY (getActivity(key))     │
  │  │ Filter Bar │───► external filter + quickFilter ──┐                  │
  │  │ cascading  │    options derived from loaded rows │                  │
  │  └────────────┘                                     ▼                  │
  │  ┌───────────────────────────────────────────────────────────────┐   │
  │  │  AgGridReact (ClientSideRowModel, themeQuartz, virtualized)    │   │
  │  │   plan cols: editable:false (muted)                           │   │
  │  │   actual cols: editable cellEditors per FieldKind            │   │
  │  │   derived cols: valueGetter(calc) unless sticky-override     │   │
  │  │   onCellValueChanged ─► mark unit dirty (Map<rowId,patch>)   │   │
  │  │   POP unit row: button cell ─► opens modal                   │   │
  │  └───────────────────────────────────────────────────────────────┘   │
  │  ┌────────────────┐   ┌──────────────────────────────────────────┐   │
  │  │ "+ add unit"   │   │ POP Modal (Tailwind): pick item (ACTIVE), │   │
  │  │ clones plan ctx│   │ qty×rate→line total, subtotal→row total  │   │
  │  └────────────────┘   └──────────────────────────────────────────┘   │
  │  ┌───────────────────────────────────────────────────────────────┐   │
  │  │ SAVE BAR: "N unsaved changes — Save"  (explicit, no autosave)  │   │
  │  └───────────────────────────────────┬───────────────────────────┘   │
  └──────────────────────────────────────┼───────────────────────────────┘
                                          │ patch array [{planRowId, id?, version, fields…}]
                                          ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ SERVER ACTION  lib/actions/executions.ts  saveExecutionsBatch()        │
  │   requireSession()  →  Zod parse  →  re-run calc engine (trust)        │
  │   db.transaction:                                                      │
  │     placeholders → INSERT (version 0)                                  │
  │     existing     → UPDATE ... WHERE id=? AND version=?  (rowCount==0   │
  │                     ⇒ conflict, collect, DO NOT overwrite)             │
  │     POP kit      → INSERT/UPDATE execution + replace execution_items   │
  │   returns { savedIds, conflicts[] }  →  revalidatePath("/actuals")     │
  └───────────────────────────────────────┬──────────────────────────────┘
                                           ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │ POSTGRES   executions (FK→plan_rows, version) ◄─ execution_items       │
  │            off-plan guard structural; numeric(14,2) totals             │
  └──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (new files this phase)
```
app/(app)/actuals/
├── page.tsx                 # Server Component: period+activity selector → grid (or [activity]/page.tsx)
├── actuals-grid.tsx         # "use client" — the AgGridReact + filter bar + save bar (dynamic-imported)
├── grid-loader.tsx          # next/dynamic({ ssr:false }) wrapper around actuals-grid
├── filter-bar.tsx           # custom cascading multi-select + SFID search (Tailwind)
├── save-bar.tsx             # "N unsaved changes — Save" + conflict surfacing
├── pop-modal.tsx            # Tailwind modal: item picker + line items (item-list activities)
└── ag-grid-setup.ts         # ModuleRegistry.registerModules([...]) — imported once by the client grid
lib/db/
└── executions.ts            # typed read/write: listExecutionsByPeriodActivity, insert/update with version, items
lib/actions/
└── executions.ts            # "use server" saveExecutionsBatch (session + Zod + calc + version tx)
lib/actuals/
├── calc.ts                  # PURE derive engine: computeDerived(activityKey, unitFields) — client+server
├── colDefs.ts               # registry FieldDef[] → AG Grid ColDef[] (kind→editor/renderer/valueGetter)
└── rows.ts                  # build flat row model: plan rows + executions + placeholders; types
```
**Rationale:** mirrors the established three-layer split (`lib/db/*` typed I/O, no rules → `lib/actions/*` session+Zod+tx → `app/(app)/*` UI). `lib/actuals/` is the analogue of `lib/excel/` — framework-light, unit-testable pure logic (calc + colDef mapping + row assembly) separated from the React grid. `lib/actuals/calc.ts` must stay dependency-free (no react/drizzle/next) so the Server Action can import it for the trust-recompute on save (same discipline as `lib/activities/types.ts`).

### Pattern 1: Registry-Driven Column Generation (the spine, reused)
**What:** Build AG Grid `ColDef[]` from `getActivity(key).planColumns` (read-only) + `actualColumns` (editable), mapping each `FieldDef.kind` to an editor/renderer. Never hardcode an activity's columns.
**When to use:** Every grid column. A 7th activity must "just work" (ACTV-03).
**Example:**
```typescript
// lib/actuals/colDefs.ts  (Source: registry shape from lib/activities/types.ts)
import type { ColDef } from "ag-grid-community";
import type { FieldDef, ActivityConfig } from "@/lib/activities/types";

const EDITOR_BY_KIND: Record<FieldDef["kind"], string | undefined> = {
  text: "agTextCellEditor",
  number: "agNumberCellEditor",
  currency: "agNumberCellEditor",      // ₹ formatting via valueFormatter, not a special editor
  date: "agDateStringCellEditor",      // stores 'YYYY-MM-DD' string (DD/MM display via valueFormatter)
  status: "agSelectCellEditor",        // cellEditorParams.values = fieldDef.enumValues (D3-09)
  enum: "agSelectCellEditor",
  lat: "agTextCellEditor",             // PITFALLS: lat/long stay text, never numeric-coerced
  long: "agTextCellEditor",
};

export function buildColumnDefs(cfg: ActivityConfig): ColDef[] {
  const plan = cfg.planColumns.map((f): ColDef => ({
    headerName: f.label,
    field: `plan.${f.key}`,
    editable: false,
    cellClass: "ag-cell-plan",         // muted styling (D3-05 read-only treatment)
  }));
  const actual = cfg.actualColumns.map((f): ColDef => ({
    headerName: f.label,
    field: `fields.${f.key}`,
    editable: f.computeFrom ? isOverridable(f) : true,  // derived editable only as override (D3-05)
    cellEditor: EDITOR_BY_KIND[f.kind],
    cellEditorParams: f.enumValues ? { values: [...f.enumValues] } : undefined,
    // derived cells get a valueGetter (Pattern 3); set below in the mapper
  }));
  return [...plan, ...actual];
}
```
**Note:** AG Grid supports nested `field` paths (`"fields.length"`), which fits storing actuals under a `fields` object on the row — but verify dotted-path support in the spike; flattening into top-level keys is the fallback. `[ASSUMED — dotted field path; confirm in spike]`

### Pattern 2: FLAT Row Model with Placeholders + Add-Unit (D3-01/02/03)
**What:** Each grid row = one execution unit. A plan_row with zero executions contributes exactly one **placeholder** row (carries `planRowId`, `id: null`, empty `fields`). Adding a unit clones the dealer's plan context into a new `id:null` row. Plan columns repeat (read from the shared plan context on each row).
**When to use:** The whole grid. This is what makes it Community-only (no master-detail).
**Row type:**
```typescript
// lib/actuals/rows.ts
export type UnitRow = {
  rowKey: string;            // stable client id for AG Grid getRowId (e.g. `e:${id}` or `new:${uuid}`)
  planRowId: number;         // FK target — always present (off-plan guard)
  executionId: number | null;// null = placeholder / new unit (insert path, version 0)
  version: number;           // 0 for new; server value for existing (optimistic concurrency)
  plan: Record<string, unknown>;   // repeated read-only plan context (from PlanRowRecord)
  fields: Record<string, unknown>; // editable actuals + derived + per-field override flags
  isPlaceholder: boolean;    // true until first edit; never persisted while empty (D3-02)
  dirty: boolean;
};
```
**Persistence rule (D3-02):** a placeholder that is still empty at Save time is **skipped** (no empty execution rows persisted). A placeholder that received any edit becomes an INSERT. Use a stable `getRowId` so AG Grid edits map back to the right `UnitRow`.

### Pattern 3: App-Side Derived Calc via valueGetter + Sticky Override (D3-04/05)
**What:** A pure `computeDerived` reads `FieldDef.computeFrom` and applies the per-activity formula. The grid shows the derived value through a `valueGetter` **unless** the user overrode that cell (sticky). AG Grid change detection automatically refreshes a derived cell when an input cell changes.
**When to use:** Total Sq Ft, Total Cost, POP Line Total.
**Example:**
```typescript
// lib/actuals/calc.ts  (PURE — no react/drizzle/next; importable client + server)
// Formulas are LOCKED by D3-04. Values kept as numbers here; stringify at the numeric(14,2) boundary.
export function computeDerived(
  activityKey: string,
  key: string,                  // the derived field key, e.g. "totalSqft" | "totalCost" | "lineTotal"
  f: Record<string, unknown>,   // current unit fields
): number | null {
  const num = (k: string) => {
    const v = f[k];
    const n = typeof v === "string" ? Number(v.replace(/[₹,\s]/g, "")) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  if (key === "totalSqft") {
    if (activityKey === "counter-wall") return num("actualSqft");      // entered, not derived
    if (activityKey === "in-shop") {                                   // L × B
      const l = num("length"), b = num("breadth");
      return l != null && b != null ? l * b : null;
    }
    if (activityKey === "gsb" || activityKey === "nlb") {              // L × B (Height excluded — D3-04)
      const l = num("length"), b = num("breadth");
      return l != null && b != null ? l * b : null;
    }
  }
  if (key === "totalCost") {                                           // Total Sq Ft × Per-unit cost
    const sq = f.totalSqft != null && !isOverridden(f, "totalSqft")
      ? computeDerived(activityKey, "totalSqft", f) : num("totalSqft");
    const pu = num("perUnitCost");
    return sq != null && pu != null ? round2(sq * pu) : null;
  }
  if (key === "lineTotal") {                                           // POP: Qty × Rate
    const q = num("qty"), r = num("rate");
    return q != null && r != null ? round2(q * r) : null;
  }
  return null;
}
const round2 = (n: number) => Math.round(n * 100) / 100;             // round half-up once (PITFALLS Pitfall 9)
function isOverridden(f: Record<string, unknown>, key: string) {
  return (f.__overrides as Record<string, boolean> | undefined)?.[key] === true;
}
```
```typescript
// In the ColDef for a derived field (e.g. totalCost):
{
  headerName: "Total cost",
  colId: "totalCost",
  editable: true,                       // overridable (D3-05)
  valueGetter: (p) => isOverridden(p.data.fields, "totalCost")
    ? p.data.fields.totalCost
    : computeDerived(activityKey, "totalCost", p.data.fields),
  valueSetter: (p) => {                  // manual edit → STICKY override
    p.data.fields.totalCost = p.newValue;
    setOverride(p.data.fields, "totalCost", true);
    return true;                         // true ⇒ AG Grid refreshes the cell
  },
  cellClassRules: {
    "ag-cell-overridden": (p) => isOverridden(p.data.fields, "totalCost"),
  },
}
// "reset to formula": clear the override flag, set value to computeDerived(...), call api.refreshCells.
// Source: valueGetter/valueSetter + change detection + cellClassRules — ag-grid.com/react-data-grid/change-detection, /value-setters, /cell-styles
```
**Critical:** the same `computeDerived` runs **server-side on Save** to recompute and persist authoritative totals for non-overridden cells (PITFALLS Pitfall 9 — "one authoritative calc path so grid, export, dashboard never disagree"). Overridden cells persist the user's value.

### Pattern 4: Custom Cascading Filter Bar via External Filter (D3-06/07/08)
**What:** A Tailwind filter bar holds multi-selects (Region/State/District/Distributor/Status) + an SFID search box. Options are derived from the **loaded client-side rows** and cascade (selecting Region narrows the State options to states present under that Region, etc.). Apply via AG Grid's **external filter** API; SFID search via `quickFilterText`.
**When to use:** The filter bar. Set Filter is Enterprise, so this is mandatory.
**Example:**
```typescript
// Derive cascading options from loaded rows (no server round-trip — D3-08):
function optionsFor(rows: UnitRow[], col: string, upstream: Partial<Record<string,string[]>>) {
  const passes = (r: UnitRow) =>
    Object.entries(upstream).every(([k, vals]) =>
      !vals?.length || vals.includes(String(r.plan[k] ?? "")));
  return [...new Set(rows.filter(passes).map(r => String(r.plan[col] ?? "")).filter(Boolean))].sort();
}

// AG Grid external filter wiring (the two callbacks + a refresh on change):
const gridOptions = {
  isExternalFilterPresent: () => activeFilters.size > 0,
  doesExternalFilterPass: (node) => matchesAllSelectedFacets(node.data),
};
// On any filter change: gridApi.onFilterChanged();   // re-runs doesExternalFilterPass
// SFID search box: <AgGridReact quickFilterText={sfidSearch} ... />  (matches across visible cells)
// Source: ag-grid.com/react-data-grid/filter-external + quick-filter
```
**Note:** `quickFilter` scans rendered cell values; for an SFID-only search, prefer a dedicated SFID predicate inside `doesExternalFilterPass` (exact/prefix on `plan.sfid`) so it doesn't match other columns. `[CITED: ag-grid.com/react-data-grid/filter-external]`

### Pattern 5: Batch-Edit + Explicit Save + Per-Unit Optimistic Concurrency (D3-10/11/12)
**What:** `onCellValueChanged` marks the `UnitRow` dirty and records the patch in a client `Map<rowKey, patch>`. A persistent Save bar shows the count. On Save, post the **whole patch array** in one Server Action. Server runs each patch in one transaction: placeholders INSERT (version 0); existing rows `UPDATE ... WHERE id=? AND version=?` — if rowCount is 0, that unit **conflicts** (changed underneath) and is collected, never overwritten. Return `{ savedIds, conflicts }`; client clears dirty on saved, flags conflict rows "reload."
**When to use:** All saves. This is the direct mitigation of PITFALLS Pitfall 4.
**Example:**
```typescript
// lib/db/executions.ts  — version-checked update (returns rows affected)
export async function updateExecutionVersioned(
  tx: DbOrTx, id: number, expectedVersion: number, patch: ExecPatch,
): Promise<boolean> {
  const res = await tx.update(executions)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(executions.id, id), eq(executions.version, expectedVersion)));
  // Drizzle: check rowsAffected/rowCount across drivers; PGlite + postgres-js differ — normalize.
  return rowCountOf(res) === 1;     // false ⇒ version conflict, do NOT retry/overwrite
}
```
```typescript
// lib/actions/executions.ts  (mirror commitPlanUpload: requireSession + Zod + ONE transaction)
export async function saveExecutionsBatch(_prev: unknown, input: SaveBatchInput): Promise<SaveBatchState> {
  await requireSession();
  const parsed = saveBatchSchema.safeParse(input);     // Zod re-validate every patch
  if (!parsed.success) return { ok: false, error: firstIssue(parsed) };
  const conflicts: number[] = [];
  const savedIds: Array<{ rowKey: string; id: number; version: number }> = [];
  await db.transaction(async (tx) => {
    for (const u of parsed.data.units) {
      // re-run authoritative calc for non-overridden derived fields (PITFALLS Pitfall 9)
      const fields = applyServerCalc(parsed.data.activity, u.fields);
      if (u.executionId == null) {
        const id = await insertExecution(tx, { planRowId: u.planRowId, fields, version: 0 });
        savedIds.push({ rowKey: u.rowKey, id, version: 0 });
      } else {
        const ok = await updateExecutionVersioned(tx, u.executionId, u.version, { fields });
        if (!ok) conflicts.push(u.executionId);
        else savedIds.push({ rowKey: u.rowKey, id: u.executionId, version: u.version + 1 });
      }
    }
  });
  revalidatePath("/actuals");
  return { ok: true, savedIds, conflicts };
}
```
**Concurrency subtlety:** because unaffected units must still save when one conflicts (D3-11), per-unit conflicts are **collected, not thrown** — a throw would roll back the whole batch. This differs from `commitPlanUpload`, where the FK-restrict throw *should* roll back everything. Document this difference explicitly for the planner. (Alternative if "all-or-nothing per save" were ever wanted: throw on first conflict — but D3-11 forbids that.)

### Pattern 6: POP Multi-Item Modal → executions + execution_items in One Transaction (D3-13/14)
**What:** For `item-list` activities the unit row is the "kit." A Tailwind modal (mirror the `useActionState` + `formRef.current?.reset()` shape from `item-form.tsx`) lists ACTIVE items (`listItems().filter(i => i.active)`), lets the user add N lines (item, qty, rate; Line Total = Qty×Rate auto-filled), and on save writes the kit execution + replaces its `execution_items` atomically. The kit row total = sum of line totals.
**When to use:** Only POP/Dealer-Kit. Other activities edit inline.
**Example:**
```typescript
// lib/db/executions.ts — POP kit write (one transaction)
export async function savePopKit(tx: DbOrTx, planRowId: number, executionId: number | null,
  lines: { itemName: string; qty: number; rate: number; lineTotal: number }[]): Promise<number> {
  const execId = executionId
    ?? await insertExecution(tx, { planRowId, fields: {}, version: 0, totalCost: sum(lines, "lineTotal") });
  // D-08: itemName is a SNAPSHOT (text), NOT an FK to item_master.
  await tx.delete(executionItems).where(eq(executionItems.executionId, execId));   // replace-all
  if (lines.length) await tx.insert(executionItems).values(
    lines.map(l => ({ executionId: execId, itemName: l.itemName,
      qty: String(l.qty), rate: String(l.rate), lineTotal: String(l.lineTotal) })));  // numeric→string
  return execId;
}
```
**Note:** snapshot `itemName` at entry (D-08) — store the name string, never an item_master FK; that is why `execution_items.itemName` is `text NOT NULL` not a reference. Picker shows only `active` items, but a previously-snapshotted retired item's name persists unaffected. `[CITED: lib/db/schema.ts, lib/db/items.ts]`

### AG Grid Setup (Next 16 App Router — the one new surface)
```typescript
// app/(app)/actuals/ag-grid-setup.ts  — run ONCE before any grid renders (module side-effect)
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
ModuleRegistry.registerModules([AllCommunityModule]);
// Tree-shake later if bundle matters: ClientSideRowModelModule, TextEditorModule,
// NumberEditorModule, DateEditorModule, SelectEditorModule, ValidationModule,
// TextFilterModule, NumberFilterModule, RenderApiModule (verify exact names in spike).
// Source: ag-grid.com/react-data-grid/modules
```
```typescript
// app/(app)/actuals/grid-loader.tsx  — dynamic import disables SSR for the browser-only grid
import dynamic from "next/dynamic";
export default dynamic(() => import("./actuals-grid"), {
  ssr: false,                                   // AG Grid is client-only; avoids any server render
  loading: () => <p className="p-6 text-sm text-neutral-500">Loading grid…</p>,
});
```
```typescript
// app/(app)/actuals/actuals-grid.tsx  — "use client"; no CSS import needed (v33+ Theming API default)
"use client";
import "./ag-grid-setup";
import { AgGridReact } from "ag-grid-react";
// v33+: NOT importing any CSS gives the default themeQuartz, auto-injected into <head>.
// (Legacy escape hatch only if Tailwind conflicts: theme="legacy" + import the CSS files.)
<AgGridReact
  rowData={rows}
  columnDefs={colDefs}
  getRowId={(p) => p.data.rowKey}              // stable id so edits map back to UnitRow
  quickFilterText={sfidSearch}
  // external filter callbacks wired via gridOptions / props
/>
// Source: ag-grid.com/react-data-grid/getting-started + theming-migration (themeQuartz default v33+)
```

### Anti-Patterns to Avoid
- **Importing legacy AG Grid CSS (`ag-grid.css` / `ag-theme-quartz.css`) AND using the default Theming API.** v33+ injects theme CSS itself; mixing causes duplicated/conflicting styles. Use the default theme (no import) OR `theme="legacy"` + CSS — never both. `[CITED: ag-grid.com/react-data-grid/theming-migration]`
- **Rendering AG Grid in a Server Component / without `ssr:false`.** It is browser-only; SSR risks hydration/`window` issues. Wrap in `next/dynamic({ssr:false})`. `[CITED: WebSearch — Next.js App Router window-not-defined consensus]`
- **`Number()`-ing numeric columns for storage or summation.** Drizzle returns `numeric` as string (proven in `PlanRowRecord.plannedCost: string | null`). Keep as string at the DB boundary; compute in the calc engine then stringify back. `[CITED: lib/db/plan-rows.ts]`
- **Throwing on a per-unit version conflict.** That rolls back the whole batch and breaks D3-11 (unaffected units must still save). Collect conflicts, don't throw.
- **Autosave / per-keystroke save.** Forbidden by PROJECT.md + D3-10; also a connection-storm risk (PITFALLS Pitfall 13). Batch + explicit Save only.
- **Recompute-on-override loop.** A derived `valueSetter` that triggers `onCellValueChanged` which re-derives and re-sets can loop. Guard: the override flag short-circuits the `valueGetter`; the setter only flips the flag + stores the value, it does not re-derive.
- **One page per activity / hardcoded columns.** Defeats ACTV-03. One `/actuals` (or `/actuals/[activity]`) reading the registry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Row virtualization for ~1k editable rows | Custom windowing | AG Grid (on by default) | Row+column virtualization is built-in; the whole reason for the dep `[CITED: STACK.md]` |
| Inline cell editing (text/number/date/select) | Custom contentEditable inputs | AG Grid cellEditors (`agTextCellEditor`, `agNumberCellEditor`, `agDateStringCellEditor`, `agSelectCellEditor`) | Edit lifecycle, keyboard nav, commit/cancel handled `[CITED: ag-grid.com/modules]` |
| Derived-cell recompute when an input changes | Manual subscription/effect graph | AG Grid change detection + `valueGetter` | Grid re-evaluates dependent valueGetters on any cell change `[CITED: ag-grid.com/change-detection]` |
| Dirty-cell highlighting | Manual class toggling per cell | `cellClassRules` | Re-evaluated automatically on row updates `[CITED: ag-grid.com/cell-styles]` |
| Optimistic concurrency | Read-modify-write + manual compare | `UPDATE ... WHERE id=? AND version=?` + rowCount | DB does the atomic check; race-safe `[CITED: PITFALLS Pitfall 4]` |
| Theme/styling of the grid | Custom grid CSS from scratch | Default `themeQuartz` (Theming API) | Auto-injected, accessible, consistent `[CITED: ag-grid.com/theming]` |
| ₹ / DD-MM formatting in cells | Parsing in renderers | `valueFormatter` per column | Display-only transform; keeps stored value clean |
| Session check | New auth in the action | `requireSession()` (existing) | Established; CVE-2025-29927 defense-in-depth `[CITED: lib/actions/*.ts]` |
| Transaction boundary | Ad-hoc multi-write | `db.transaction(async tx => …)` + tx-handle helpers | Established cross-driver pattern `[CITED: lib/actions/plans.ts]` |

**Key insight:** AG Grid Community already provides every grid primitive this phase needs; the custom code is the *thin glue* (registry→colDefs, calc engine, dirty/save orchestration, filter derivation) plus the POP modal. The server side is a near-clone of `commitPlanUpload` with a version check swapped in for the FK-restrict catch.

## Common Pitfalls

### Pitfall 1: Lost edits on the shared login (THE critical one — PITFALLS Pitfall 4)
**What goes wrong:** Two people share one password and split the dealer list. A whole-row save silently overwrites a concurrent edit to a different field on the same row.
**Why it happens:** Inline grids default to whole-row writes with no version check; never surfaces in single-user testing.
**How to avoid:** Per-unit patches (not whole-grid), `UPDATE ... WHERE id=? AND version=?`, rowCount==0 ⇒ block + "reload this row" (D3-10/11). The `version` column already exists (`executions.version`). Bump version on every successful update.
**Warning signs:** save payload is the whole grid; no `version` predicate; "works fine" but only ever one tester.

### Pitfall 2: Drizzle numeric returns as string → NaN math / string concatenation
**What goes wrong:** `totalSqft`/`perUnitCost`/`qty`/`rate` arrive as strings; `a * b` on strings or `Number()` round-tripping reintroduces float error or NaN.
**Why it happens:** `numeric` is returned as string by both drivers (confirmed: `PlanRowRecord.plannedCost: string | null`).
**How to avoid:** Parse-once in the calc engine (strip `₹`/commas, `Number.isFinite` guard), round half-up once, stringify back at the `numeric(14,2)` write boundary. Keep raw `numeric` as string elsewhere. `[CITED: lib/db/plan-rows.ts, PITFALLS Pitfall 9]`
**Warning signs:** totals are NaN or absurd; dashboard later won't equal sum of rows.

### Pitfall 3: AG Grid theming collision with Tailwind / double CSS
**What goes wrong:** Importing legacy AG Grid CSS while v35's default Theming API also injects styles → conflicting/duplicated grid CSS, or unstyled grid if you assume the old import is still required.
**Why it happens:** Most pre-v33 tutorials show `import 'ag-grid-community/styles/ag-grid.css'`; that's now legacy-only.
**How to avoid:** Use the default theme (import nothing). If the auto-injected theme clashes with Tailwind preflight, isolate the grid container or use `theme="legacy"` + explicit CSS as the documented escape hatch. Decide in the spike. `[CITED: ag-grid.com/react-data-grid/theming-migration]`
**Warning signs:** grid renders with no styling, or doubled borders/fonts; console warning about mixing theming methods.

### Pitfall 4: Recompute-on-override infinite loop (D3-05 sticky override)
**What goes wrong:** A derived cell's `valueSetter` writes a value that triggers change detection → re-derives → re-sets → loop or flicker.
**Why it happens:** Treating the override as just another edit that feeds back into the formula.
**How to avoid:** The override flag short-circuits the `valueGetter` (overridden ⇒ return stored value, skip formula). The `valueSetter` only sets the value + flips the flag; it never re-derives. "Reset to formula" clears the flag and recomputes once.
**Warning signs:** typing in a total causes flicker; CPU spike on edit; the total "fights" the user.

### Pitfall 5: Placeholder rows persisted as empty executions (violates D3-02)
**What goes wrong:** Every zero-execution dealer's placeholder row gets INSERTed on Save, creating meaningless empty executions that pollute the Phase-4 "% executed" math.
**Why it happens:** Treating all visible rows as savable.
**How to avoid:** A placeholder with no edits is **skipped** at Save (filter `isPlaceholder && !dirty`). Only a placeholder that received input becomes an INSERT. `[CITED: 03-CONTEXT D3-02]`
**Warning signs:** execution count jumps on Save without data entry; Phase-4 completeness looks wrong.

### Pitfall 6: rowCount/rowsAffected differs across PGlite vs postgres-js
**What goes wrong:** The version-check `UPDATE ... WHERE version=?` needs "rows affected"; PGlite and postgres-js expose it differently, so a naive read returns undefined → conflicts mis-detected.
**Why it happens:** Dual-driver seam (already a known source of differences — see `isFkRestrictError` duck-typing in `plans.ts`).
**How to avoid:** Normalize a `rowCountOf(result)` helper (mirror the cross-driver duck-typing discipline in `lib/actions/plans.ts`). Prove it with a PGlite smoke + a vitest concurrency test. `[CITED: lib/actions/plans.ts isFkRestrictError]`
**Warning signs:** version conflicts never fire, or always fire; concurrency test flaky.

### Pitfall 7: SSR / hydration of the grid
**What goes wrong:** Rendering `AgGridReact` server-side trips `window`/hydration mismatches.
**How to avoid:** `next/dynamic({ssr:false})` wrapper + `"use client"`. `[CITED: WebSearch consensus]`
**Warning signs:** `window is not defined` at build/SSR; hydration warnings.

## Code Examples

(See Patterns 1–6 and "AG Grid Setup" above — all examples are inline there with sources.) Key external API references verified this session:
- Module registration: `ModuleRegistry.registerModules([AllCommunityModule])` — `[CITED: ag-grid.com/react-data-grid/modules]`
- Default theme since v33 (no CSS import → themeQuartz) — `[CITED: ag-grid.com/react-data-grid/theming-migration]`
- `valueSetter` returns `true` to refresh; change detection refreshes dependent `valueGetter` cells — `[CITED: ag-grid.com/react-data-grid/change-detection + value-setters]`
- `cellClassRules` re-evaluated on row update (dirty/override highlighting) — `[CITED: ag-grid.com/react-data-grid/cell-styles]`
- External filter: `isExternalFilterPresent` + `doesExternalFilterPass`; `quickFilterText` for search — `[CITED: ag-grid.com/react-data-grid/filter-external]`

## Runtime State Inventory

> Greenfield-on-existing-substrate feature (new grid over existing tables). Not a rename/refactor — but the placeholder/version model touches stored data, so the relevant subset is noted.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `executions` rows from e2e seeding (`_seedExecutionForTest` inserts status='Pending', unit_no='e2e-seed-1'/'unit-1'). These have `version=0` default. | None — new save path reads/writes `version` natively; existing seeds are valid version-0 rows. |
| Live service config | None — no external services hold grid state. | None — verified: app is single Next.js deploy, no n8n/scheduler/etc. |
| OS-registered state | None. | None. |
| Secrets/env vars | `DATABASE_URL` (driver seam), `APP_PASSWORD`, `SESSION_SECRET` — all already in use, unchanged by this phase. | None — no new env vars. |
| Build artifacts | New npm deps (`ag-grid-community`, `ag-grid-react`) added to `package.json`/lockfile. | Run `npm install`; commit lockfile change. |

**Schema change needed:** **None for tables** — `executions` (status/unitNo/perUnitCost/totalCost/totalSqft/fields jsonb/version/updatedAt) and `execution_items` (itemName/qty/rate/lineTotal) already hold everything (verified `lib/db/schema.ts`). The **only** registry change is adding `enumValues: ["Pending","In Progress","Done"]` to each `status` FieldDef (D3-09) — a config edit in the per-activity modules, no migration. `[CITED: lib/db/schema.ts, lib/activities/*.ts]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `import 'ag-grid-community/styles/ag-grid.css'` + theme CSS | Theming API default; grid injects `themeQuartz`; no CSS import | AG Grid v33 (2024) | Don't follow pre-v33 tutorials' CSS imports; default theme "just works" `[CITED: ag-grid.com/theming-migration]` |
| Grid worked with zero module setup | `ModuleRegistry.registerModules([...])` required before first render | AG Grid v33 modules overhaul | Must register `AllCommunityModule` (or tree-shaken set) or grid errors `[CITED: ag-grid.com/modules]` |
| `ag-grid-community/styles` legacy themes (alpine/balham) | `themeQuartz`/`themeBalham`/`themeAlpine` as JS theme objects via `theme` prop | v33+ | Theme is a prop/object, not a CSS class `[CITED: ag-grid.com/theming]` |

**Deprecated/outdated (do NOT use):**
- AG Grid pre-v33 CSS-import theming as the primary path — legacy-only now (`theme="legacy"`).
- `next/dynamic` `{ssr:false}` from a Server Component — Next 16 requires the dynamic-import wrapper to itself be in a client boundary or used in a client file; place the `dynamic(...)` call in a `"use client"` module or import the grid via a client wrapper. Confirm exact placement in the spike. `[ASSUMED — Next 16 ssr:false placement nuance; verify in spike]`

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | AG Grid supports dotted nested `field` paths (`"fields.length"`, `"plan.region"`) for binding | Pattern 1 | LOW — flatten row fields to top-level keys instead; spike confirms |
| A2 | Exact tree-shaken Community module names (TextEditorModule, NumberEditorModule, DateEditorModule, SelectEditorModule, RenderApiModule) | AG Grid Setup | LOW — `AllCommunityModule` is the safe default; tree-shaking is an optimization, names confirmed in spike |
| A3 | `next/dynamic({ssr:false})` placement works cleanly from the actuals page in Next 16 | AG Grid Setup, State of the Art | MEDIUM — if Next 16 restricts `ssr:false` location, use a `"use client"` wrapper file for the dynamic call; spike resolves |
| A4 | Default themeQuartz coexists with Tailwind 4 preflight without visual breakage | Pitfall 3 | MEDIUM — escape hatch is `theme="legacy"` + scoped CSS, or container isolation; decide in spike |
| A5 | slopcheck verdict for ag-grid packages (tool unavailable this session) | Package Legitimacy Audit | LOW — cross-verified via STACK.md + CLAUDE.md + npm registry + official docs; install checkpoint covers residual risk |
| A6 | `quickFilterText` is acceptable for SFID search, or a dedicated SFID predicate in `doesExternalFilterPass` is preferred | Pattern 4 | LOW — both work; dedicated predicate avoids matching other columns |
| A7 | AG Grid `themeQuartz` default needs no license key for Community features | Stack | LOW — Community is MIT/free; only Enterprise modules need a key (STACK.md HIGH) |

**These map to the spike's job:** A1–A4 and A6 are exactly what the throwaway spike (D3-00) exists to confirm before committing to AG Grid. The spike's go/no-go should explicitly check them.

## Open Questions

1. **`ssr:false` placement in Next 16 App Router (A3).**
   - What we know: AG Grid must not SSR; `next/dynamic({ssr:false})` is the standard fix.
   - What's unclear: Next 16 has tightened where `ssr:false` may be declared (client vs server module).
   - Recommendation: resolve in the spike — put the `dynamic()` call in a `"use client"` loader file; if that errors, import the grid directly inside a client component guarded by a mounted-state check.

2. **Theming API vs Tailwind coexistence (A4).**
   - What we know: v33+ injects theme CSS into `<head>`; Tailwind 4 has aggressive preflight.
   - What's unclear: whether the two visually conflict in practice.
   - Recommendation: spike renders the grid on a real page with the app's Tailwind layout; if broken, switch to `theme="legacy"` + scoped import, or wrap the grid in a container that resets preflight.

3. **Cross-driver rowCount for the version check (Pitfall 6).**
   - What we know: PGlite and postgres-js report affected rows differently (the codebase already duck-types `.code` for FK errors).
   - What's unclear: exact shape of the update result on each driver.
   - Recommendation: write a `rowCountOf()` normalizer + a PGlite smoke that proves a stale-version update affects 0 rows. Do this in Wave 0 (it gates the whole save model).

4. **REQUIREMENTS.md GRID-04 wording (flagged by D3-05).**
   - What we know: D3-05 deliberately softens "derived cells are read-only" to "auto-filled + overridable + sticky."
   - Recommendation: planner should note this so the verifier doesn't flag the override behavior as a GRID-04 miss; optionally update GRID-04 text.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | install ag-grid, build | ✓ | Node 24.14.0 (local) | — |
| PGlite | dev DB + vitest | ✓ | 0.5.1 (installed) | — |
| ag-grid-community / ag-grid-react | the grid | ✗ (not yet installed) | target 35.3.1 (on npm) | TanStack Table 8.x (D3-00 documented fallback) |
| Playwright | grid e2e | ✓ | ^1.60.0 (installed) | — |
| vitest | calc/filter unit tests | ✓ | ^4.1.8 (installed) | — |
| slopcheck | package legitimacy check | ✗ (pip install failed) | — | cross-verify via STACK.md + npm + official docs + install checkpoint |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:**
- AG Grid (not installed) → install at Phase start; if the spike fails its go/no-go, fall back to TanStack Table per D3-00.
- slopcheck (unavailable) → compensated by multi-source verification + a `checkpoint:human-verify` on the install command.

## Testing Strategy

>  sets , so the formal Nyquist sampling-rate section is omitted. The requirement→test map below is retained as plain testing guidance for the planner — existing infra is strong (vitest unit + PGlite-isolated action tests + Playwright e2e + gated seed route), and these tests are how each GRID requirement is proven.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.8 (unit/contract, `lib/**`) + Playwright ^1.60.0 (e2e, `e2e/**`) |
| Config file | `vitest.config.ts` (include `lib/**/*.{test,spec}.{ts,tsx}`, `DATABASE_URL=memory://`); `playwright` config wipes `.pglite/` before `next dev` |
| Quick run command | `npm test` (vitest run) |
| Full suite command | `npm test && npm run e2e` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRID-04 | calc engine: counter-wall=entered, in-shop/gsb/nlb=L×B (height excluded), totalCost=sqft×perUnit, lineTotal=qty×rate | unit | `npm test -- lib/actuals/calc.test.ts` | ❌ Wave 0 |
| GRID-04 | sticky override: overridden cell ignores input changes; reset restores formula | unit | `npm test -- lib/actuals/calc.test.ts` | ❌ Wave 0 |
| GRID-03 | cascading filter option derivation (Region→State→District); SFID predicate | unit | `npm test -- lib/actuals/filter.test.ts` | ❌ Wave 0 |
| GRID-01/02 | colDef mapper: plan cols editable:false, actual cols editable, derived cols overridable | unit | `npm test -- lib/actuals/colDefs.test.ts` | ❌ Wave 0 |
| GRID-05 | row assembly: placeholder per zero-exec dealer; add-unit clones plan ctx | unit | `npm test -- lib/actuals/rows.test.ts` | ❌ Wave 0 |
| GRID-07 | saveExecutionsBatch: insert placeholders (v0), update with version bump, Zod reject, auth reject | unit (PGlite) | `npm test -- lib/actions/executions.test.ts` | ❌ Wave 0 |
| GRID-07 | **version conflict blocks one unit, others still save, no overwrite** (D3-11) | unit (PGlite) | `npm test -- lib/actions/executions.test.ts` | ❌ Wave 0 |
| GRID-07 | empty placeholder NOT persisted (D3-02) | unit (PGlite) | `npm test -- lib/actions/executions.test.ts` | ❌ Wave 0 |
| GRID-06 | savePopKit: kit execution + N execution_items in one tx; itemName snapshot; replace-all | unit (PGlite) | `npm test -- lib/actions/executions.test.ts` | ❌ Wave 0 |
| GRID-01/05/07 | e2e: open grid → edit cell → Save → reload shows persisted value | e2e | `npm run e2e -- e2e/actuals.spec.ts` | ❌ Wave 0 |
| GRID-07 | e2e: conflict path — stale version Save shows "reload this row", value not clobbered | e2e | `npm run e2e -- e2e/actuals.spec.ts` | ❌ Wave 0 |
| GRID-06 | e2e: POP modal adds 2 lines → kit total rolls up → persists | e2e | `npm run e2e -- e2e/actuals.spec.ts` | ❌ Wave 0 |

### Test Run Cadence
- **Per task commit:** `npm test -- <touched lib/actuals or lib/actions file>` (sub-second; pure modules + PGlite-memory)
- **Per wave merge:** `npm test` (full vitest sweep — currently 82/82 green pre-phase)
- **Phase gate:** `npm test && npm run e2e` green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `lib/actuals/calc.test.ts` — covers GRID-04 (formulas + sticky override) — pure, no DB
- [ ] `lib/actuals/filter.test.ts` — covers GRID-03 (cascading derivation) — pure
- [ ] `lib/actuals/colDefs.test.ts` — covers GRID-01/02 (mapper) — pure
- [ ] `lib/actuals/rows.test.ts` — covers GRID-05/D3-02 (row assembly + placeholders) — pure
- [ ] `lib/actions/executions.test.ts` — covers GRID-06/07 + version conflict + auth/Zod (mirror `plans.test.ts`: vi.mock next/headers, next/cache, ../auth/session; PGlite memory)
- [ ] `lib/db/__smoke__/executions.ts` — live PGlite smoke proving stale-version UPDATE affects 0 rows (gates Pitfall 6 / rowCountOf normalizer)
- [ ] `e2e/actuals.spec.ts` — edit→save→reload, conflict, POP modal; **extend the gated `/api/test/seed-execution` route** (or add a sibling) to seed multi-unit + a known version for the conflict test
- [ ] Extend `_seedExecutionForTest` / add `_findExecutionForTest` in `lib/db/plan-rows.ts` (or new `lib/db/executions.ts`) to return execution id+version for e2e conflict setup
- [ ] No framework install needed (vitest + Playwright present); only `npm install ag-grid-community@35.3.1 ag-grid-react@35.3.1`

## Security Domain

>  has no  key → treated as **enabled** (absent = enabled default). This phase writes user-supplied data behind the shared-password gate, so the section applies.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `requireSession()` at entry of `saveExecutionsBatch` (jose JWT cookie verify) — established `[CITED: lib/auth/session.ts]` |
| V3 Session Management | yes (inherited) | HttpOnly+Secure+SameSite signed cookie, 30-day sliding — unchanged this phase `[CITED: lib/auth/session.ts]` |
| V4 Access Control | yes | Defense-in-depth: action re-checks session (not middleware-only — CVE-2025-29927); off-plan write blocked structurally by FK |
| V5 Input Validation | yes | Zod re-validate every patch in the batch + lat/long/IDs stay text; numeric guarded by `Number.isFinite` (mirror `commitPlanUpload`) |
| V6 Cryptography | no | No new crypto in this phase (session crypto already exists) |

### Known Threat Patterns for Next 16 Server Actions + Postgres
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Lost-update / silent overwrite on shared login | Tampering | Per-unit optimistic concurrency (`WHERE version=?` + rowCount), block-not-overwrite (D3-11; PITFALLS Pitfall 4) |
| Off-plan spend injection (write execution for unplanned SFID) | Tampering / Elevation | Structural FK `executions.plan_row_id NOT NULL` — impossible regardless of client (COMP-01) |
| Middleware bypass (CVE-2025-29927) → unauth grid write | Spoofing / Elevation | `requireSession()` inside the Server Action; middleware is UX only `[CITED: PITFALLS Pitfall 10]` |
| Malicious client posts forged/oversized patch payload | Tampering / DoS | Zod schema on the batch (cap array length, validate types/enums); server re-runs calc, doesn't trust client totals |
| SQL injection via field values | Tampering | Drizzle parameterized queries throughout (no string SQL with user input) |
| Partial-write corruption mid-batch | Tampering | Single `db.transaction`; non-conflict failures roll back; conflicts collected per D3-11 |

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view`, 2026-06-05) — ag-grid-community 35.3.1, ag-grid-react 35.3.1, peerDeps `react ^19.0.0` confirmed. — **HIGH**
- AG Grid docs — Modules / ModuleRegistry (`ag-grid.com/react-data-grid/modules`); Theming + Theming Migration (v33+ themeQuartz default, legacy escape hatch, auto-inject) (`/theming`, `/theming-migration`); Change Detection + Value Setters (`/change-detection`, `/value-setters`); Cell Styles / cellClassRules (`/cell-styles`); External Filter (`/filter-external`); Getting Started (`/getting-started`). — **HIGH**
- Codebase (read directly this session): `lib/db/schema.ts`, `lib/db/plan-rows.ts`, `lib/db/items.ts`, `lib/db/index.ts`, `lib/activities/*` (types, registry, 6 configs), `lib/actions/{plans,periods,items}.ts`, `lib/auth/session.ts`, `lib/periods/active.ts`, `app/(app)/{layout,plans/page,plans/upload/upload-form,periods/period-form,items/item-form}.tsx`, `app/api/test/seed-execution/route.ts`, `lib/actions/plans.test.ts`, `e2e/plans.spec.ts`, `vitest.config.ts`, `package.json`. — **HIGH**
- Project research: `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`; `CLAUDE.md`; `03-CONTEXT.md`; `REQUIREMENTS.md`; `ROADMAP.md`. — **HIGH**

### Secondary (MEDIUM confidence)
- WebSearch consensus (multiple 2025 sources) — Next.js App Router `window is not defined` → `next/dynamic({ssr:false})` for browser-only widgets like AG Grid. — **MEDIUM (consensus, official Next docs corroborate dynamic-import pattern)**
- AG Grid v35 getting-started page mentions `AgGridProvider` as an alternative to `ModuleRegistry`; both register modules. `ModuleRegistry.registerModules` chosen as the documented stable pattern. — **MEDIUM**

### Tertiary (LOW confidence / verify in spike)
- Dotted nested `field` path support (A1); exact tree-shaken module names (A2); `ssr:false` placement nuance in Next 16 (A3); themeQuartz↔Tailwind4 visual coexistence (A4). All flagged in Assumptions Log; the spike (D3-00) is the verification vehicle.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — versions + React 19 peerDeps verified on npm this session; matches STACK.md HIGH.
- Architecture: **HIGH** — substrate read directly; patterns mirror proven Phase-1/2 code; AG Grid APIs confirmed against current docs.
- Pitfalls: **HIGH** — drawn from PITFALLS.md + codebase facts (numeric-as-string proven; cross-driver duck-typing precedent) + AG Grid docs; the few MEDIUM items (theming/SSR/rowCount) are explicitly the spike's job.
- Save-model / concurrency: **HIGH** — locked decisions (D3-10/11/12) + DB already has `version`; only the cross-driver rowCount normalizer is an open implementation detail (Pitfall 6 / Wave 0 smoke).

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (AG Grid is fast-moving on minor versions; pin 35.3.1. Re-verify if bumping the major. Stable for ~30 days.)
