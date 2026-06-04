# Stack Research

**Domain:** Internal marketing-expense compliance tracker — Next.js-on-Vercel data-entry + dashboard app (Excel I/O, editable data grid over lakhs of rows, hybrid relational + jsonb Postgres, shared-password auth, period-scoped datasets). Indian context (₹, states/districts, DD/MM/YY).
**Researched:** 2026-06-04
**Confidence:** HIGH (all versions verified against npm registry + official docs as of 2026-06-04; grid/Excel/DB/ORM choices verified against current advisories and compatibility data)

---

## TL;DR — The Prescriptive Stack

| Layer | Pick | One-line why |
|-------|------|--------------|
| Framework | **Next.js 16 (App Router) + React 19** | Locked by project; current GA, runs first-class on Vercel |
| Hosting | **Vercel (Fluid Compute, default)** | Locked; Fluid keeps functions warm → cheap DB pooling |
| Database | **Neon (Serverless Postgres)** | Vercel-native, scale-to-zero, HTTP driver ideal for serverless; we need plain Postgres + jsonb, not a backend suite |
| DB driver | **`@neondatabase/serverless` 1.1.0** | HTTP/WebSocket, no TCP pool to manage, fast cold first query |
| ORM | **Drizzle ORM 0.45.x + drizzle-kit 0.31.x** | 28× smaller than Prisma, no codegen drift, raw-SQL control for GIN/jsonb, first-class Neon support |
| Data grid | **AG Grid Community 35.x** | MIT, free forever, React-19 supported, virtualization + inline edit + filters built in |
| Excel I/O | **SheetJS CE 0.20.3 — from the SheetJS CDN, NOT npm** | npm `xlsx@0.18.5` has unpatched CVEs; CDN tarball is the only safe source |
| Auth | **Hand-rolled middleware + `jose` 6.x signed JWT cookie** | Single shared password; one small file beats a full auth library |
| Validation | **Zod 4.x** (+ optionally `next-safe-action` 8.x) | Validate Server Action inputs and parsed Excel rows |
| Mutations | **Next.js Server Actions** | In-app grid edits & uploads; no external API consumers exist |
| Styling/UI | **Tailwind CSS 4.x + shadcn/ui** | Standard 2026 Next.js UI baseline for the dashboard/forms |

