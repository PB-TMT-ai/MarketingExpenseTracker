# Phase 1: Foundation - Research

**Researched:** 2026-06-04
**Domain:** Local-first Next.js 16 foundation — PGlite↔Supabase portable Drizzle schema, structural off-plan FK guard, typed activity registry, Node-runtime shared-password gate
**Confidence:** HIGH (all versions verified against npm 2026-06-04; PGlite/Drizzle/Next-16 wiring verified against official docs; one major staleness in prior research found and corrected — see "State of the Art")

> **Scope of THIS research.** Substantial stack/architecture/pitfalls research already exists in `.planning/research/` and is NOT re-derived here. This document narrows to the five Phase-1 implementation specifics those docs left open (PGlite↔Supabase dual-driver, `proxy.ts` auth, the off-plan Drizzle schema, the typed registry shape, Next 16 scaffold) and flags what in the existing research is now stale. Read it **alongside** ARCHITECTURE.md / STACK.md / PITFALLS.md, not instead of them.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Plan-row removal policy is **`ON DELETE RESTRICT`**. The DB refuses to delete a `plan_rows` row that has any child executions. Makes Phase-2 non-destructive re-upload (PLAN-06) a *structural* guarantee.
- **D-02:** Match key is **`UNIQUE (period_id, activity, sfid)`** on `plan_rows` — exactly one plan row per dealer per activity per period. A repeated SFID in an upload is flagged **duplicate** (PLAN-03), never silently merged.
- **D-03:** Multi-unit executions are stored **one-to-many**: `executions` is a child of `plan_rows` (`plan_row_id bigint NOT NULL REFERENCES plan_rows(id) ON DELETE RESTRICT`), **one row per physical unit** (wall/board), each carrying its own measurements, cost, status, location, date. Dealer total rolls up via `SUM`. **Drops the architecture-draft's `UNIQUE(plan_row_id)`.**
- **D-04:** Optimistic-concurrency **version column lives on each execution row** (per-unit).
- **D-05:** Money is Postgres **`numeric` (rupees, 2dp) — never float**. Per-unit cost and planned/budget cost are numeric columns. Derived totals (sq ft, total cost) are **computed in the app layer and persisted to plain numeric columns** — NOT Postgres generated columns (the `jsonb→numeric` cast is non-immutable and crashes on dirty Excel input).
- **D-06:** **One global item list** (not per-activity), with an optional **category** tag. Only POP/Dealer-Kit consumes it today.
- **D-07:** Items carry **name only** — no rate or unit on the master. Per-unit rate is entered fresh on each POP line.
- **D-08:** Recorded POP line items **snapshot the item name** at entry time. Renaming a master item affects only new entries.
- **D-09:** Items have an **`active` flag** to retire them from the picker; no hard delete.
- **D-10:** A period = a **type enum (`month` | `quarter` | `fy`)** + a human label + explicit **`start_date` and `end_date`**. Indian FY (Apr–Mar) is encoded by the dates, not inferred.
- **D-11:** **Exactly one period is `active`** (default scope on login). A **period switcher** selects any existing period; every query filters on the selected `period_id`. Period scoping is a **column (`period_id`)**, not separate tables/schemas.
- **D-12:** Single shared password in an **env var** (e.g. `APP_PASSWORD`), verified in **middleware** that gates every route except `/login` and static assets; on success sets a **`jose`-signed `httpOnly`, `secure`, `sameSite=lax` cookie**. *(See "State of the Art" — in Next 16 this gate file is `proxy.ts` on the **Node.js** runtime, not Edge middleware. The decision holds; only the file name + runtime shift.)*
- **D-13:** Session lifetime = **30-day sliding** — **recorded DEFAULT, not a user decision**. A visible **Logout** clears the cookie; wrong password → inline error, no lockout. Planner may adjust the lifetime freely.
- **D-14:** The app runs **fully locally against PGlite** (embedded Postgres, zero install) behind a single `DATABASE_URL`. Deploying to Supabase is a config swap to the **pooled / transaction-mode** connection string — no code change. Drizzle keeps the schema identical across both.
- **D-15:** Six activities are typed config in **`lib/activities/`**, deliberately **framework- and dependency-free** so it imports cleanly on both client and server. Each `ActivityConfig` declares `type` (`measurement` | `item-list` | `status`), `planColumns`, and `actualColumns` (`FieldDef`: `key` / `label` / `kind` / `shared?` / `required?` / `enumValues?` / `computeFrom?`). A 7th activity = one registry entry. **Column specs already enumerated in PROJECT.md — use verbatim.**

### Claude's Discretion
- Exact Drizzle schema, column types, index definitions, migration file layout, and middleware/proxy code structure (grounded in canonical refs).
- The precise computed-total formula per activity (Counter Wall uses entered Actual Sq Ft; GSB/NLB and In-shop derive from L×B(×H)) — derive from PROJECT.md per-activity specs.
- Whether "active period" is an `is_active` boolean on `periods` vs a single-row current-period pointer.
- Session-lifetime value (30-day sliding assumed).

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within Phase 1 scope. The Period model and Login session-length detail were set aside by the user during the session and are **recorded as working defaults (D-10..D-13)**, not deferred to a later phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACCESS-01 | Unlock with shared password; session persists via secure signed cookie until logout/expiry | `proxy.ts` (Node runtime) + `jose` HS256 cookie pattern (§Auth); 30-day sliding via D-13 |
| ACCESS-02 | All data pages/actions blocked until password entered (no public access) | `proxy.ts` gate matcher excludes `/login` + static; **plus** re-check in Server Actions (defense-in-depth, CVE-2025-29927 lesson) |
| ACTV-01 | Six activity types each defined by a config entry | `lib/activities/` registry — one `ActivityConfig` per activity (§Registry); column specs verbatim from PROJECT.md |
| ACTV-02 | Each activity declares plan/actual columns + type (measurement/item-list/status); grid/import/export read config | `FieldDef[]` `planColumns`/`actualColumns` + `type` discriminator; `shared?` flag routes column → real col vs jsonb |
| ACTV-03 | Adding a new activity later is a config change — no new screens/bespoke code | `Record<ActivityKey, ActivityConfig>` + one dynamic `[activity]` route (from ARCHITECTURE.md) |
| ACTV-04 | Manage the selectable item list (item master) for POP/dealer-kit | `item_master` table (name + category + active flag, D-06/09); simple CRUD Server Actions |
| PRD-01 | Create a period (month/quarter/FY) and mark active | `periods` table (type enum + label + start/end dates, D-10) + `is_active` (D-11) |
| PRD-02 | Plans/actuals scoped to a period; selecting a period shows only its data | `period_id` FK column on `plan_rows`; every query `WHERE period_id = $1` (D-11) |
| COMP-01 | Structurally prevent recording an actual against an SFID not in the plan (DB-level) | `executions.plan_row_id NOT NULL REFERENCES plan_rows(id)` — no SFID column on `executions`; FK is the enforcer (§Off-Plan Schema) |
</phase_requirements>

