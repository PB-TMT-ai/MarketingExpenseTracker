# Architecture Research

**Domain:** Config-driven multi-activity plan-vs-actual tracker (Next.js App Router + Postgres, internal tool)
**Researched:** 2026-06-04
**Confidence:** HIGH (core stack verified against Next.js, PostgreSQL, SheetJS, and Vercel official docs; one important pitfall — jsonb→numeric in generated columns — verified and resolved)

## Standard Architecture

The central architectural idea is a **single Activity Registry** (one typed config module) that every other subsystem reads from. The grid, the filter bar, the Excel importer, the Excel exporter, and the jsonb validation all derive their behavior from the same config object. "Adding a 7th activity" means appending one entry to that registry — no new routes, no new tables, no new components.

The off-plan guard is **structural, not procedural**: it is a `NOT NULL` foreign key from `executions.plan_row_id → plan_rows.id`. There is no code path that can write an execution without a matching plan row, because the database rejects it. App-layer validation exists only to produce friendly error messages *before* the insert; the FK is the real enforcement.

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (Client Components)                                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────┐  │
│  │ Filter Bar │  │ Editable   │  │ Excel      │  │ POP Multi-Item │  │
│  │ (region/   │  │ Data Grid  │  │ Upload +   │  │ Popup          │  │
│  │  state/…)  │  │ (Glide)    │  │ Preview    │  │ (qty × rate)   │  │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └───────┬────────┘  │
│        │ all four read column defs from ───────────────────────┐     │
│        └───────────────┴───────────────┴─────────────┴─────────┘     │
│                        ▼                                              │
│        ┌───────────────────────────────────────┐                     │
│        │   ACTIVITY REGISTRY (shared module,    │ ◄── imported by     │
│        │   runs on client AND server)           │     client & server │
│        └───────────────────────────────────────┘                     │
├──────────────────────────────────────────────────────────────────────┤
│  EDGE: middleware.ts → checks signed cookie → else redirect /login    │
├──────────────────────────────────────────────────────────────────────┤
│  SERVER (Next.js App Router on Vercel)                                 │
│  ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐  │
│  │ Server Actions   │  │ Server Actions   │  │ Route Handler      │  │
│  │ commitImport()   │  │ saveCells()      │  │ GET /export        │  │
│  │ validatePlan…()  │  │ getRows()        │  │ (streams .xlsx)    │  │
│  └────────┬─────────┘  └────────┬─────────┘  └─────────┬──────────┘  │
│           │                     │                       │             │
│  ┌────────┴─────────────────────┴───────────────────────┴─────────┐  │
│  │  DATA-ACCESS LAYER (db/*.ts) — typed queries, no business logic │  │
│  │  buildFilteredQuery(activity, period, filters) → SQL            │  │
│  └────────────────────────────────────────┬───────────────────────┘  │
├────────────────────────────────────────────┼─────────────────────────┤
│  POSTGRES (Supabase / Neon)                 ▼                          │
│  ┌────────────┐  ┌──────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │ periods    │  │ plan_rows    │◄─┤ executions  │◄─┤ execution_  │  │
│  │            │  │ (shared cols │FK│ (FK→plan_row│FK│ items (POP) │  │
│  │            │  │  + jsonb)    │  │  +jsonb)    │  │             │  │
│  └────────────┘  └──────────────┘  └─────────────┘  └─────────────┘  │
│                  ┌──────────────┐                                     │
│                  │ item_master  │ (managed POP item list)            │
│                  └──────────────┘                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| **Activity Registry** | Single source of truth: per-activity plan columns, actual columns, type (`measurement`/`item-list`/`status`), field validation, computed-field formulas, Excel header names. Drives grid, filters, import, export. | Typed TS module (`lib/activities/`), one object per activity + a `Record<ActivityKey, ActivityConfig>`. Zero runtime deps so it imports on both client and server. |
| **Filter Bar** | Region/State/District/Distributor/Status dropdowns; emits a filter object. Options come from `DISTINCT` on indexed columns for the active period. | Client component; reads which filters apply from registry (all activities share who/where). |
| **Editable Data Grid** | Spreadsheet-feel display + inline edit of actuals. Columns built dynamically from `config.actualColumns`. Dirty cells batched and flushed via server action. | Glide Data Grid (built-in virtualization + editing). |
| **Excel Importer** | Parse `.xlsx` → validate header row against `config.planColumns` → match SFID within period → show preview (matched / off-plan / new) → commit. | Client-side parse (SheetJS) → POST validated JSON to `commitImport` server action. |
| **Excel Exporter** | Take current filter state → run same query as grid → emit `.xlsx` with columns ordered per registry. | Route handler streaming a Buffer (`Content-Disposition: attachment`). |
| **POP Multi-Item Popup** | For `item-list` activities, edit child line items (item from `item_master`, qty, rate, computed total). | Client modal; writes to `execution_items`. |
| **Server Actions** | Mutations: commit import, save grid cells, create period. Validation + DB writes. | `"use server"` functions colocated under route or in `lib/actions/`. |
| **Data-Access Layer** | Builds parameterized SQL (filtered, period-scoped); no business rules. | `lib/db/*.ts` over `postgres`/`pg` (or Drizzle). |
| **Auth Middleware** | Gate every route on a signed cookie; redirect to `/login` otherwise. | `middleware.ts` reading an HMAC-signed cookie; password in env var. |

## Recommended Project Structure

```
app/
├── (auth)/
│   └── login/page.tsx          # password form → sets signed cookie
├── (app)/                      # protected group (middleware covers all)
│   ├── layout.tsx              # shell: period switcher + nav
│   ├── dashboard/page.tsx      # % executed, counts, spend by activity/region
│   ├── [activity]/             # ONE dynamic route serves all 6 activities
│   │   └── page.tsx            # grid + filter bar for config[params.activity]
│   └── import/page.tsx         # upload → preview → commit wizard
├── api/
│   └── export/route.ts         # GET → streams filtered .xlsx
└── layout.tsx
lib/
├── activities/                 # ◄── THE REGISTRY (heart of the system)
│   ├── types.ts                # ActivityConfig, FieldDef, ActivityType
│   ├── counter-wall.ts         # measurement (sq ft from dimensions)
│   ├── gsb-nlb.ts              # measurement (L×B×H)
│   ├── inshop.ts               # measurement (L×B)
│   ├── pop-dealer-kit.ts       # item-list (child rows)
│   ├── dealer-certificate.ts   # status
│   └── index.ts                # ACTIVITIES: Record<ActivityKey, ActivityConfig>
├── db/
│   ├── client.ts               # pooled connection
│   ├── plan-rows.ts            # query/insert plan rows + filter builder
│   ├── executions.ts           # upsert actuals (off-plan caught by FK)
│   └── aggregates.ts           # dashboard rollups
├── actions/
│   ├── import.ts               # "use server" validatePlan, commitImport
│   ├── grid.ts                 # "use server" saveCells
│   └── periods.ts
├── excel/
│   ├── parse.ts                # SheetJS read → header:1 validation
│   └── build.ts                # rows → workbook
├── auth/
│   └── cookie.ts               # sign/verify
└── compliance/
    └── completeness.ts         # % executed math (shared client/server)
middleware.ts                   # cookie gate
db/migrations/                  # SQL: periods, plan_rows, executions, items, item_master
```

### Structure Rationale

- **`lib/activities/` is deliberately framework-free and dependency-free.** It must import cleanly into both a Client Component (grid columns, filter config) and a Server Action (import validation, export ordering). Keep React, DB drivers, and Node APIs out of it — only types and plain data.
- **One dynamic `[activity]` route, not six pages.** The page reads `ACTIVITIES[params.activity]` and renders the generic grid. This is the route-level expression of "config not code" — a 7th activity needs a registry entry, nothing in `app/`.
- **`lib/db/` holds no business rules.** It builds period-scoped, parameterized SQL and returns rows. Rules (off-plan, completeness) live in the DB (FK) and `lib/compliance/` respectively.
- **`lib/excel/` is isolated** so the `xlsx` dependency is easy to keep client-only (smaller server bundle) and the parse/build logic is unit-testable without HTTP.

## Architectural Patterns

### Pattern 1: Config-Driven Activity Registry (Open/Closed)

**What:** Every activity is one typed object describing plan columns, actual columns, type, per-field validation, computed fields, and Excel header labels. All UI and I/O are generic functions of that object.
**When to use:** When you have N variants of the same workflow that differ only in their column set — exactly this domain (6 activities, soon more).
**Trade-offs:** (+) New activity = data change; uniform behavior; single place to reason about a column. (−) The generic grid/importer must handle the union of all field kinds; an activity needing genuinely novel UI escapes the pattern. For this scope the field kinds are bounded (text, number, date, enum/status, lat-long, computed, child-list), so the ceiling is comfortable.

**Example:**
```typescript
// lib/activities/types.ts
type FieldKind = 'text' | 'number' | 'date' | 'enum' | 'latlong' | 'computed';

interface FieldDef {
  key: string;            // jsonb key OR shared-column name
  label: string;          // grid header + Excel header to match on import
  kind: FieldKind;
  shared?: boolean;       // true = real indexed column, false/undefined = jsonb
  required?: boolean;
  enumValues?: string[];  // for status
  computeFrom?: string[]; // e.g. ['length','breadth','height'] for sq ft
}

interface ActivityConfig {
  key: string;            // 'counter-wall' (route param + DB discriminator)
  label: string;
  type: 'measurement' | 'item-list' | 'status';
  planColumns: FieldDef[];
  actualColumns: FieldDef[];
}

// lib/activities/index.ts
export const ACTIVITIES: Record<string, ActivityConfig> = {
  'counter-wall': counterWall, 'gsb': gsb, /* … */
};
```
Grid columns: `config.actualColumns.map(toGridColumn)`. Import header check: compare sheet header row to `config.planColumns.map(c => c.label)`. Export order: same array. One array, four consumers.

### Pattern 2: Hybrid Schema — Shared Indexed Columns + jsonb Tail

**What:** The who/where columns every activity shares (region, state, district, distributor, SFID, dealer, status) are real typed columns with B-tree indexes. The activity-specific measurement fields live in a `jsonb` column on the same row.
**When to use:** When a fixed common set needs fast filtering/sorting but the variable tail differs per type and you want to avoid a migration per activity.
**Trade-offs:** (+) Instant filter dropdowns and `WHERE region = $1` at scale; no schema churn for new activities. (−) jsonb fields are weakly typed — validation must be enforced in the app (against the registry) on write, since Postgres won't. Querying *inside* jsonb is slower than a real column, so anything filtered/aggregated must be promoted to shared (see Pitfall on computed columns).

**Example:**
```sql
CREATE TABLE plan_rows (
  id          bigserial PRIMARY KEY,
  period_id   bigint NOT NULL REFERENCES periods(id),
  activity    text   NOT NULL,                 -- registry key
  sfid        text   NOT NULL,
  region      text, state text, district text, distributor text, dealer text,
  fields      jsonb  NOT NULL DEFAULT '{}',    -- plan-side activity extras
  UNIQUE (period_id, activity, sfid)           -- the import match key
);
CREATE INDEX ON plan_rows (period_id, activity, region, state, district);
```

### Pattern 3: Structural Off-Plan Guard via FK

**What:** An execution cannot exist without a parent plan row. The guarantee is a `NOT NULL REFERENCES`, not an `if`-check.
**When to use:** Whenever "child may only reference an approved parent" is a hard business invariant. Putting it in the schema makes it impossible to bypass via a forgotten code path, a bulk import, or a future endpoint.
**Trade-offs:** (+) Bulletproof; the rule holds even if app code is wrong. (−) Bulk import must resolve SFID→`plan_row_id` *before* insert and split rows into "matched" vs "off-plan" for the preview. The app does the friendly rejection; the FK is the backstop.

**Example:**
```sql
CREATE TABLE executions (
  id          bigserial PRIMARY KEY,
  plan_row_id bigint NOT NULL REFERENCES plan_rows(id) ON DELETE CASCADE,
  status      text,
  fields      jsonb NOT NULL DEFAULT '{}',     -- measurements, costs, lat/long
  total_cost  numeric,                          -- promoted for dashboard sums
  UNIQUE (plan_row_id)                          -- one execution per plan row
);
```
Import resolution: `SELECT id, sfid FROM plan_rows WHERE period_id=$1 AND activity=$2` → build `Map<sfid, planRowId>` → rows missing a hit are flagged **off-plan** in the preview and never inserted.

### Pattern 4: Client-Parse → Server-Commit for Excel Import

**What:** SheetJS parses the `.xlsx` in the browser. The header row is validated against the registry there for instant feedback. Only the validated, structured JSON is POSTed to the `commitImport` server action.
**When to use:** Internal tool, modest files (hundreds of rows), single-app deploy on Vercel.
**Trade-offs:** (+) Sidesteps Vercel's **4.5 MB request-body limit** (you send compact JSON, not the raw file) and keeps the heavy `xlsx` bundle off the server function. Header validation is instant. (−) Parsing logic ships to the client. Mitigation: server action still re-validates against the registry and the DB before insert — never trust the client. If files ever grow past a few thousand rows, switch to direct-to-storage upload + background parse.

**Example:**
```typescript
// client: extract + validate the header row first
const wb = XLSX.read(await file.arrayBuffer());
const aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
const headers = aoa[0] as string[];               // raw header row
const expected = config.planColumns.map(c => c.label);
// diff headers vs expected → block on mismatch, then map remaining rows → JSON
```

## Data Flow

### Request Flow (the five core flows)

```
1. PLAN UPLOAD
   pick .xlsx → [client] SheetJS parse → validate header vs config.planColumns
       → match SFID within period → PREVIEW (matched / off-plan / new)
       → confirm → commitImport() server action → INSERT plan_rows (+ FK now armed)