> **Two non-obvious, load-bearing decisions** flagged here because they will cause real pain if missed: (1) **SheetJS must be installed from the SheetJS CDN tarball, not `npm i xlsx`** — the npm package is stuck at a vulnerable 0.18.5. (2) **Do NOT use Glide Data Grid** despite it being named in the brief — it does not support React 19, which Next 16 ships.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Next.js | **16.2.7** (latest GA) | App framework (App Router), server + UI in one deploy | Locked by PROJECT.md. Current major; Server Actions are mature; native Vercel target. Pin to `16.x`. |
| React | **19.2.x** | UI runtime (ships with Next 16) | Comes with Next 16. **This is why Glide Data Grid is out** (no React 19 support). |
| Vercel | Fluid Compute (default 2026) | Hosting/runtime | Locked. Fluid keeps functions warm long enough to reuse DB connections → connection pooling is cheap and leak-safe. |
| Neon | Serverless Postgres (current platform) | Database — relational off-plan guard + period separation + jsonb measurement fields | Vercel's recommended Postgres (Vercel Postgres *is* Neon under the hood). Scale-to-zero on free tier, instant branching for safe migration testing, HTTP serverless driver. We need a database, not a backend suite — so Neon over Supabase. |
| `@neondatabase/serverless` | **1.1.0** | Postgres driver for serverless/Vercel | Connects over HTTP/WebSocket (~3–4 roundtrips), no TCP connection pool to babysit on serverless. Drizzle lists it as a first-class peer (`>=0.10.0`). |
| Drizzle ORM | **0.45.2** (orm) + **drizzle-kit 0.31.10** (migrations) | Type-safe query layer + schema + migrations | ~7.4 KB gzip vs Prisma's ~1.6 MB runtime → far faster cold starts on Vercel. Schema is plain TypeScript (no `generate` step, no client/schema drift). Thin SQL layer gives the raw control needed for **GIN-indexed jsonb queries** and the FK-based off-plan guard. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| AG Grid Community | **35.3.1** (`ag-grid-community` + `ag-grid-react`) | Editable, virtualized spreadsheet-style grid with filtering | The grid screen. MIT-licensed, free forever, React 19 supported, **row+column virtualization on by default** (handles lakhs of rows), inline cell editing, Text/Number/Date column filters + floating filters out of the box. |
| SheetJS Community Edition (`xlsx`) | **0.20.3** | `.xlsx` read (plan upload) + write (filtered export) | All Excel I/O. **Install from the SheetJS CDN tarball, never the npm registry** (see "What NOT to Use" + Installation). Run parsing on the server (Server Action / Route Handler), not in the browser. |
| `jose` | **6.2.3** | Sign/verify the shared-password session cookie (JWT, HS256) | The auth middleware. Pure-ESM, Edge-runtime compatible (works in Next middleware, unlike `jsonwebtoken`). |
| Zod | **4.4.3** | Runtime validation of Server Action inputs and parsed Excel rows | Validate every grid mutation payload and every imported row before it touches the DB. Pairs with Drizzle types. |
| `next-safe-action` | **8.5.3** | Typed, validated Server Action wrapper (optional) | Use if you want a consistent `{ data, validationErrors, serverError }` contract across many Server Actions. Skip if you prefer hand-written actions + Zod. |
| Tailwind CSS | **4.3.0** | Styling | Dashboard, forms, layout. The default styling layer for new Next.js apps in 2026. |
| shadcn/ui | latest (CLI-generated, copy-in components) | Accessible React UI primitives (dialogs, selects, buttons, tables) | The **multi-item POP/dealer-kit popup**, filter dropdowns, period selector, dashboard cards. Not a dependency you version-pin — components are copied into your repo. |
| TanStack Query (`@tanstack/react-query`) | **5.101.0** | Client cache for grid pages / filter results (optional) | Only if you do client-driven paged fetching with caching/optimistic updates. With Server Actions + `revalidatePath`, you may not need it for v1. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| TypeScript | Type safety end-to-end | ~5.7+. Drizzle's schema-as-types means your DB shape flows into Server Actions and the grid without codegen. |
| drizzle-kit | Generate + run SQL migrations | `drizzle-kit generate` (SQL files) → `drizzle-kit migrate`. Keep migrations in repo; run against a **Neon branch** first to test safely. |
| Drizzle Studio / Neon SQL Editor | Inspect/edit data | Neon console has a SQL editor + table view; Drizzle Studio (`drizzle-kit studio`) gives a local data browser. Covers the "I just want to peek at the table" need that Supabase Studio would otherwise provide. |
| ESLint + Prettier | Lint/format | Standard. `eslint-config-next` ships with the Next app. |
| Vercel CLI | Local dev parity + env management | `vercel env pull` to sync the shared-password and `DATABASE_URL` secrets locally. |

---

## Installation

```bash
# Scaffold (if greenfield)
npx create-next-app@latest marketing-tracker --typescript --eslint --tailwind --app

# Core: DB driver + ORM
npm install @neondatabase/serverless drizzle-orm
npm install -D drizzle-kit

# Data grid (MIT, free)
npm install ag-grid-community ag-grid-react

# Excel I/O — IMPORTANT: from the SheetJS CDN, NOT the npm registry
npm rm xlsx 2>/dev/null || true
npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

# Auth (signed cookie) + validation
npm install jose zod

# Optional: typed Server Actions + client cache
npm install next-safe-action @tanstack/react-query

# UI primitives (shadcn/ui is generated, not a single install)
npx shadcn@latest init
```