## Summary

Phase 1 is a **Walking Skeleton** (per the "MVP Walking Skeleton Mode" decision): a thin but complete vertical slice — auth gate + portable schema + registry + item/period management — that every later phase writes into. The research already done nails the *stack* (Next 16 / React 19 / Drizzle / AG Grid / SheetJS-from-CDN / `jose`) and the *architecture* (config-driven registry, hybrid schema, structural FK guard). What it did **not** fully resolve, and what this document supplies, are the Phase-1 wiring specifics.

The single biggest gap was the **database runtime**: existing STACK.md is Neon-centric and never mentions PGlite, but CONTEXT.md D-14 mandates **PGlite local-first → Supabase later via `DATABASE_URL` only**. The clean, verified answer is a **dual-driver Drizzle setup**: locally `drizzle-orm/pglite` over an embedded `@electric-sql/pglite` instance with on-disk persistence; in production `drizzle-orm/postgres-js` over Supabase's transaction-mode pooler (`postgres(url, { prepare: false })`, the connection Supabase officially recommends for Drizzle). One `db/index.ts` branches on whether `DATABASE_URL` is a PGlite path vs a `postgres://` URL. Migrations are SQL files from `drizzle-kit generate`, applied to PGlite via the programmatic `migrate()` from `drizzle-orm/pglite/migrator` at server startup and to Supabase via `drizzle-kit migrate` (direct, non-pooled URL).

The second material finding is a **stale assumption in the prior research**: it specifies "Edge middleware" and justifies `jose` because `jsonwebtoken` doesn't run in Edge. **In Next.js 16, `middleware.ts` is replaced by `proxy.ts`, which runs on the Node.js runtime** (`middleware.ts` still works but is deprecated/Edge-only). `jose` is still the right choice, but the *reason* changes (Edge-compat becomes a bonus, not a requirement) and the gate file is now `proxy.ts`. A third, easy-to-miss gotcha: **Turbopack (Next 16's default bundler) does not fully support the WASM/dynamic-resolution that PGlite uses** — so PGlite must be kept server-only, declared in `serverExternalPackages`, and the dev server may need `--webpack`.

**Primary recommendation:** Build the dual-driver `db/index.ts` (PGlite local / postgres-js Supabase) behind one `DATABASE_URL` first; generate the schema with Drizzle exactly per D-01..D-11 (FK `onDelete: 'restrict'`, composite `UNIQUE(period_id, activity, sfid)`, no SFID column on `executions`, per-unit `version`, `numeric` money, jsonb tail); apply migrations to PGlite programmatically at startup; gate routes in `proxy.ts` (Node runtime) with a `jose` HS256 `httpOnly` cookie **and** re-check auth inside Server Actions.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Shared-password verification + cookie mint | Frontend Server (Server Action `/login`) | — | Password compared server-side against `process.env.APP_PASSWORD`; never reaches the client |
| Route gating / redirect-to-login | Frontend Server (`proxy.ts`, Node runtime) | API/Backend (Server Actions re-check) | `proxy.ts` is UX/coarse gate; the real boundary is per-action checks (defense-in-depth) |
| Activity registry (column defs, types, formulas) | Shared module (`lib/activities/`) | Browser + Server both import | Must be framework/dep-free so grid (client) and import/export (server) read the same source |
| Off-plan guard | Database (FK constraint) | API/Backend (friendly pre-check) | Structural invariant — the DB rejects orphan executions regardless of app code |
| Period scoping | Database (`period_id` column + predicate) | Frontend Server (period switcher in shell) | Scoping is a column + `WHERE`, not separate schemas |
| Item master CRUD | API/Backend (Server Actions → `lib/db`) | Browser (management form) | Simple typed mutations; no business rules beyond the active flag |
| Local persistence | Database (PGlite embedded, Node process) | — | PGlite runs in-process on the Node server only — never client, never Edge |
| Schema portability (PGlite↔Supabase) | Database driver layer (`db/index.ts`) | — | Single `DATABASE_URL` seam; Drizzle schema identical across both |

## Standard Stack

> Versions re-verified against the npm registry on **2026-06-04** (`npm view <pkg> version` + `time.modified`). Everything in the existing STACK.md is still current today; the rows below are the **Phase-1 additions/changes** that STACK.md does not cover.

