# Walking Skeleton — Marketing Expense Tracker

**Phase:** 1
**Generated:** 2026-06-04

## Capability Proven End-to-End

A user enters the shared password on `/login`, receives a `jose`-signed `httpOnly` session cookie, is admitted past the `proxy.ts` gate to the protected app shell, and the running server proves a real round-trip to the embedded PGlite database (a Server Action executes `SELECT 1` and returns the result) — the entire stack runs on a local machine with `npm run dev`, no cloud dependency.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16.2.7 (App Router) + React 19.2.x | Locked by PROJECT.md; `proxy.ts` (Node runtime) + Server Actions are the mutation/gate model. |
| Bundler | Turbopack (default), `@electric-sql/pglite` in `serverExternalPackages`; `next dev --webpack` fallback | PGlite uses dynamic WASM resolution Turbopack does not fully support (RESEARCH Pitfall 2 / Open Q1) — spike locks the incantation. |
| Data layer (local) | `@electric-sql/pglite` 0.5.1 via `drizzle-orm/pglite`, on-disk `./.pglite`, single `globalThis` connection | D-14 local-first; real Postgres semantics identical to Supabase; single-connection requires the singleton. |
| Data layer (prod) | Supabase via `postgres` 3.4.9 (`postgres(url,{prepare:false})`, transaction pooler `:6543`) | D-14 deploy = `DATABASE_URL` swap only; `prepare:false` is required for the transaction pooler. |
| DB seam | One `lib/db/index.ts` branches on `DATABASE_URL` (`postgres://` → Supabase, else → PGlite path) | The single seam between local and cloud; Drizzle schema byte-identical across both. |
| ORM / migrations | Drizzle ORM 0.45.2 + drizzle-kit 0.31.10; one `drizzle-kit generate` SQL source → `migrate()` (PGlite) + `drizzle-kit migrate` (Supabase) | One migration source of truth applied to both DBs (RESEARCH Pattern 2). |
| Auth | Shared password in `APP_PASSWORD` env, constant-time `timingSafeEqual`; `jose` HS256 JWT in `httpOnly`+`secure`+`sameSite=lax` cookie, 30-day sliding (D-12/D-13) | Single trusted team; one small file beats an auth library; `proxy.ts` gate + per-Server-Action re-check (defense-in-depth, CVE-2025-29927). |
| Validation | Zod 4.4.3 on every Server Action input | Locked; pairs with Drizzle types. |
| Styling | Tailwind CSS 4.3.0 (CSS-first, `@import "tailwindcss"`, no config file) | Scaffold default for Next 16. |
| Directory layout | `app/(app)/*` protected group + `app/login`; `lib/activities/` (registry), `lib/db/`, `lib/auth/`, `lib/actions/`; `proxy.ts`; `drizzle/` | Per RESEARCH "Recommended Project Structure" (subset of ARCHITECTURE.md). |

## Stack Touched in Phase 1

- [x] Project scaffold (Next 16 App Router, TypeScript, Tailwind v4, ESLint flat config)
- [x] Routing — `/login` (public) and `/(app)` protected group gated by `proxy.ts`
- [x] Database — one real read (`SELECT 1` spike) AND one real write (insert+select a period; item-master row) plus the [BLOCKING] migrate-to-PGlite proof
- [x] UI — interactive login form wired to the `login` Server Action that mints the cookie; period + item management forms wired to Server Actions
- [x] Deployment — documented local full-stack run (`npm run dev`, `npm run db:migrate:local`); Supabase/Vercel deploy is a documented `DATABASE_URL` swap, NOT performed in Phase 1 (D-14)

## Out of Scope (Deferred to Later Slices)

- Excel plan upload / template download / header validation / preview / commit (Phase 2 — PLAN-01..06, COMP-02)
- The editable AG Grid, inline actuals entry, filtering, POP multi-item popup, derived-total computation at the cell level (Phase 3 — GRID-01..08)
- Compliance "% executed" math + the dashboard (Phase 4 — COMP-03, DASH-01..04)
- Excel export (Phase 5 — EXPT-01)
- Supabase provisioning, Vercel deploy, Deployment Protection, nightly `pg_dump` backups (deploy-time; out of local Phase 1 scope)
- SheetJS, AG Grid, shadcn/ui installation (belong to Phases 2/3 — Phase 1 stays lean)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- **Phase 2 — Plan Upload & Periods:** a user loads an approved Excel plan for an activity + period; rows become the allowed-SFID master list; non-destructive re-upload (the `ON DELETE RESTRICT` FK from this phase makes that structural).
- **Phase 3 — Actuals Grid:** a user records on-ground executions in an editable grid against the plan rows; multi-unit per dealer; POP line items; derived totals computed app-side and persisted to the plain numeric columns defined this phase.
- **Phase 4 — Compliance & Dashboard:** "% plan executed" + budget-vs-spend over the active period, reading the same `period_id`-scoped schema and registry.
- **Phase 5 — Excel Export:** export the filtered grid to `.xlsx` reusing the registry column order built this phase.