**Environment variables (Vercel):**
```
DATABASE_URL=postgres://...-pooler.neon.tech/...   # use the POOLED (-pooler) string
APP_PASSWORD=<the single shared password>
SESSION_SECRET=<random 32+ byte secret for jose JWT signing>
```

---

## Key Decisions, Argued

### 1. Data grid — AG Grid Community, NOT Glide Data Grid (HIGH confidence)

The brief named "Glide Data Grid / TanStack Table" as examples. After verification:

| Grid | License | React 19 | Virtualization | Inline edit | Filtering | Verdict |
|------|---------|----------|----------------|-------------|-----------|---------|
| **AG Grid Community 35.x** | **MIT** | **Yes** (`^19` in peer deps) | **Built-in, on by default** | Built-in | Text/Number/Date + floating filters built-in | **RECOMMENDED** |
| Glide Data Grid 6.0.3 | MIT | **No** — peers cap at `18.x`; open issue #1021 since Feb 2025 | Yes (canvas) | Yes | DIY | **AVOID** — install fails on React 19; `--legacy-peer-deps` is a runtime gamble |
| TanStack Table 8.21.3 (+ TanStack Virtual 3.14.x) | MIT | Yes (`>=16.8`) | Via TanStack Virtual (DIY) | DIY | DIY | Viable alt — headless, smallest bundle, but you build edit/filter/scroll UI yourself |

**Why AG Grid wins for *this* app:** the requirements are "editable + multi-column filter + many rows," which are AG Grid Community's out-of-the-box defaults. Glide is genuinely excellent (and SheetJS even documents a Glide integration) but it is **incompatible with React 19**, which Next 16 ships — a hard blocker, not a preference. TanStack Table is the principled fallback if bundle size becomes critical or AG Grid's look-and-feel is too "enterprise," but it is headless: you implement editing, filtering UI, and wire virtualization yourself, which is materially more work for the exact features AG Grid gives free.

**Caveat to design around (important):** AG Grid's **Set Filter** and **Multi Filter** (the Excel-style checkbox/dropdown facet filters) are **Enterprise-only**. Community gives Text/Number/Date filters + floating filters. For Region/State/District/Distributor/Status — which want dropdown/faceted behavior over lakhs of rows — **do filtering server-side** against the indexed Postgres columns and feed AG Grid a filtered page, rather than loading all rows client-side and relying on the (Enterprise) Set Filter. This is the correct architecture for "lakhs of rows" regardless, so the Community limitation pushes you toward the right design rather than blocking you. (Also: AG Grid's native **Excel export is Enterprise** — route `.xlsx` export through SheetJS instead, which you already have.)

### 2. Excel I/O — SheetJS 0.20.3 from the CDN (HIGH confidence)

PROJECT.md locks SheetJS. The critical, non-obvious detail: **the npm `xlsx` package is abandoned at 0.18.5 (Oct 2024) and carries unpatched advisories** —
- **CVE-2023-30533** — Prototype Pollution on **read** of a crafted `.xlsx`/zip. Fixed in **0.19.3**. This app *reads user-uploaded files*, so the read path is directly in scope.
- **CVE-2024-22363** — ReDoS, also affecting 0.18.5.

The fix versions are published **only via the SheetJS CDN** (`https://cdn.sheetjs.com/`), which the maintainers declare the authoritative source; the GitHub repo and npm package are no longer maintained. So:
```bash
npm install --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
```
Optionally **vendor** the tarball into the repo for build stability (decouples CI from the CDN). Treat uploaded files as untrusted, parse on the server, and validate parsed rows with Zod before insert.

**Why not exceljs:** `exceljs@4.4.0` is **classified Inactive/unmaintained** (no npm release in 12+ months; community forks like `@rmartin93/exceljs-fork` have appeared to carry fixes). For our needs (read 6 known plan layouts, write a filtered export), SheetJS CE — properly sourced — is the better-maintained, lighter choice. Consider exceljs only if you later need rich cell styling/formatting in *exported* workbooks that SheetJS CE doesn't cover.

### 3. Database — Neon over Supabase (MEDIUM-HIGH confidence)