### Core (Phase-1 additions to the existing stack)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@electric-sql/pglite` | **0.5.1** (modified 2026-06-02) | Embedded WASM Postgres for **local-first** dev — zero install, on-disk persistence | `[VERIFIED: npm registry]` Official ElectricSQL project (`github.com/electric-sql/pglite`, maintainer `thruflo`); Drizzle lists it as a first-class peer `>=0.2.0`. Real Postgres semantics → schema identical to Supabase. `[CITED: pglite.dev/docs]` |
| `drizzle-orm` | **0.45.2** | ORM — one schema, two drivers (`drizzle-orm/pglite` + `drizzle-orm/postgres-js`) | `[VERIFIED: npm registry]` Peer deps explicitly include `@electric-sql/pglite >=0.2.0`, `postgres >=3`, `@neondatabase/serverless >=0.10.0`. Already locked by PROJECT.md. |
| `drizzle-kit` | **0.31.10** | Migrations — `generate` (SQL files) + `migrate`; `studio` | `[VERIFIED: npm registry]` Locked by PROJECT.md. `driver: 'pglite'` in config enables `drizzle-kit migrate`/`studio` against PGlite. |
| `postgres` (postgres.js) | **3.4.9** | **Supabase** production driver | `[CITED: supabase.com/docs/guides/database/drizzle]` Supabase's *officially documented* Drizzle driver. Use `postgres(url, { prepare: false })` for the transaction-mode pooler. `[VERIFIED: npm registry]` (`github.com/porsager/postgres`). |
| `next` | **16.2.7** | App framework | `[VERIFIED: npm registry]` Locked. **Note Next-16 changes below** (`proxy.ts`, async `cookies()`, Turbopack default). |
| `jose` | **6.2.3** | Sign/verify the session JWT cookie (HS256) | `[VERIFIED: npm registry]` Locked. Works on the Node runtime `proxy.ts` runs on (and would also work on Edge — no longer the deciding factor). |
| `zod` | **4.4.3** | Validate Server Action inputs (login, period create, item CRUD) | `[VERIFIED: npm registry]` Locked. |
| `tailwindcss` | **4.3.0** | Styling | `[VERIFIED: npm registry]` Locked. v4 setup differs from v3 — see scaffold §. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pg` (node-postgres) | 8.21.0 | Alternative Supabase driver (`drizzle-orm/node-postgres`) | Only if you adopt the Fluid-Compute `attachDatabasePool` path from STACK.md. `postgres.js` is the simpler default Supabase recommends. `[ASSUMED]` |
| `dotenv` / `dotenv-cli` | current | Load `DATABASE_URL` for `drizzle-kit` CLI outside Next runtime | `drizzle.config.ts` needs the env var at CLI time; Next loads `.env` itself at runtime. `[ASSUMED]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `postgres.js` (Supabase prod) | `@neondatabase/serverless` | STACK.md's original Neon pick; **superseded by D-14** which chose Supabase. Neon's HTTP driver is excellent but not what the user selected. Keep as a fallback only if the team switches cloud providers. |
| PGlite on-disk (`new PGlite('./path')`) | PGlite in-memory (`new PGlite()`) | In-memory resets every restart — fine for tests, **wrong for local dev** (you'd lose entered data). Use on-disk for the dev DB, in-memory for the test suite. |
| Programmatic `migrate()` at startup (PGlite) | `drizzle-kit push` | `push` is convenient for throwaway prototyping but skips the migration history; since Supabase will use versioned `migrate`, keep **one** migration source of truth and apply the same SQL files to PGlite via `migrate()`. |
| `proxy.ts` (Node, Next 16) | `middleware.ts` (Edge, deprecated) | `middleware.ts` still functions but is deprecated and Edge-only; PGlite/Node-API code cannot run in Edge anyway. Use `proxy.ts`. |

**Installation (Phase-1 delta — run after the create-next-app scaffold below):**
```bash
# DB: ORM + both drivers (PGlite local, postgres.js for Supabase) + kit
npm install drizzle-orm @electric-sql/pglite postgres
npm install -D drizzle-kit dotenv-cli

# Auth + validation (already in the locked stack)
npm install jose zod
```
*(SheetJS, AG Grid, shadcn/ui are NOT installed in Phase 1 — they belong to Phases 2/3. Keep Phase 1 lean.)*

**Version verification performed:**
```
@electric-sql/pglite => 0.5.1   (modified 2026-06-02)   dist-tags: latest 0.5.1, next 0.3.0-next.1
drizzle-orm          => 0.45.2  (peer: @electric-sql/pglite >=0.2.0, postgres >=3)
drizzle-kit          => 0.31.10
postgres             => 3.4.9
pg                   => 8.21.0
next                 => 16.2.7   react => 19.2.7   jose => 6.2.3   zod => 4.4.3   tailwindcss => 4.3.0
```

## Package Legitimacy Audit

> slopcheck could **not** be installed in this environment (`pip install slopcheck` failed). Per protocol, packages are verified by ecosystem-registry metadata + official-source provenance instead, and the two NEW packages are marked accordingly. The planner should still gate the first install behind a quick human sanity-check.

| Package | Registry | Age / Recency | Source Repo | slopcheck | Disposition |
|---------|----------|---------------|-------------|-----------|-------------|
| `@electric-sql/pglite` | npm | latest 0.5.1, modified 2026-06-02 (active); project itself mature (ElectricSQL) | `github.com/electric-sql/pglite` (maintainer `thruflo`) | unavailable | **Approved** — official project, no `postinstall`, Drizzle first-class peer. Cited from `pglite.dev` (authoritative). |
| `postgres` (postgres.js) | npm | 3.4.9, modified 2026-04-05 | `github.com/porsager/postgres` | unavailable | **Approved** — Supabase's officially documented driver, widely used, no `postinstall`. |
| `drizzle-orm`, `drizzle-kit`, `next`, `react`, `jose`, `zod`, `tailwindcss` | npm | all verified current 2026-06-04 | respective official repos | unavailable | **Approved** — already locked + verified in existing STACK.md. |

**Postinstall check (Node phases):** `npm view @electric-sql/pglite scripts.postinstall` → none. `npm view postgres scripts.postinstall` → none. No network/filesystem-side-effecting install scripts on the new packages.

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged [SUS]:** none. (slopcheck unavailable, but both new packages trace to authoritative official sources and pass registry + repo + postinstall checks — stronger evidence than registry-existence alone.)

## Architecture Patterns

### System Architecture Diagram (Phase-1 slice)

```
                         ┌─────────────────────────────────────────┐
   Browser request ─────▶│  proxy.ts  (Next 16, NODE runtime)       │
                         │  has valid jose cookie?                  │
                         │   ├─ no  → redirect /login               │
                         │   └─ yes → continue                      │
                         └───────────────┬──────────────────────────┘
                                         │  (excludes /login + static assets via matcher)
                  ┌──────────────────────┼───────────────────────────────┐
                  ▼                       ▼                               ▼
        ┌──────────────────┐   ┌─────────────────────┐      ┌────────────────────────┐
        │ /login           │   │ (app) Server Comps  │      │ Server Actions          │
        │ Server Action:   │   │  read active period │      │  createPeriod()         │
        │  compare pwd →   │   │  list items/periods │      │  setActivePeriod()      │
        │  jose.sign() →   │   │                     │      │  upsertItem()           │
        │  set httpOnly    │   │  (each ALSO         │◀─────│  ▲ re-check auth here    │
        │  cookie          │   │   re-checks auth)   │      │    (defense-in-depth)   │
        └──────────────────┘   └──────────┬──────────┘      └───────────┬────────────┘
                                          │                              │
                                          ▼                              ▼
                               ┌───────────────────────────────────────────────┐
                               │  lib/activities/  (REGISTRY — client+server)   │
                               │  ACTIVITIES: Record<key, ActivityConfig>       │
                               └───────────────────────────────────────────────┘
                                          │ typed queries (no business rules)
                                          ▼
                               ┌───────────────────────────────────────────────┐
                               │  db/index.ts  — branch on DATABASE_URL         │
                               │   path/"memory" ─▶ drizzle-orm/pglite          │
                               │   postgres://    ─▶ drizzle-orm/postgres-js    │
                               │                     (prepare:false, pooler)    │
                               └───────────────────┬───────────────────────────┘
                                                   ▼
              LOCAL (default)                                  PROD (DATABASE_URL swap)
   ┌──────────────────────────────┐                ┌──────────────────────────────────┐
   │ @electric-sql/pglite          │                │ Supabase Postgres                 │
   │ new PGlite('./.pglite')       │                │ transaction-mode pooler (:6543)   │
   │ single connection, on disk    │                │ direct (:5432) for migrations     │
   │ migrate() at startup          │                │ drizzle-kit migrate (CI/deploy)   │
   └──────────────────────────────┘                └──────────────────────────────────┘
        TABLES (identical schema both sides):
        periods ──< plan_rows ──< executions ──< execution_items        item_master
                    (UNIQUE          (FK NOT NULL      (name SNAPSHOT,
                     period_id,       RESTRICT;         qty, rate, total)
                     activity,        per-unit version;
                     sfid)            numeric cost)
```

### Recommended Project Structure (Phase-1 subset of ARCHITECTURE.md)
```
app/
├── login/page.tsx              # password form (Server Action target)
├── (app)/
│   ├── layout.tsx              # shell: period switcher + Logout
│   ├── page.tsx                # placeholder dashboard (real one = Phase 4)
│   ├── periods/page.tsx        # create period + mark active (PRD-01)
│   └── items/page.tsx          # item master CRUD (ACTV-04)
└── layout.tsx
lib/
├── activities/                 # ◄── THE REGISTRY (framework/dep-free)
│   ├── types.ts                # ActivityConfig, FieldDef, ActivityType
│   ├── counter-wall.ts │ gsb.ts │ nlb.ts │ inshop.ts │ pop-dealer-kit.ts │ dealer-certificate.ts
│   └── index.ts                # ACTIVITIES: Record<ActivityKey, ActivityConfig>
├── auth/
│   ├── session.ts              # jose sign/verify (SESSION_SECRET)
│   └── password.ts             # constant-time compare to APP_PASSWORD
├── db/
│   ├── index.ts                # ◄── dual-driver: PGlite | postgres-js on DATABASE_URL
│   ├── schema.ts               # Drizzle tables (or split per-table)
│   ├── migrate.ts              # programmatic migrate() for PGlite at startup
│   ├── periods.ts │ items.ts   # typed queries (no business rules)
└── actions/
    ├── auth.ts                 # "use server" login/logout (re-checks nothing — it IS the gate-setter)
    ├── periods.ts              # "use server" createPeriod/setActive (re-check auth)
    └── items.ts                # "use server" upsert/retire item (re-check auth)
proxy.ts                        # ◄── Next-16 gate (Node runtime) — was middleware.ts
drizzle.config.ts               # dialect postgresql; driver pglite for local
drizzle/                        # generated SQL migrations (one source of truth, both DBs)
```

### Pattern 1: Dual-driver `DATABASE_URL` seam (the heart of D-14)
**What:** A single `db/index.ts` returns a Drizzle instance backed by PGlite locally or postgres.js (Supabase) in prod, chosen by inspecting `DATABASE_URL`. The schema, queries, and types are byte-identical across both.
**When to use:** Local-first development that deploys to managed Postgres with zero code change.
**Example:**
```typescript
// lib/db/index.ts  — Source: synthesized from orm.drizzle.team/docs/get-started/pglite-new
//                    + supabase.com/docs/guides/database/drizzle (both [CITED])
import * as schema from "./schema";

const url = process.env.DATABASE_URL ?? "./.pglite";   // local default

// A postgres:// URL → Supabase (postgres.js); anything else → a PGlite path/dir.
const isPg = /^postgres(ql)?:\/\//.test(url);

// Module-singleton so Next dev hot-reload reuses PGlite's ONE connection.
const g = globalThis as unknown as { __db?: ReturnType<typeof makeDb> };

function makeDb() {
  if (isPg) {
    // PROD: Supabase transaction-mode pooler. prepare:false is REQUIRED for the pooler.
    const postgres = require("postgres");
    const { drizzle } = require("drizzle-orm/postgres-js");
    const client = postgres(url, { prepare: false });
    return drizzle(client, { schema });
  }
  // LOCAL: embedded PGlite, on-disk persistence, single connection.
  const { PGlite } = require("@electric-sql/pglite");
  const { drizzle } = require("drizzle-orm/pglite");
  const client = new PGlite(url);                       // e.g. new PGlite("./.pglite")
  return drizzle({ client, schema });
}

export const db = (g.__db ??= makeDb());
```
> `[CITED]` import paths (`drizzle-orm/pglite`, `drizzle-orm/postgres-js`), the `drizzle({ client })` form, and `postgres(url, { prepare: false })` are all from official docs. The branch logic + singleton are synthesized `[ASSUMED]` glue — sound, but confirm the exact `globalThis` pattern fits your lint config.

### Pattern 2: Programmatic PGlite migration at startup
**What:** Generate versioned SQL with `drizzle-kit generate` (one source of truth). Apply it to PGlite at server boot via the Node-only `migrate()`; apply the same files to Supabase via `drizzle-kit migrate` in CI/deploy.
**Example:**
```typescript
// lib/db/migrate.ts — Source: orm.drizzle.team/docs/get-started/pglite-new
//                     + drizzle GitHub discussion #2532 [CITED]
import { migrate } from "drizzle-orm/pglite/migrator";   // Node-only (uses fs)
import { db } from "./index";

export async function ensureMigrated() {
  if (/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) return; // Supabase handled by CLI
  await migrate(db, { migrationsFolder: "./drizzle" });
}
```
```typescript
// drizzle.config.ts — Source: orm.drizzle.team (driver:'pglite' enables kit migrate/studio locally)
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  driver: "pglite",                       // local; for Supabase run with a postgres:// DATABASE_URL
  dbCredentials: { url: process.env.DATABASE_URL ?? "./.pglite" },
});
```
Call `ensureMigrated()` once where the Node server first touches the DB (e.g. an `instrumentation.ts` `register()`, or guarded at the top of the data layer). **Do not** call it from `proxy.ts` or a client component.

### Pattern 3: Structural off-plan guard in Drizzle (D-01/D-02/D-03/D-04/D-05)
**What:** `executions` has **no SFID column** — it can only exist by pointing at a real `plan_rows.id` via a `NOT NULL` FK with `onDelete: 'restrict'`. The match key is a composite `UNIQUE` on `plan_rows`. Multi-unit = many `executions` per plan row, each with its own `version` and `numeric` cost.
**Example:**
```typescript
// lib/db/schema.ts — Drizzle pg-core
// FK onDelete values + composite unique + index syntax all [CITED: orm.drizzle.team/docs/indexes-constraints
//   + drizzle-orm/src/pg-core/foreign-keys.ts] ; column modeling is D-01..D-11 verbatim.
import {
  pgTable, bigserial, bigint, text, numeric, integer, boolean,
  timestamp, date, jsonb, unique, index, pgEnum,
} from "drizzle-orm/pg-core";

export const periodType = pgEnum("period_type", ["month", "quarter", "fy"]); // D-10

export const periods = pgTable("periods", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  type:      periodType("type").notNull(),
  label:     text("label").notNull(),
  startDate: date("start_date").notNull(),          // Indian FY encoded by dates, not inferred (D-10)
  endDate:   date("end_date").notNull(),
  isActive:  boolean("is_active").notNull().default(false), // exactly one true (D-11; enforce app-side)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planRows = pgTable("plan_rows", {
  id:         bigserial("id", { mode: "number" }).primaryKey(),
  periodId:   bigint("period_id", { mode: "number" }).notNull().references(() => periods.id),
  activity:   text("activity").notNull(),           // registry key (discriminator)
  sfid:       text("sfid").notNull(),               // ALWAYS text — never numeric (PITFALLS Excel coercion)
  // shared who/where = real indexed columns
  region: text("region"), state: text("state"), district: text("district"),
  taluka: text("taluka"), distributor: text("distributor"), dealer: text("dealer"),
  plannedCost: numeric("planned_cost", { precision: 14, scale: 2 }),  // budget (D-05); numeric not float
  fields:     jsonb("fields").$type<Record<string, unknown>>().notNull().default({}), // plan-side extras
}, (t) => [
  unique("plan_rows_match_key").on(t.periodId, t.activity, t.sfid),   // D-02 — the import match key
  index("plan_rows_filter_idx").on(t.periodId, t.activity, t.region, t.state, t.district),
]);

export const executions = pgTable("executions", {
  id:        bigserial("id", { mode: "number" }).primaryKey(),
  // D-01/D-03: NOT NULL FK + RESTRICT = structural off-plan guard. NO sfid column here by design.
  planRowId: bigint("plan_row_id", { mode: "number" })
               .notNull()
               .references(() => planRows.id, { onDelete: "restrict" }),
  status:    text("status"),
  unitNo:    text("unit_no"),                        // Wall/Shop No — per-unit identity (D-03)
  perUnitCost: numeric("per_unit_cost", { precision: 14, scale: 2 }), // numeric (D-05)
  totalCost:   numeric("total_cost",  { precision: 14, scale: 2 }),   // computed APP-SIDE, persisted (D-05)
  totalSqft:   numeric("total_sqft",  { precision: 14, scale: 2 }),   // computed APP-SIDE, persisted (D-05)
  fields:    jsonb("fields").$type<Record<string, unknown>>().notNull().default({}), // measurements/lat-long
  version:   integer("version").notNull().default(0), // D-04 — per-unit optimistic concurrency
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [ index("executions_plan_row_idx").on(t.planRowId) ]);

export const executionItems = pgTable("execution_items", {  // POP/Dealer-Kit children (D-07/D-08)
  id:          bigserial("id", { mode: "number" }).primaryKey(),
  executionId: bigint("execution_id", { mode: "number" })
                 .notNull()
                 .references(() => executions.id, { onDelete: "restrict" }), // protect recorded spend (D-01 ethos)
  itemName:    text("item_name").notNull(),          // SNAPSHOT at entry (D-08) — not an FK to item_master
  qty:         numeric("qty",  { precision: 14, scale: 2 }).notNull(),
  rate:        numeric("rate", { precision: 14, scale: 2 }).notNull(),  // fresh per line (D-07)
  lineTotal:   numeric("line_total", { precision: 14, scale: 2 }).notNull(), // computed app-side
});

export const itemMaster = pgTable("item_master", {   // D-06/D-07/D-09
  id:       bigserial("id", { mode: "number" }).primaryKey(),
  name:     text("name").notNull(),
  category: text("category"),                         // optional grouping (D-06)
  active:   boolean("active").notNull().default(true),// retire without hard delete (D-09)
});
```
> **Why `execution_items` snapshots the name instead of FK→`item_master`:** D-08 requires historical lines to read exactly as recorded even after a master rename. An FK would re-label history. Store the name string; the master is only the *picker source*.

### Pattern 4: `proxy.ts` Node-runtime auth gate + Server-Action re-check (D-12, ACCESS-01/02)
**What:** `proxy.ts` (Next 16, Node runtime) verifies the `jose` cookie on every route except `/login` + static assets. Because middleware/proxy is **UX, not the security boundary** (CVE-2025-29927 lesson), every data-reading/writing Server Action re-verifies the cookie too.
**Example:**
```typescript
// proxy.ts (Next 16 — replaces middleware.ts; runs on Node runtime)
// Source: nextjs.org/blog/next-16 (proxy rename + Node runtime) [CITED]
import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "./lib/auth/session";

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/_next")) return NextResponse.next();
  const token = req.cookies.get("session")?.value;
  if (token && (await verifySession(token))) return NextResponse.next();
  const url = req.nextUrl.clone(); url.pathname = "/login";
  return NextResponse.redirect(url);
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
```
```typescript
// lib/auth/session.ts — jose HS256 (works on Node runtime; Edge-compat now a bonus, not the reason)
import { SignJWT, jwtVerify } from "jose";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET);     // server-only, NEVER NEXT_PUBLIC_
const MAX_AGE = 60 * 60 * 24 * 30;                                       // 30-day sliding (D-13)

export async function mintSession() {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt().setExpirationTime(`${MAX_AGE}s`).sign(secret);
}
export async function verifySession(token: string) {
  try { await jwtVerify(token, secret); return true; } catch { return false; }
}
```
```typescript
// lib/actions/auth.ts — login Server Action sets the cookie; NOTE async cookies() in Next 16
// Source: nextjs.org/blog/next-16 (cookies()/headers() are now async) [CITED]
"use server";
import { cookies } from "next/headers";
import { timingSafeEqual } from "node:crypto";
import { mintSession } from "../auth/session";

export async function login(_: unknown, formData: FormData) {
  const pwd = String(formData.get("password") ?? "");
  const expected = process.env.APP_PASSWORD ?? "";
  const a = Buffer.from(pwd), b = Buffer.from(expected);
  const ok = a.length === b.length && timingSafeEqual(a, b);  // constant-time
  if (!ok) return { error: "Incorrect password" };            // inline error, no lockout (D-13)
  const jar = await cookies();                                 // ← await: Next 16 async cookies()
  jar.set("session", await mintSession(), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return { ok: true };
}
```

### Anti-Patterns to Avoid
- **Putting PGlite in Edge `middleware.ts` or a client component.** PGlite needs Node FS/WASM; it runs **only** in the Node server process. The gate is `proxy.ts` (Node) — but `proxy.ts` should verify the cookie (`jose`, pure crypto), **not** touch PGlite. (See Pitfall 2.)
- **An `sfid` column on `executions`.** Re-introduces the bypass D-01/COMP-01 exist to prevent. The SFID lives on `plan_rows`; executions reference the row.
- **`ON DELETE CASCADE` anywhere from `plan_rows`.** Contradicts D-01; a destructive re-upload would erase actuals. Use `restrict`.
- **Generated columns for `total_cost`/`total_sqft` off jsonb.** The `::numeric` cast is non-immutable and crashes on dirty input (PITFALLS canonical trap, D-05). Compute app-side, persist to plain `numeric`.
- **`Number(row.cost)` on a `numeric`.** postgres.js/pg return `numeric` as **strings** deliberately; wrapping in `Number()` reintroduces float error (PITFALLS #9). Keep numeric values as strings end-to-end.
- **A new `PGlite()` per request / per hot-reload.** PGlite is single-connection; use the `globalThis` singleton or dev hot-reload spawns competing instances and locks.
- **Treating `proxy.ts` as the security boundary.** Re-check auth in Server Actions (CVE-2025-29927 defense-in-depth).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Local Postgres for dev | A Dockerized Postgres + setup script + teardown | `@electric-sql/pglite` (`new PGlite('./.pglite')`) | Zero install, real Postgres semantics, on-disk persistence; matches Supabase schema exactly (D-14) |
| JWT sign/verify on Node | Custom HMAC + base64 cookie | `jose` `SignJWT`/`jwtVerify` (HS256) | Constant-time verify, standard claims, no crypto footguns; already locked |
| Constant-time password compare | `a === b` (timing-leaky) | `node:crypto` `timingSafeEqual` | Prevents timing side-channel on the shared password |
| Schema migrations across two DBs | Two hand-written SQL dialects | `drizzle-kit generate` once → `migrate()` (PGlite) + `drizzle-kit migrate` (Supabase) | One source of truth; identical SQL both sides |
| Route gating | Per-page `if (!session) redirect` everywhere | `proxy.ts` matcher + Server-Action re-check | Single coarse gate + per-action backstop; DRY and defense-in-depth |
| Input validation | `if (typeof x !== ...)` ladders | `zod` schemas on every action input | Locked; pairs with Drizzle types |

**Key insight:** Phase 1's value is *structural guarantees*, not custom plumbing. The FK, the composite UNIQUE, the constant-time compare, and the single migration source each replace an error-prone hand-rolled check with something the DB or a vetted library enforces.

## Runtime State Inventory

> Greenfield phase — there is **no** pre-existing runtime state to migrate. This is a creation phase. Categories below are answered explicitly per protocol.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — no database exists yet (no `package.json`, no `.pglite`, no Supabase project provisioned). Verified by repo listing: only `.planning/`, `CLAUDE.md`, `.gitignore`, `.superpowers/` exist. | none — Phase 1 creates the first schema |
| Live service config | **None** — no Supabase project, no Vercel deployment, no external service wired yet. | none |
| OS-registered state | **None** — no scheduled tasks, services, or daemons. | none |
| Secrets/env vars | **To be created** (not pre-existing): `DATABASE_URL`, `APP_PASSWORD`, `SESSION_SECRET`. None currently set. **Must be server-only — never `NEXT_PUBLIC_`** (PITFALLS #10). | create `.env.local` (gitignored); document in `.env.example` |
| Build artifacts | **None** — no `node_modules`, `.next`, or `drizzle/` output yet. | none — generated fresh by scaffold + `drizzle-kit generate` |

**The canonical question — "after every file is updated, what runtime systems still have old state?":** N/A for greenfield. The only forward-looking note: once the dev DB exists (`./.pglite`), it must be **gitignored** (it is binary Postgres data) and is *not* portable to Supabase by file copy — portability is via re-running migrations, per D-14.

## Common Pitfalls

### Pitfall 1: Assuming Edge middleware (stale prior research) → `jose`/runtime confusion
**What goes wrong:** Following STACK.md/PITFALLS.md literally, you create `middleware.ts` and justify `jose` "because Edge can't run jsonwebtoken." On Next 16 you get a deprecation warning, and you may wrongly conclude you're constrained to Edge-only APIs.
**Why it happens:** Existing research predates (or didn't surface) the Next 16 `proxy.ts` change.
**How to avoid:** Use **`proxy.ts`** with an exported `proxy` function; it runs on the **Node.js runtime**. `jose` is still correct (and still the recommendation), but for Node-compat reasons now, not Edge. `jsonwebtoken` would *also* work on the Node runtime — `jose` is kept for its clean API + zero-config, not necessity.
**Warning signs:** A `middleware.ts` file in a Next 16 project; build logs warning "Rename middleware to proxy."

### Pitfall 2: PGlite under Turbopack (Next 16 default bundler) fails to load WASM
**What goes wrong:** `next dev` (Turbopack default in 16) throws `Unknown module type` / "Module not found" / WASM resolution errors when it tries to bundle `@electric-sql/pglite`, because Turbopack statically analyzes the dynamic `createRequire().resolve()` PGlite uses and doesn't yet fully support WASM modules (vercel/next.js issues #84972, #65361).
**Why it happens:** PGlite resolves its `.wasm`/`.data` files dynamically at runtime; Turbopack wants static analysis at build time.
**How to avoid:**
- Keep PGlite **server-only** (it already must be — Node FS). Add it to **`serverExternalPackages`** so Next uses native `require` instead of bundling it:
  ```typescript
  // next.config.ts
  const nextConfig = { serverExternalPackages: ["@electric-sql/pglite"] };
  export default nextConfig;
  ```
- If Turbopack still chokes in dev, run the dev server on **webpack**: `next dev --webpack` (webpack handles PGlite's dynamic resolution; the older PGlite docs' `transpilePackages: ['@electric-sql/pglite']` + `swcMinify:false` is the webpack-era recipe).
- Never import PGlite into a client component or `proxy.ts`.
**Warning signs:** WASM/"Unknown module type" errors only under `next dev` (not under a plain `node` script); errors vanish with `--webpack`.
**Confidence:** MEDIUM-HIGH — the Turbopack WASM limitation is documented in open Next.js issues; the exact fix (serverExternalPackages vs `--webpack`) should be confirmed by a quick spike at the start of Phase 1.

### Pitfall 3: PGlite single connection clobbered by Next dev hot-reload
**What goes wrong:** Each hot-reload re-evaluates `db/index.ts`, spawning a new `PGlite` instance. Since PGlite allows exactly **one** connection to a given dataDir, the second instance errors or the data layer behaves erratically.
**Why it happens:** PGlite runs Postgres in single-user mode (Emscripten can't fork) — one exclusive connection.
**How to avoid:** Cache the instance on `globalThis` (the Prisma-in-Next pattern), as shown in Pattern 1. One instance survives reloads.
**Warning signs:** "database is locked" / connection errors that appear only after editing a file, not on fresh `next dev`.

### Pitfall 4: Next 16 async `cookies()`/`headers()` used synchronously
**What goes wrong:** `cookies().set(...)` (Next ≤15 style) throws in Next 16 — `cookies()`, `headers()`, `draftMode()`, and route `params`/`searchParams` are now **async**.
**How to avoid:** `const jar = await cookies();` then `jar.set(...)`. Same for `await headers()`, `await params`.
**Warning signs:** Runtime error "cookies() should be awaited" in the login/logout action.
**Source:** `[CITED: nextjs.org/blog/next-16]` (Breaking Changes table).

### Pitfall 5: "Exactly one active period" not enforced (D-11)
**What goes wrong:** `is_active` is a plain boolean; nothing stops two periods being active, so the default scope is ambiguous.
**How to avoid:** Enforce single-active in the `setActivePeriod` action inside a transaction (`UPDATE periods SET is_active=false; UPDATE periods SET is_active=true WHERE id=$1`). Optionally add a partial unique index (`CREATE UNIQUE INDEX ... ON periods (is_active) WHERE is_active`) for a DB-level guarantee — Drizzle supports `.where()` on `uniqueIndex`. Decide per Claude's-discretion note (boolean vs single-row pointer).
**Warning signs:** Two rows with `is_active = true`; login picks an arbitrary period.

### Pitfall 6 (carried from PITFALLS.md — still applies): money as float / `numeric` wrapped in `Number()`
**How to avoid:** All money/measure columns are `numeric(14,2)` (D-05). Keep values as **strings** from the driver; compute totals once in a shared util and persist. (Full detail: PITFALLS.md #9 + Reconciled Decision 3.)

## Code Examples

(Primary verified patterns are inline above in Patterns 1–4. Sources: `orm.drizzle.team/docs/get-started/pglite-new`, `orm.drizzle.team/docs/indexes-constraints`, `supabase.com/docs/guides/database/drizzle`, `nextjs.org/blog/next-16`, drizzle-orm GitHub discussion #2532, `pglite.dev/docs`.)

### Next 16 scaffold (greenfield start)
```bash
# Turbopack, TypeScript, Tailwind v4, App Router, ESLint are the DEFAULTS in Next 16.
# Source: nextjs.org/blog/next-16 + nextjs.org/docs/app/getting-started/installation [CITED]
npx create-next-app@latest marketing-tracker --typescript --tailwind --eslint --app
# (Turbopack is default; pass --webpack later only if PGlite needs it in dev — see Pitfall 2.)
```
Tailwind v4 (what the scaffold produces): `postcss.config.mjs` with `{ plugins: { "@tailwindcss/postcss": {} } }`, and `app/globals.css` containing **`@import "tailwindcss";`** — **no `tailwind.config.js`**, no `content` array (v4 auto-detects). `[CITED: tailwindcss.com/docs/guides/nextjs]`

## State of the Art

| Old Approach (existing research / training) | Current Approach (verified 2026-06-04) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| **Edge `middleware.ts`** for the auth gate; `jose` *required because Edge can't run jsonwebtoken* | **`proxy.ts` on the Node.js runtime** (`middleware.ts` deprecated, Edge-only). `jose` still recommended, now for clean API not Edge-necessity | Next.js 16 (Oct 2025) | **Corrects D-12 wording** + STACK.md/PITFALLS.md "Edge middleware" claims. Gate file = `proxy.ts`; exported fn = `proxy`. |
| Sync `cookies()` / `headers()` / route `params` | **All async** — `await cookies()`, `await headers()`, `await params` | Next.js 16 | Login/logout actions and any `params` access must `await`. |
| Webpack default; `transpilePackages` + `swcMinify:false` for PGlite | **Turbopack default**; prefer `serverExternalPackages` for PGlite, fall back to `next dev --webpack` | Next.js 16 | PGlite WASM may need the webpack escape hatch in dev (Pitfall 2). |
| STACK.md DB = **Neon** + `@neondatabase/serverless` | **PGlite local → Supabase via `postgres.js` (`prepare:false`, transaction pooler)** | CONTEXT.md D-14 (user choice) | Neon rows in STACK.md are superseded for this project; postgres.js is the prod driver. |
| `next lint` / `.eslintrc` legacy config | `next lint` **removed**; ESLint **flat config** default; lint via ESLint/Biome directly | Next.js 16 | `npm run lint` wiring differs; scaffold uses flat config. |

**Deprecated/outdated for this phase:**
- `middleware.ts` (use `proxy.ts`); `@neondatabase/serverless` as the chosen driver (D-14 chose Supabase+postgres.js); `tailwind.config.js` (v4 is CSS-first); `swcMinify` config key.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `serverExternalPackages: ["@electric-sql/pglite"]` lets PGlite load under Turbopack without `--webpack` | Pitfall 2 | LOW-MED — if it still fails, fallback is `next dev --webpack` (documented, works). Confirm in a 30-min spike. |
| A2 | The `globalThis` singleton + `require()`-inside-branch shape in `db/index.ts` is lint/Next-clean | Pattern 1 | LOW — pattern is standard (Prisma-in-Next); exact `require` vs dynamic `import()` may need adjustment for ESM/TS config. |
| A3 | `pg`/`dotenv-cli` are the right helper choices | Supporting stack | LOW — `pg` only needed if adopting the alt pooling path; `dotenv-cli` is a convenience for the kit CLI. |
| A4 | A partial unique index is the cleanest "one active period" enforcement | Pitfall 5 | LOW — transactional toggle also works; this is Claude's-discretion per CONTEXT. |
| A5 | PGlite 0.5.1 (2 days old) is production-safe for *local dev* use | Stack | LOW — it's local-dev-only; the project (ElectricSQL) is mature and Drizzle-supported. Not used in prod (Supabase is). |

**Note:** Items above are the only `[ASSUMED]` claims. All schema constructs, import paths, driver config, and Next-16 behavior changes are `[CITED]` from official docs or `[VERIFIED]` against the npm registry.

## Open Questions

1. **PGlite-under-Turbopack exact incantation**
   - What we know: Turbopack has documented WASM/dynamic-resolution gaps; `serverExternalPackages` and `--webpack` are the two known levers.
   - What's unclear: which one Next 16.2.7 + PGlite 0.5.1 needs *today* (versions move fast).
   - Recommendation: **First task of Phase 1 is a thin spike** — scaffold, install PGlite, run a trivial `SELECT 1` from a Server Action under `next dev`. If it fails, add `serverExternalPackages`; if still failing, `next dev --webpack`. Lock the answer before building the schema.

2. **Single migration source applied to both DBs in practice**
   - What we know: `drizzle-kit generate` → `migrate()` (PGlite) + `drizzle-kit migrate` (Supabase) is the intended flow.
   - What's unclear: whether `drizzle-kit migrate` with `driver:'pglite'` vs a `postgres://` URL needs two config files or one config + env swap.
   - Recommendation: one `drizzle.config.ts` keyed off `DATABASE_URL`; document both invocations in `package.json` scripts (`db:generate`, `db:migrate:local`, `db:migrate:prod`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Next 16 (min 20.9), PGlite | ✓ | v24.14.0 | — (well above the 20.9 floor) |
| npm | install/scripts | ✓ | 11.9.0 | — |
| PGlite (`@electric-sql/pglite`) | local DB | ✗ (not installed yet) | target 0.5.1 | none needed — `npm install` provisions it; zero external service |
| Supabase project | production deploy | ✗ (not provisioned) | — | **Not needed for Phase 1** — local-first (D-14); provision only when deploying |
| Vercel | production deploy | ✗ | — | **Not needed for Phase 1** — runs locally |

**Missing dependencies with no fallback:** none — Phase 1 runs entirely locally; the only "missing" items (Supabase, Vercel) are deliberately out of scope until a later deploy (D-14).
**Missing dependencies with fallback:** PGlite is provisioned by `npm install` (no external service); the local dev DB is self-contained.

## Security Domain

> `security_enforcement` is not set in `.planning/config.json` (absent = enabled). Auth is the core of this phase, so this section is included and focused on Phase-1 surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Shared password in `APP_PASSWORD` (server-only env); constant-time `timingSafeEqual` compare; no lockout acceptable for a small trusted team (D-13) |
| V3 Session Management | yes | `jose` HS256 JWT in an `httpOnly`, `secure`, `sameSite=lax` cookie; 30-day sliding expiry (D-13); Logout clears the cookie |
| V4 Access Control | yes | `proxy.ts` gate (coarse) **plus** per-Server-Action re-verification (the real boundary) — defense-in-depth per CVE-2025-29927 |
| V5 Input Validation | yes | `zod` on every action input (login, period create, item CRUD); `sfid`/IDs always treated as text |
| V6 Cryptography | yes | `jose` for signing (never hand-rolled HMAC); `SESSION_SECRET` ≥32 bytes, server-only |
| V7 Error Handling/Logging | partial | Wrong password → inline generic error, no info leak; no audit trail by design (shared login) — compensate with backups later (PITFALLS #11) |

### Known Threat Patterns for Next.js 16 + shared-password
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Middleware/proxy bypass (CVE-2025-29927, `x-middleware-subrequest`) | Elevation of Privilege | Next 16.2.7 is **patched** (fix shipped 15.2.3+); **also** re-check auth in Server Actions — never trust `proxy.ts` alone. `[CITED: nvd.nist.gov CVE-2025-29927]` |
| Secret shipped to browser (`NEXT_PUBLIC_APP_PASSWORD`/`_SECRET`) | Information Disclosure | Keep `APP_PASSWORD`/`SESSION_SECRET` server-only; audit for `NEXT_PUBLIC_` prefix (PITFALLS #10) |
| Forged/static auth cookie | Spoofing | Signed JWT (`jose`), not the password or an unsigned value; `httpOnly`+`secure`+`sameSite` |
| Timing attack on password compare | Information Disclosure | `node:crypto.timingSafeEqual` (length-checked), not `===` |
| Public/indexable deploy exposes data | Information Disclosure | (Deploy-phase) Vercel Deployment Protection + `noindex`; out of Phase-1 local scope but note for the eventual deploy |
| Off-plan write via a forgotten path | Tampering | Structural FK (`executions.plan_row_id NOT NULL REFERENCES … RESTRICT`) — DB rejects it regardless of app code (COMP-01) |

## Sources

### Primary (HIGH confidence)
- Drizzle ORM — Get Started with PGlite (`drizzle-orm/pglite`, `drizzle({ client })`, `drizzle.config.ts`, push vs generate+migrate) — https://orm.drizzle.team/docs/get-started/pglite-new — `[CITED]`
- Drizzle ORM — Indexes & Constraints (composite `unique().on(...)`, `index().on(...)`, `foreignKey()`) — https://orm.drizzle.team/docs/indexes-constraints — `[CITED]`
- Drizzle ORM source — `pg-core/foreign-keys.ts` (onDelete values: cascade|restrict|no action|set null|set default) — https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/pg-core/foreign-keys.ts — `[CITED]`
- Drizzle GitHub Discussion #2532 — PGlite + `migrate()` from `drizzle-orm/pglite/migrator`; `driver:'pglite'` for `drizzle-kit migrate`/`studio` — https://github.com/drizzle-team/drizzle-orm/discussions/2532 — `[CITED]`
- Supabase — Drizzle guide (`postgres` driver, `postgres(url,{prepare:false})` for transaction pooler) — https://supabase.com/docs/guides/database/drizzle — `[CITED]`
- PGlite docs — instantiation (`new PGlite('./path')`, in-memory, single exclusive connection) — https://pglite.dev/docs/ — `[CITED]`
- PGlite docs — Bundler Support (Next.js `transpilePackages`) — https://pglite.dev/docs/bundler-support — `[CITED]`
- Next.js 16 blog — `proxy.ts` (Node runtime) replaces `middleware.ts`; async cookies/headers/params; Turbopack default; Node 20.9+; `next lint` removed — https://nextjs.org/blog/next-16 — `[CITED]`
- Next.js docs — Renaming Middleware to Proxy (`proxy` runtime is `nodejs`, not configurable) — https://nextjs.org/docs/messages/middleware-to-proxy & https://nextjs.org/docs/app/api-reference/file-conventions/proxy — `[CITED]`
- Tailwind CSS — Install with Next.js (v4: `@tailwindcss/postcss`, `@import "tailwindcss"`, no config file) — https://tailwindcss.com/docs/guides/nextjs — `[CITED]`
- npm registry (`npm view`, 2026-06-04) — `@electric-sql/pglite` 0.5.1, `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10, `postgres` 3.4.9, `pg` 8.21.0, `next` 16.2.7, `react` 19.2.7, `jose` 6.2.3, `zod` 4.4.3, `tailwindcss` 4.3.0; Drizzle peer-deps include `@electric-sql/pglite >=0.2.0` — `[VERIFIED]`
- NVD — CVE-2025-29927 (Next.js middleware auth bypass; patched 15.2.3+) — https://nvd.nist.gov/vuln/detail/CVE-2025-29927 — `[CITED]`

### Secondary (MEDIUM confidence)
- vercel/next.js issues #84972 (Turbopack WASM) + #65361 (PGlite import outside module code) — Turbopack/PGlite friction — `[CITED]` (open issues; exact fix to confirm via spike)
- PGlite v0.4 announcement (single-user mode, Emscripten no-fork → single connection) — https://electric.ax/blog/2026/03/25/announcing-pglite-v04 — `[CITED]`

### Existing research relied upon (not re-derived)
- `.planning/research/STACK.md`, `ARCHITECTURE.md`, `PITFALLS.md`, `SUMMARY.md` — stack/architecture/pitfalls baseline (with the staleness corrections noted in "State of the Art").

## Metadata

**Confidence breakdown:**
- Standard stack (Phase-1 additions): HIGH — all versions verified on npm 2026-06-04; PGlite/postgres.js import paths + config cited from official docs.
- Dual-driver / migration wiring: HIGH on the cited pieces (import paths, `migrate()`, `prepare:false`); MEDIUM on the synthesized `db/index.ts` glue (A1–A2) — confirm via the opening spike.
- Off-plan schema (Drizzle): HIGH — FK onDelete values, composite unique, index syntax all cited; column modeling is D-01..D-11 verbatim.
- Auth (`proxy.ts` + jose): HIGH — Next-16 proxy/Node-runtime + async cookies cited from the official blog/docs; CVE status cited from NVD.
- Turbopack/PGlite pitfall: MEDIUM-HIGH — documented in open Next.js issues; exact remediation flagged for the spike.

**Research date:** 2026-06-04
**Valid until:** ~2026-07-04 for the Next-16/Tailwind/Drizzle specifics (fast-moving — PGlite and Next 16 both ship frequently; re-verify the Turbopack/PGlite status if planning slips past ~30 days).
