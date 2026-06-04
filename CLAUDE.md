<!-- GSD:project-start source:PROJECT.md -->
## Project

**Marketing Expense Tracker**

A web-based marketing-expense tracker for a small JSW marketing team, built on Next.js and deployed on Vercel. It loads an approved marketing plan (per activity, per period) and records the actual on-ground executions against it — measurements, costs, status, location — all keyed on Salesforce ID (SFID). It shows how much of the plan has been executed and how much has been spent, and it prevents spend being recorded against dealers that aren't in the plan.

**Core Value:** Spend stays inside the plan, and execution progress is always visible. Only SFIDs present in the uploaded plan can receive actuals (off-plan entries are rejected), and "% of plan executed" is the headline compliance metric.

### Constraints

- **Tech stack**: Next.js (App Router) on Vercel — single-app deploy, server + UI together
- **Database**: Postgres (Supabase or Neon) — relational model enforces the off-plan guard and period separation; free tier + 1-click Vercel hookup
- **Excel I/O**: SheetJS (`xlsx`) for `.xlsx` import and export
- **Auth**: single shared password stored as a Vercel env var, checked by middleware, sets a signed cookie — no user accounts in v1
- **UI**: editable data-grid component (e.g. Glide Data Grid / TanStack Table) for the spreadsheet feel
- **Extensibility**: activities defined in a typed config registry, so adding a 7th activity is a data change, not a code change
- **Region/locale**: Indian context — ₹ currency, Indian states/districts, DD/MM/YY dates
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## Technology Stack

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
## Installation
# Scaffold (if greenfield)
# Core: DB driver + ORM
# Data grid (MIT, free)
# Excel I/O — IMPORTANT: from the SheetJS CDN, NOT the npm registry
# Auth (signed cookie) + validation
# Optional: typed Server Actions + client cache
# UI primitives (shadcn/ui is generated, not a single install)
## Key Decisions, Argued
### 1. Data grid — AG Grid Community, NOT Glide Data Grid (HIGH confidence)
| Grid | License | React 19 | Virtualization | Inline edit | Filtering | Verdict |
|------|---------|----------|----------------|-------------|-----------|---------|
| **AG Grid Community 35.x** | **MIT** | **Yes** (`^19` in peer deps) | **Built-in, on by default** | Built-in | Text/Number/Date + floating filters built-in | **RECOMMENDED** |
| Glide Data Grid 6.0.3 | MIT | **No** — peers cap at `18.x`; open issue #1021 since Feb 2025 | Yes (canvas) | Yes | DIY | **AVOID** — install fails on React 19; `--legacy-peer-deps` is a runtime gamble |
| TanStack Table 8.21.3 (+ TanStack Virtual 3.14.x) | MIT | Yes (`>=16.8`) | Via TanStack Virtual (DIY) | DIY | DIY | Viable alt — headless, smallest bundle, but you build edit/filter/scroll UI yourself |
### 2. Excel I/O — SheetJS 0.20.3 from the CDN (HIGH confidence)
- **CVE-2023-30533** — Prototype Pollution on **read** of a crafted `.xlsx`/zip. Fixed in **0.19.3**. This app *reads user-uploaded files*, so the read path is directly in scope.
- **CVE-2024-22363** — ReDoS, also affecting 0.18.5.
### 3. Database — Neon over Supabase (MEDIUM-HIGH confidence)
- **Neon** is Vercel's recommended/native Postgres (Vercel Postgres is Neon-backed), with scale-to-zero on free tier, the HTTP serverless driver, and **branching** — which is genuinely useful for testing each `drizzle-kit` migration on a throwaway branch before prod.
- **Supabase** shines when you want auth + storage + realtime in one box. We'd be paying complexity for features we explicitly cut. Its built-in table editor (Studio) is the one nicety we'd miss — covered well enough by Drizzle Studio + Neon's SQL editor.
- **Default path (recommended): `@neondatabase/serverless` + Drizzle**, using the **pooled** connection string (hostname contains `-pooler`). HTTP transport means no TCP pool to exhaust across serverless invocations.
- **Alternative for Vercel Fluid Compute:** since Fluid (now default) keeps instances warm, you *can* use `pg` (node-postgres) with a real pool, attached via Vercel's **`attachDatabasePool`** hook so idle connections are closed before suspension (prevents leaks). Slightly faster steady-state, slightly more setup. Choose this only if you measure a need; the Neon HTTP driver is the simpler robust default.
- **Never** open a raw unpooled connection per request to the **direct** (non-`-pooler`) string from serverless — that is the classic "too many connections" failure mode.
### 4. ORM — Drizzle over Prisma (HIGH confidence)
- **Cold starts:** Drizzle's ~7.4 KB gzip core (zero deps) vs Prisma's ~1.6 MB runtime translates to materially faster Vercel function cold starts (reported sub-500 ms vs 1–3 s class differences). Prisma 7 closed much of the gap for serverful Node, but not for cold-start-sensitive serverless.
- **No drift / no codegen:** Drizzle's schema *is* TypeScript — types update instantly, no `prisma generate` step, no "my types are wrong" drift.
- **jsonb + GIN, the heart of this schema:** Drizzle exposes `jsonb()` columns (with `.$type<T>()` for typing the measurement payload) and lets you declare a **GIN index** in-schema:
### 5. Shared-password auth — hand-rolled middleware + `jose`, not an auth library (HIGH confidence)
### 6. Mutations — Server Actions, not Route Handlers (HIGH confidence)
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
## Stack Patterns by Variant
- Server-side row model: filter/sort/paginate in Postgres against indexed who/where columns; hand AG Grid a page.
- Batch cell edits into one Zod-validated Server Action (array payload), debounced — never one request per keystroke.
- Because: avoids loading all rows client-side and sidesteps AG Grid's Enterprise-only faceted filters.
- Add Vercel Blob or Supabase Storage; this is the main scenario that would tip the DB choice toward Supabase.
- Because: object storage + signed URLs is the missing piece; keep it out of Postgres.
- Switch from `@neondatabase/serverless` (HTTP) to `pg` + pool + `attachDatabasePool` on Fluid Compute.
- Because: persistent TCP connection reuse shaves per-query setup once the function is warm.
- Adopt `next-safe-action` 8.x for uniform `{ data, validationErrors, serverError }`.
- Because: consistent error handling and Zod-input typing without repeating boilerplate.
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
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