Both are excellent serverless Postgres with PgBouncer pooling, GIN/jsonb, and 1-click Vercel hookups. The deciding factor is **what this app needs**: plain Postgres with a relational off-plan guard, period separation, indexed who/where columns, and a GIN-indexed jsonb column. It does **not** need Supabase's headline extras (Auth — we use a shared password; Realtime — none; Storage — photos are deferred).

- **Neon** is Vercel's recommended/native Postgres (Vercel Postgres is Neon-backed), with scale-to-zero on free tier, the HTTP serverless driver, and **branching** — which is genuinely useful for testing each `drizzle-kit` migration on a throwaway branch before prod.
- **Supabase** shines when you want auth + storage + realtime in one box. We'd be paying complexity for features we explicitly cut. Its built-in table editor (Studio) is the one nicety we'd miss — covered well enough by Drizzle Studio + Neon's SQL editor.

**Recommend Neon.** Reasonable to choose Supabase instead if the team wants the Supabase Studio table-editing UI as an ops console, or anticipates un-deferring photo upload (Supabase Storage) soon — both are valid tie-breakers, not correctness issues.

**Serverless connection handling (the Vercel-specific gotcha):**
- **Default path (recommended): `@neondatabase/serverless` + Drizzle**, using the **pooled** connection string (hostname contains `-pooler`). HTTP transport means no TCP pool to exhaust across serverless invocations.
- **Alternative for Vercel Fluid Compute:** since Fluid (now default) keeps instances warm, you *can* use `pg` (node-postgres) with a real pool, attached via Vercel's **`attachDatabasePool`** hook so idle connections are closed before suspension (prevents leaks). Slightly faster steady-state, slightly more setup. Choose this only if you measure a need; the Neon HTTP driver is the simpler robust default.
- **Never** open a raw unpooled connection per request to the **direct** (non-`-pooler`) string from serverless — that is the classic "too many connections" failure mode.

### 4. ORM — Drizzle over Prisma (HIGH confidence)

For Next.js App Router on Vercel serverless, Drizzle is the clearer fit:
- **Cold starts:** Drizzle's ~7.4 KB gzip core (zero deps) vs Prisma's ~1.6 MB runtime translates to materially faster Vercel function cold starts (reported sub-500 ms vs 1–3 s class differences). Prisma 7 closed much of the gap for serverful Node, but not for cold-start-sensitive serverless.
- **No drift / no codegen:** Drizzle's schema *is* TypeScript — types update instantly, no `prisma generate` step, no "my types are wrong" drift.
- **jsonb + GIN, the heart of this schema:** Drizzle exposes `jsonb()` columns (with `.$type<T>()` for typing the measurement payload) and lets you declare a **GIN index** in-schema:
  ```ts
  import { pgTable, integer, text, jsonb, index } from "drizzle-orm/pg-core";
  import { sql } from "drizzle-orm";

  export const executions = pgTable("executions", {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    // shared who/where columns = REAL indexed columns for fast filter dropdowns
    region: text().notNull(),
    state: text().notNull(),
    district: text().notNull(),
    distributor: text().notNull(),
    sfid: text().notNull(),
    status: text(),
    // activity-specific measurement fields = typed jsonb
    fields: jsonb().$type<Record<string, unknown>>(),
  }, (t) => [
    index("exec_state_idx").on(t.state),
    index("exec_district_idx").on(t.district),
    index("exec_fields_gin").using("gin", t.fields),   // GIN on the jsonb blob
  ]);
  ```
  This is exactly the hybrid model PROJECT.md locked, and the FK from `executions.plan_row_id → plan_rows.id` makes the **off-plan guard structural** (verified Drizzle supports `jsonb()` and `index().using('gin', …)`).

**Choose Prisma instead only if** the team strongly prefers Prisma's schema DSL/Studio and is willing to trade cold-start performance — not the case here.

### 5. Shared-password auth — hand-rolled middleware + `jose`, not an auth library (HIGH confidence)

