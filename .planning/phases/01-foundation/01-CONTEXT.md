# Phase 1: Foundation - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

The load-bearing foundation every later write path depends on:

- **Shared-password gate** (ACCESS-01, ACCESS-02) — middleware-enforced signed-cookie session.
- **Typed activity registry** (ACTV-01, ACTV-02, ACTV-03) — all six activities as config; a 7th is a data change.
- **Period-scoped data model** (PRD-01, PRD-02) — create month/quarter/FY periods, mark one active, scope all data to a period.
- **Structural off-plan guard** (COMP-01) — `executions` cannot exist without a matching `plan_rows` row (NOT NULL FK + UNIQUE match key), independent of any app check.
- **Item master** (ACTV-04) — the managed picklist behind POP / dealer-kit.
- **Local-first runtime** (Success Criterion #6) — runs fully on PGlite with no cloud dependency; Supabase is a `DATABASE_URL` swap.

Out of scope here: plan upload (Phase 2), the editable grid (Phase 3), dashboards (Phase 4), export (Phase 5). This phase only builds the schema, registry, auth gate, and the structures those phases write into.

</domain>

<decisions>
## Implementation Decisions

### Execution Grain & Off-Plan Guard *(discussed)*
- **D-01:** Plan-row removal policy is **`ON DELETE RESTRICT`**. The database refuses to delete a `plan_rows` row that has any child executions. This protects recorded spend and makes Phase 2's non-destructive re-upload (PLAN-06) a *structural* guarantee, not app logic that can be bypassed.
- **D-02:** Match key is **`UNIQUE (period_id, activity, sfid)`** on `plan_rows` — exactly one plan row per dealer per activity per period. A repeated SFID in an uploaded plan is flagged as a **duplicate** (PLAN-03), never silently merged.
- **D-03:** Multi-unit executions are stored **one-to-many**: `executions` is a child table of `plan_rows` (`plan_row_id bigint NOT NULL REFERENCES plan_rows(id) ON DELETE RESTRICT`), **one row per physical unit** (wall/board), each carrying its own measurements, cost, status, location, and date. A dealer's total rolls up via `SUM` over child rows. **This drops the architecture-draft's `UNIQUE(plan_row_id)`** ("one execution per plan row"), which contradicted the confirmed multi-unit grain.
- **D-04:** The optimistic-concurrency **version column lives on each execution row** (per-unit). Two people editing different units of the same dealer never collide; the version check guards a single unit.
- **D-05:** Money is Postgres **`numeric` (rupees, 2dp) — never float** (locked by PROJECT.md; bigint-paise alternative explicitly *not* chosen). Per-unit cost and the planned/budget cost are numeric columns. Derived totals (sq ft, total cost) are **computed in the app layer and persisted to plain numeric columns** — NOT Postgres generated columns (see PITFALLS canonical ref: the `jsonb→numeric` cast is non-immutable and crashes on dirty Excel input).

### Item Master *(discussed)*
- **D-06:** **One global item list** (not per-activity), with an optional **category** tag for grouping. Only POP/Dealer-Kit (the single `item-list` activity) consumes it today; a future item-based activity reuses the same list.
- **D-07:** Items carry **name only** — no rate or unit on the master. The per-unit rate is entered fresh on each POP line item (rates vary per execution).
- **D-08:** Recorded POP line items **snapshot the item name** at entry time. Renaming a master item affects only new entries; historical spend reads exactly as recorded (consistent with D-01 protect-recorded-spend).
- **D-09:** Items have an **`active` flag** to retire them from the picker; no hard delete required (snapshots keep history intact). *(Default within this area.)*

### Periods *(recorded default — area skipped)*
- **D-10:** A period = a **type enum (`month` | `quarter` | `fy`)** + a human label + explicit **`start_date` and `end_date`**. Indian FY (Apr–Mar) is encoded by the dates, not inferred.
- **D-11:** **Exactly one period is `active`** (the default scope on login). A **period switcher** in the app shell selects any existing period; every plan/actual/dashboard/export query filters on the selected `period_id`. Period scoping is a **column (`period_id`)**, not separate tables or schemas.

### Auth & Session *(recorded default — area set aside)*
- **D-12:** Single shared password in an **env var** (e.g. `APP_PASSWORD`), verified in **Edge middleware** that gates every route except `/login` and static assets; on success sets a **`jose`-signed `httpOnly`, `secure`, `sameSite=lax` cookie** (locked by PROJECT.md).
- **D-13:** Session lifetime = **30-day sliding** — **this value is a recorded DEFAULT, not a user decision** (user set this detail aside as "not required"). A visible **Logout** clears the cookie; wrong password → inline error, no lockout (small trusted team). Planner may adjust the lifetime freely.

### Local-First Runtime *(locked by PROJECT.md / ROADMAP)*
- **D-14:** The app runs **fully locally against PGlite** (embedded Postgres, zero install) behind a single `DATABASE_URL`. Deploying to Supabase is a config swap to the **pooled / transaction-mode** connection string — no code change. Drizzle keeps the schema identical across both. (Success Criterion #6: no cloud dependency to run locally.)

### Activity Registry *(locked by architecture; shape note for planner)*
- **D-15:** Six activities are typed config in **`lib/activities/`**, deliberately **framework- and dependency-free** so it imports cleanly on both client and server. Each `ActivityConfig` declares `type` (`measurement` | `item-list` | `status`), `planColumns`, and `actualColumns` (`FieldDef`: `key` / `label` / `kind` / `shared?` / `required?` / `enumValues?` / `computeFrom?`). The grid, filters, importer, and exporter all read this one registry. A 7th activity = one registry entry (ACTV-03). **Column specs already enumerated in PROJECT.md — use them verbatim.**

### Claude's Discretion
- Exact Drizzle schema, column types, index definitions, migration file layout, and middleware code structure (planner/researcher decide, grounded in the canonical refs).
- The precise computed-total formula per activity (e.g. Counter Wall uses entered Actual Sq Ft; GSB/NLB and In-shop derive from L×B(×H)) — derive from PROJECT.md's per-activity column specs.
- Whether "active period" is an `is_active` boolean on `periods` vs a single-row current-period pointer.
- Session-lifetime value (user deprioritized; 30-day sliding assumed).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Architecture & Schema (read before designing the data model)
- `.planning/research/ARCHITECTURE.md` — Canonical system design: hybrid schema (shared indexed columns + `jsonb` tail), structural off-plan FK guard, config-driven activity registry, recommended project structure, dependency-driven build order. **⚠ SUPERSEDED DETAILS:** its `executions` example shows `UNIQUE(plan_row_id)` and `ON DELETE CASCADE` — **both overridden here by D-01 (RESTRICT) and D-03 (one-to-many, no unique on plan_row_id).** Use this CONTEXT's decisions where they conflict.
- `.planning/research/PITFALLS.md` — Critical traps to design around: the `jsonb→numeric` **generated-column immutability** trap (compute totals app-side → persist to plain numeric, per D-05), SFID/date/rupee Excel handling, serverless connection pooling.
- `.planning/research/STACK.md` — Pinned versions + installation specifics: **SheetJS from the CDN tarball, not npm**; Drizzle ORM + PGlite (local) / Supabase pooled (prod); AG Grid Community; `jose` for the cookie.

### Requirements & Scope
- `.planning/REQUIREMENTS.md` — Phase 1 requirements: ACCESS-01/02, ACTV-01..04, PRD-01/02, COMP-01 (and the downstream PLAN-06 / COMP-02 that D-01 structurally enables).
- `.planning/ROADMAP.md` §"Phase 1: Foundation" — Goal, success criteria 1–6, and the discuss-step schema questions this CONTEXT resolves.
- `.planning/PROJECT.md` — Locked stack & Key Decisions; **the per-activity plan/actual column specs** (Counter Wall Painting, GSB/NLB, In-shop Branding, POP/Dealer Kit, Dealer Certificate) — the source for the registry's `planColumns`/`actualColumns`; hybrid-schema + off-plan + compliance model.

### Supporting research
- `.planning/research/FEATURES.md` — Table-stakes vs anti-features (scope guard).
- `.planning/research/SUMMARY.md` — Research synthesis / reconciled conflicts.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **None yet (greenfield).** This phase *creates* the foundation — registry, schema, migrations, auth — that every later phase reuses. Only `.planning/` and `CLAUDE.md` exist; no `app/`, `lib/`, or `package.json` yet.

### Established Patterns
- Project structure proposed in `ARCHITECTURE.md`: `lib/activities/` (registry), `lib/db/` (typed queries, no business rules), `lib/actions/` (Server Actions), `lib/auth/` (cookie sign/verify), `middleware.ts` (cookie gate), `db/migrations/` (SQL). Follow it.

### Integration Points
- **`lib/activities/` registry** is the spine read by all later subsystems — keep it framework/dep-free.
- **`executions` → `plan_rows` FK** is the structural off-plan boundary (D-01/D-03).
- **`DATABASE_URL`** is the *only* seam between local PGlite and cloud Supabase (D-14).

</code_context>

<specifics>
## Specific Ideas

- **Per-activity column specs are already written in `PROJECT.md`** (Context → "Activity column specs") — use them verbatim as the registry source; don't re-derive.
- **POP / Dealer-Kit shape:** a parent `executions` row + `execution_items` child rows (each: item-name *snapshot*, qty, per-unit rate, line total, per D-07/D-08); the parent total is computed app-side from the children.
- **Dealer Certificate** is a `status`-type activity (issuance status + date + cost), not a measurement — registry `type: 'status'`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within Phase 1 scope. The Period model and the Login *session-length* detail were set aside by the user during this session; they are **recorded as working defaults (D-10..D-13)**, not deferred to a later phase. Revisit by editing this file before planning if desired.

</deferred>

---

*Phase: 1-Foundation*
*Context gathered: 2026-06-04*