2. FILL ACTUALS
   open /[activity] → getRows(activity, period, filters) → grid renders
       → edit cell → batch dirty cells → saveCells() server action
       → resolve SFID→plan_row_id → UPSERT executions (FK enforces on-plan)

3. POP LINE ITEMS
   open popup → pick item from item_master → qty × rate
       → save → INSERT/UPDATE execution_items → parent total recomputed

4. DASHBOARD
   load → aggregates.ts → GROUP BY activity, region over period
       → % executed = executed_count / planned_count ; SUM(total_cost)

5. EXPORT
   GET /api/export?activity&period&filters → same buildFilteredQuery
       → rows → SheetJS build (column order from config) → stream .xlsx
```

### Key Data Flows

1. **Registry → everything (the spine):** `ACTIVITIES[key]` is read by the grid (columns), filter bar (which filters), importer (header validation + match key), exporter (column order). Change the config, all four change together. This is the mechanism that makes the system config-driven rather than code-driven.
2. **SFID + period → off-plan decision:** The pair `(period_id, activity, sfid)` is the universal join key. Import resolves it to `plan_row_id`; a miss = off-plan rejection in the UI and an impossible insert at the FK.
3. **Period scoping is a column, not a database:** Every `plan_rows` row carries `period_id`; every query filters on it; the grid/dashboard/export all receive the active period from the layout's period switcher. Periods never bleed because the `UNIQUE (period_id, activity, sfid)` constraint and the `WHERE period_id = $1` predicate keep them isolated — no per-period tables or schemas needed.

## Scaling Considerations

This is an internal tool for a small core team. The realistic data volume is thousands of plan rows per period, not millions; the realistic concurrency is single-digit users. Most "scale" advice does not apply — the risk is over-engineering, not under-provisioning.

| Scale | Architecture Adjustments |
|-------|--------------------------|
| This project (≤ ~10 users, ≤ ~10k rows/period) | Monolith Next.js on Vercel + single Postgres. No caching layer, no queue, no read replica. Indexes on the shared filter columns are enough. |
| If rows/period reach ~100k | Server-side pagination/virtualized fetch for the grid (don't ship all rows); ensure every filter hits the composite index; consider a covering index for the dashboard rollup. |
| If files exceed a few thousand rows | Move import off the 4.5 MB client→action path: upload to Supabase/Blob storage, parse in a background function, write results. |

### Scaling Priorities

1. **First bottleneck — grid initial load.** Sending an entire period's rows to the browser at once. Fix: server-side filtered fetch + Glide's virtualization; load the active filter's slice, not the table.
2. **Second bottleneck — jsonb in WHERE/aggregate.** Filtering or summing on a value still inside `jsonb` is slow. Fix: promote any filtered/aggregated field to a real (optionally generated) column with an index; keep jsonb for display-only fields.

## Anti-Patterns

### Anti-Pattern 1: Computing sq ft / totals in a Postgres generated column off jsonb

**What people do:** `total_sqft numeric GENERATED ALWAYS AS ((fields->>'length')::numeric * (fields->>'breadth')::numeric) STORED`.
**Why it's wrong:** `jsonb ->> 'x'` is immutable, but the **`::numeric` cast is not immutable** in Postgres, so the generated-column definition is rejected (`generation expression is not immutable`). Even wrapped in a custom `IMMUTABLE` SQL function, malformed input (`"abc"`, empty string from a sloppy Excel cell) throws on **write**, blocking the whole row insert/commit — brittle for hand-entered data.
**Do this instead:** Compute sq ft and totals in the **app layer** (`lib/compliance/` shared by client and server) and persist the result into a plain `total_sqft` / `total_cost` numeric column. You get the dashboard-friendly indexed numeric without the immutability trap or the write-time crash on dirty data. Reserve generated columns for trivially-immutable promotions (e.g. surfacing a jsonb **text** value as a typed column for filtering), not arithmetic over user-entered measurements.

### Anti-Pattern 2: One page (or one table) per activity

**What people do:** `app/counter-wall/page.tsx`, `app/gsb/page.tsx`, … and/or `counter_wall_rows`, `gsb_rows` tables.
**Why it's wrong:** It defeats the entire config-driven goal. A 7th activity becomes a code change (new route, new component, new table, new migration), and every cross-activity feature (dashboard, export, filters) must be re-implemented N times.
**Do this instead:** One `[activity]` dynamic route + one generic grid reading the registry; one `plan_rows`/`executions` pair discriminated by an `activity` column. New activity = registry entry.

### Anti-Pattern 3: Enforcing the off-plan guard only in application code

**What people do:** `if (!planRowExists) throw` in the import handler, with a nullable/absent FK.
**Why it's wrong:** The invariant ("spend only against planned SFIDs") then lives in one code path. A future bulk endpoint, a manual fix, or a refactor can silently bypass it, and the core promise of the product quietly breaks.
**Do this instead:** `executions.plan_row_id NOT NULL REFERENCES plan_rows(id)`. The DB is the enforcer; app checks exist only to render a nice off-plan list in the preview.

### Anti-Pattern 4: Exposing internal mutations as public REST route handlers

**What people do:** Build `POST /api/executions`, `POST /api/import` route handlers and call them with `fetch` from the client.
**Why it's wrong:** Adds an HTTP layer, manual (de)serialization, and a public surface the cookie-gate must separately defend — for an internal single-app tool that has no external API consumers. Vercel's own guidance: default to Server Actions for internal mutations, reserve route handlers for webhooks/external callers/cacheable GETs.
**Do this instead:** Server Actions for all mutations (import commit, cell save, period create). Use a **route handler only for `GET /api/export`**, because streaming a file download with `Content-Disposition` is precisely the HTTP-control case route handlers are for.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Supabase / Neon Postgres | Pooled connection from server actions / data layer; 1-click Vercel env wiring | Use a **pooled** connection string (PgBouncer/Neon pooler) — serverless functions open many short-lived connections; direct connections exhaust limits. |
| Vercel | Single-app deploy; password in env var | Body limit **4.5 MB** per function request → client-parse import. Set `maxDuration` on the export route if large exports approach the timeout. |
| Salesforce | None in v1 — SFID is a plain string key | No API sync; SFID is the match/join value only (per project Out of Scope). |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Registry ↔ Grid / Filters / Import / Export | Direct typed import (plain data module) | Must stay framework/dep-free so it loads on client and server alike. |
| Client components ↔ Server | Server Actions (mutations) + initial Server Component fetch (reads) | No bespoke `/api` for internal CRUD. |
| Server Actions ↔ Postgres | Via `lib/db/` data layer only | Actions hold validation/orchestration; data layer holds SQL. Keep business rules out of `lib/db/`. |
| `executions` ↔ `plan_rows` | FK (`plan_row_id NOT NULL`) | The structural off-plan guard. |
| `execution_items` ↔ `executions` | FK + `ON DELETE CASCADE` | POP child rows; parent total computed app-side from children. |

## Suggested Build Order

Dependencies dictate the order. Each phase produces something runnable and unblocks the next.

1. **Foundation: Registry + Schema + Auth.** Define `ActivityConfig` and all six activity configs; write migrations for `periods`, `plan_rows`, `executions`, `execution_items`, `item_master` (FK and unique constraints in from day one — the off-plan guard is structural and must precede any write path); add the cookie middleware. *Unblocks everything; nothing reads correctly without the registry, and the FK must exist before import.*
2. **Plan Upload + Period scoping.** Client parse → header validation against registry → SFID match within period → preview (matched/off-plan/new) → `commitImport`. *Populates `plan_rows`, which every later flow depends on; proves the registry-driven import and the period model.*
3. **Editable Grid + Filters.** Generic Glide grid from `config.actualColumns`; filter bar from shared columns; `saveCells` upsert into `executions` (FK now enforces on-plan); POP multi-item popup for `item-list`. *Requires plan rows to edit against; this is the daily-use core.*
4. **Compliance + Dashboard.** App-layer computed totals (sq ft, cost) persisted to numeric columns; aggregation queries for % executed, counts, spend by activity/region. *Requires actuals to aggregate; delivers the headline compliance metric.*
5. **Excel Export.** `GET /api/export` route handler reusing `buildFilteredQuery`, column order from registry, streamed `.xlsx`. *Last because it reuses the grid's query and the registry's column order — both must exist first.*

The ordering is strictly dependency-driven: registry/schema underpins all; plan rows must exist before actuals; actuals must exist before aggregation; the export reuses query + registry built earlier.

## Sources

- Next.js — Mutating Data (Server Actions) — https://nextjs.org/docs/app/getting-started/mutating-data (HIGH)
- Next.js — Route Handlers — https://nextjs.org/docs/app/getting-started/route-handlers (HIGH)
- "Server Actions vs Route Handlers: When to Use Each" — https://makerkit.dev/blog/tutorials/server-actions-vs-route-handlers (MEDIUM; corroborates default-to-actions, route-handlers-for-external/cacheable)
- PostgreSQL — Generated Columns (immutability requirement) — https://www.postgresql.org/docs/current/ddl-generated-columns.html (HIGH)
- "Making JSONB More Queryable with Generated Columns" — https://richyen.com/postgres/2026/05/11/generated_columns_jsonb.html (MEDIUM; jsonb→typed promotion + B-tree vs GIN)
- PostgreSQL mailing list — jsonb→numeric cast immutability / IMMUTABLE wrapper workaround — https://www.postgresql.org/message-id/af9cb89f-390e-9dce-74cf-f50371116847@postgrespro.ru (HIGH; confirms the cast pitfall)
- SheetJS — Reading Files / parse options (`read` from Buffer/ArrayBuffer; ESM uses `fs.readFileSync`) — https://docs.sheetjs.com/docs/api/parse-options/ (HIGH)
- SheetJS — `sheet_to_json` `header:1` raw-row extraction + duplicate-header disambiguation — https://docs.sheetjs.com/docs/api/utilities/array/ (HIGH)
- SheetJS — Next.js demo — https://docs.sheetjs.com/docs/demos/static/nextjs/ (HIGH)
- Vercel — Functions Limitations (4.5 MB body limit, `maxDuration`) — https://vercel.com/docs/functions/limitations (HIGH)
- Glide Data Grid (virtualization + built-in editing, scales to millions of rows) — https://github.com/glideapps/glide-data-grid (MEDIUM)
- "TanStack Table vs AG Grid vs react-data-grid 2026" (TanStack needs external virtualization + custom edit) — https://www.pkgpulse.com/guides/tanstack-table-vs-ag-grid-vs-react-data-grid-2026 (MEDIUM)

---
*Architecture research for: config-driven multi-activity plan-vs-actual tracker (Next.js + Postgres)*
*Researched: 2026-06-04*