The requirement is literally "one shared password in an env var, checked by middleware, set a signed cookie." Full auth frameworks (Auth.js/NextAuth, Clerk, Lucia, better-auth) are built for *per-user* identity — overkill and added surface area for a single shared secret.

**Pattern:**
1. A `/login` Server Action compares the submitted password to `process.env.APP_PASSWORD` (constant-time compare).
2. On success, mint a short JWT with **`jose`** (HS256, signed by `SESSION_SECRET`) and set it as an **HttpOnly, Secure, SameSite=Lax** cookie.
3. `middleware.ts` verifies the cookie on every non-public route (`jose` works in the Edge runtime; `jsonwebtoken` does **not**, which is why `jose` is specified).

`iron-session` (8.0.4) is a fine ~one-dependency alternative (encrypted stateless cookie, no manual JWT plumbing). Either is defensible — `jose` keeps deps minimal and is Edge-native; pick `iron-session` if you'd rather not hand-roll cookie/JWT handling. Avoid a full auth provider.

### 6. Mutations — Server Actions, not Route Handlers (HIGH confidence)

2026 guidance is unambiguous for an app with **no external API consumers**: use **Server Actions** for every in-app mutation — grid cell edits, plan upload processing, POP line-item saves — then `revalidatePath`/`revalidateTag` to refresh the view. Benefits: no API boilerplate, end-to-end types, single roundtrip, and built-in CSRF protection (POST-only + Origin/Host check).

Reach for **Route Handlers only** when you need an HTTP endpoint for an *external* caller (webhook, mobile client, public API) or explicit GET caching — none of which exist in v1. **Practical note for the grid:** debounce/batch cell edits and send them as a **single Server Action with an array payload** (validated by Zod) rather than one action per keystroke, to avoid a request storm over lakhs of rows.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| AG Grid Community | TanStack Table 8.x + TanStack Virtual | You need minimal bundle / full control of markup and are willing to build editing, filter UI, and virtualization yourself |
| AG Grid Community | Glide Data Grid | Only on React ≤18 (so: **not** Next 16). Excellent canvas perf for huge editable grids when React 19 isn't required |
| AG Grid Community | MUI X Data Grid | You're already all-in on MUI; note advanced features (and some React 19 fixes) are Pro/paid |
| Neon | Supabase | You want the Supabase Studio table editor as an ops console, or plan to un-defer photo upload via Supabase Storage soon |
| `@neondatabase/serverless` | `pg` + pool + Vercel `attachDatabasePool` | You're on Fluid Compute and measure a steady-state latency win from persistent TCP pooling |
| Drizzle | Prisma 7.x | Team strongly prefers Prisma DSL/Studio and accepts heavier cold starts |
| `jose` (hand-rolled) | `iron-session` 8.x | You'd rather not hand-roll JWT/cookie code; want encrypted stateless sessions in ~one dep |
| Server Actions | Route Handlers | You must expose an endpoint to external/non-browser callers, or need GET response caching |
| SheetJS CE (CDN) | exceljs (or a maintained fork) | You need rich cell styling/formatting in exported workbooks beyond SheetJS CE's scope |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| **`npm install xlsx`** (npm registry) | Frozen at **0.18.5** with unpatched **CVE-2023-30533** (prototype pollution on read — directly relevant since we read uploads) and **CVE-2024-22363** (ReDoS); repo/npm unmaintained | **SheetJS CDN tarball**: `npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` |
| **Glide Data Grid** (for this app) | No React 19 support (peers cap at 18; open issue #1021); Next 16 ships React 19. `--legacy-peer-deps` risks runtime breakage | **AG Grid Community 35.x** (React 19 supported) |
| **AG Grid Enterprise features in Community** (Set Filter, Multi Filter, native Excel export) | Enterprise-licensed; will silently not work / require a paid key | Server-side filtering on indexed columns; export via **SheetJS** |
| **exceljs** as primary Excel lib | `4.4.0` classified **Inactive/unmaintained** (no release 12+ months); fixes only in community forks | **SheetJS CE** (CDN) |
| **`jsonwebtoken`** for the session cookie | Not compatible with the Edge runtime used by Next middleware | **`jose`** (Edge-native) |
| **NextAuth/Auth.js, Clerk, Lucia** for this auth | Built for per-user identity; heavy for a single shared password | Hand-rolled middleware + `jose` (or `iron-session`) |
| **Prisma on Vercel serverless** (here) | Larger runtime → slower cold starts; codegen drift; less direct control over GIN/jsonb SQL | **Drizzle ORM** |
| **Raw unpooled DB connections per request** from serverless | Exhausts Postgres connection limits ("too many clients") | Neon **pooled** (`-pooler`) string via the serverless driver |
| **Putting all rows client-side + Set Filter** | Lakhs of rows in the browser = memory/perf failure; Set Filter is Enterprise anyway | **Server-side filter/paginate** on indexed columns, AG Grid renders the page |
| **`react-data-grid` (adazzle)** | Smaller community/feature set vs AG Grid for editable+filter+virtualized at scale | AG Grid Community |

---

## Stack Patterns by Variant

**If the grid must edit lakhs of rows fluidly:**
- Server-side row model: filter/sort/paginate in Postgres against indexed who/where columns; hand AG Grid a page.
- Batch cell edits into one Zod-validated Server Action (array payload), debounced — never one request per keystroke.
- Because: avoids loading all rows client-side and sidesteps AG Grid's Enterprise-only faceted filters.

**If you later un-defer photo/proof-image upload:**
- Add Vercel Blob or Supabase Storage; this is the main scenario that would tip the DB choice toward Supabase.
- Because: object storage + signed URLs is the missing piece; keep it out of Postgres.

**If steady-state DB latency on Vercel matters more than cold start:**
- Switch from `@neondatabase/serverless` (HTTP) to `pg` + pool + `attachDatabasePool` on Fluid Compute.
- Because: persistent TCP connection reuse shaves per-query setup once the function is warm.

**If you want a stricter Server Action contract across many actions:**
- Adopt `next-safe-action` 8.x for uniform `{ data, validationErrors, serverError }`.
- Because: consistent error handling and Zod-input typing without repeating boilerplate.

---

## Version Compatibility

| Package | Version (verified 2026-06-04) | Compatible With | Notes |
|---------|-------------------------------|-----------------|-------|
| next | 16.2.7 | react 19.2.x | Pin `16.x`. App Router + Server Actions GA. |
| react / react-dom | 19.2.7 | next 16 | The reason Glide Data Grid is excluded. |
| ag-grid-community / ag-grid-react | 35.3.1 | react ^16.8 / 17 / 18 / **19** | Mark grid component `"use client"`; register modules via `ModuleRegistry.registerModules([...])` or `AgGridProvider` (v35.1+) **before** instantiation. |
| xlsx (SheetJS CE) | **0.20.3** | Node 18+/serverless | **CDN tarball only.** Parse server-side. |
| drizzle-orm | 0.45.2 | `@neondatabase/serverless` ≥0.10.0, `pg` ≥8, `postgres` ≥3 | Peer list confirms first-class Neon + node-postgres support. |
| drizzle-kit | 0.31.10 | drizzle-orm 0.45.x | `generate` → `migrate`; test on a Neon branch. |
| @neondatabase/serverless | 1.1.0 | drizzle-orm 0.45.x | Use the **pooled** (`-pooler`) connection string. |
| jose | 6.2.3 | Next 16 Edge middleware | Edge-runtime compatible (unlike `jsonwebtoken`). |
| zod | 4.4.3 | next-safe-action 8.x, Drizzle | v4 is current major; validate actions + parsed rows. |
| next-safe-action | 8.5.3 | Next 16 Server Actions, zod 4 | Optional wrapper. |
| tailwindcss | 4.3.0 | Next 16 | v4 engine; standard new-app baseline. |
| @tanstack/react-table | 8.21.3 | react ≥16.8 (incl. 19) | Only if choosing the headless-grid path. |
| @tanstack/react-virtual | 3.14.2 | react ≥16.8 | Pairs with TanStack Table for virtualization. |
| iron-session | 8.0.4 | Next 16 | Alternative to hand-rolled `jose` cookie. |

---

## Sources

- npm registry (`npm view …`, 2026-06-04) — verified current versions: next 16.2.7, react 19.2.7, drizzle-orm 0.45.2, drizzle-kit 0.31.10, prisma 7.8.0, ag-grid 35.3.1, @glideapps/glide-data-grid 6.0.3 (peers cap at React 18), @tanstack/react-table 8.21.3, @tanstack/react-virtual 3.14.2, @neondatabase/serverless 1.1.0, @supabase/supabase-js 2.107.0, jose 6.2.3, iron-session 8.0.4, zod 4.4.3, next-safe-action 8.5.3, tailwindcss 4.3.0, xlsx (npm) 0.18.5. — **HIGH**
- SheetJS docs — installation (standalone + Node.js): current CE **0.20.3**, CDN is authoritative source, npm is outdated. `docs.sheetjs.com/docs/getting-started/installation/` — **HIGH**
- SheetJS advisory **CVE-2023-30533** (`cdn.sheetjs.com/advisories/CVE-2023-30533`) + GitHub Advisory GHSA-4r6h-8v6p-xvw6; **CVE-2024-22363** (ReDoS) — fixed only in CE ≥0.19.3 via CDN. — **HIGH**
- Context7 `/drizzle-team/drizzle-orm-docs` — verified `jsonb()` column type and `index().using('gin', …)` GIN-index syntax. — **HIGH**
- glideapps/glide-data-grid issue **#1021** (React 19.x support, open since Feb 2025) — confirms React 19 incompatibility. — **HIGH**
- AG Grid docs — License & Pricing (Community = **MIT**, free), Community vs Enterprise (Set/Multi Filter, Excel export are Enterprise), React compatibility (incl. 19), Modules/ModuleRegistry + Next.js App Router (`"use client"`). `ag-grid.com/license-pricing/`, `/javascript-data-grid/community-vs-enterprise/`, `/react-data-grid/modules/` — **HIGH**
- Neon docs — Vercel connection methods, serverless driver (HTTP/WebSocket), pooled (`-pooler`) connection strings. `neon.com/docs/guides/vercel-connection-methods`, `/docs/serverless/serverless-driver` — **HIGH**
- Vercel KB — connection pooling with Functions / Fluid Compute (`attachDatabasePool`, `waitUntil`). `vercel.com/kb/guide/efficiently-manage-database-connection-pools-with-fluid-compute` — **HIGH**
- Next.js docs — Server Actions and Mutations (POST-only, CSRF Origin/Host check); 2026 Server-Actions-vs-Route-Handlers guidance (use Actions for in-app mutations, Route Handlers for external callers). `nextjs.org/docs` + corroborating practitioner write-ups — **HIGH (official) / MEDIUM (practitioner synthesis)**
- exceljs maintenance — GitHub discussion #2987 + Snyk "Inactive" classification + issue #2969 (no release 12+ months; community forks exist). — **MEDIUM-HIGH**
- Drizzle vs Prisma serverless benchmarks/comparisons (bundle ~7.4 KB vs ~1.6 MB; cold-start deltas) — multiple 2026 comparison articles, directionally consistent. — **MEDIUM** (corroborated by Drizzle's own zero-dep/serverless-ready positioning — HIGH on the architectural claim, MEDIUM on exact ms figures)
- Neon vs Supabase 2026 comparisons (Vercel-native Neon, PgBouncer pooling, when to pick each) — multiple 2026 sources, consistent. — **MEDIUM-HIGH**

---
*Stack research for: internal marketing-expense compliance tracker (Next.js 16 / Vercel / Neon Postgres + jsonb / AG Grid / SheetJS)*
*Researched: 2026-06-04*
