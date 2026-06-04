---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [nextjs, react19, drizzle, pglite, postgres-js, jose, zod, tailwind, auth, turbopack]

# Dependency graph
requires: []
provides:
  - Runnable Next.js 16 app (App Router, React 19, Tailwind v4) on the local machine
  - Dual-driver Drizzle DB seam (lib/db/index.ts) — one DATABASE_URL selects PGlite (local) vs postgres-js (Supabase)
  - Proven live PGlite SELECT 1 round-trip (dbSpike Server Action + db:spike harness)
  - Shared-password auth — jose HS256 session cookie, constant-time password check, login/logout Server Actions, /login page
  - proxy.ts route gate (Next 16) + protected (app) route group with per-render re-verification and Logout
affects: [01-02, plan-upload, actuals-grid, dashboard, export, deploy]

# Tech tracking
tech-stack:
  added:
    - next@16.2.7, react@19.2.7, react-dom@19.2.7
    - drizzle-orm@0.45.2, "@electric-sql/pglite@0.5.1", postgres@3.4.9
    - jose@6.2.3, zod@4.4.3
    - tailwindcss@4.3.0, "@tailwindcss/postcss@4.3.0"
    - "drizzle-kit@0.31.10 (dev), tsx (dev), vitest (dev), typescript (dev)"
  patterns:
    - "Single DATABASE_URL seam: regex /^postgres(ql)?:\\/\\// branches driver; instance cached on globalThis"
    - "Auth = proxy.ts UX gate + per-render/per-action re-verification (proxy is NOT the boundary)"
    - "Server-only secrets via .env.local; .env.example documents them; never NEXT_PUBLIC_"
    - "Relative imports inside lib/ so tsx can run scripts; @/ alias in app/ components"

key-files:
  created:
    - lib/db/index.ts
    - lib/actions/spike.ts
    - lib/db/__smoke__/spike.ts
    - lib/auth/session.ts
    - lib/auth/password.ts
    - lib/actions/auth.ts
    - lib/auth/session.test.ts
    - app/login/page.tsx
    - app/(app)/layout.tsx
    - app/(app)/page.tsx
    - proxy.ts
    - next.config.ts
    - app/layout.tsx
    - app/globals.css
    - postcss.config.mjs
    - tsconfig.json
    - package.json
    - .env.example
  modified:
    - .gitignore

key-decisions:
  - "Hand-crafted the Next 16 scaffold (create-next-app refuses a non-empty repo and would clobber our .gitignore)"
  - "Dev incantation is plain `next dev` (Turbopack); serverExternalPackages:[@electric-sql/pglite] is sufficient — NO --webpack fallback needed"
  - "Cookie Secure flag gated on NODE_ENV===production so http://localhost login works locally (hard secure:true would drop the cookie)"
  - "Password check compares SHA-256 digests via timingSafeEqual (constant-time, no length side-channel) instead of a raw length-guarded compare"
  - "Deferred ESLint flat config (not required by acceptance; Next 16 decouples lint from build) to keep the skeleton lean"
  - "Added tsx + vitest dev deps (beyond the plan's literal Task-1 list) to run TS scripts and the session unit test"

patterns-established:
  - "Dual-driver seam (lib/db/index.ts): local↔cloud is a DATABASE_URL swap, not a code change"
  - "Defense-in-depth auth: every protected render/action re-verifies the jose cookie"
  - "tsx harnesses under lib/db/__smoke__/ prove live-DB behavior the type system can't"

requirements-completed: [ACCESS-01, ACCESS-02]

# Metrics
duration: ~35 min (active; excludes checkpoint wait)
completed: 2026-06-05
---

# Phase 1 Plan 01: Walking Skeleton Summary

**Locally-runnable Next 16 app on embedded PGlite, gated by a jose HS256 shared-password cookie (proxy.ts + per-render re-check), with a proven live SELECT 1 round-trip through a single DATABASE_URL dual-driver Drizzle seam.**

## Performance

- **Duration:** ~35 min active (plus human-verify checkpoint wait)
- **Started:** 2026-06-04T18:37Z (phase begin)
- **Completed:** 2026-06-04T19:10Z
- **Tasks:** 3 auto + 1 human-verify checkpoint (approved)
- **Files modified:** ~20

## Accomplishments
- Next.js 16.2.7 / React 19.2.7 / Tailwind v4 app runs with `npm run dev`, zero cloud dependency
- `lib/db/index.ts` dual-driver seam: one `DATABASE_URL` → PGlite (default `./.pglite`) or postgres-js (Supabase, `prepare:false`), cached on `globalThis`
- Live PGlite round-trip proven: `npm run db:spike` → `{ ok: true, value: 1 }`
- Shared-password gate: jose HS256 session cookie, constant-time password check, login/logout Server Actions, `/login` form with inline errors
- `proxy.ts` route gate registered by Next 16 (`ƒ Proxy`) + `(app)` group re-verifies the cookie server-side every render; Logout clears it
- `vitest` covers session sign/verify + wrong-secret rejection (3/3)

## Task Commits

1. **Task 1: Scaffold + dual-driver DB seam + PGlite spike** — `f1439d2` (feat)
2. **Task 2: Shared-password gate (jose session, login/logout, login page)** — `70626a9` (feat)
3. **Task 3: proxy.ts route gate + protected (app) shell** — `2ee515c` (feat)

Planning artifacts + begin-phase bookkeeping: `64b6368` (docs).
**Plan metadata:** this SUMMARY commit (docs).

## Files Created/Modified
- `lib/db/index.ts` — the single local↔cloud DB seam (dual-driver, globalThis-cached)
- `lib/actions/spike.ts` / `lib/db/__smoke__/spike.ts` — dbSpike Server Action + tsx proof harness
- `lib/auth/session.ts` — jose mint/verify (HS256, 30-day, lazy secret)
- `lib/auth/password.ts` — constant-time digest compare (timingSafeEqual)
- `lib/actions/auth.ts` — login/logout Server Actions (async cookies(), Secure gated on prod)
- `app/login/page.tsx` — useActionState login form
- `proxy.ts` — Next 16 route gate (no DB imports)
- `app/(app)/layout.tsx` / `app/(app)/page.tsx` — protected shell + landing
- `next.config.ts` — serverExternalPackages (PGlite WASM) + turbopack.root pin
- `.env.example`, `.gitignore`, `tsconfig.json`, `postcss.config.mjs`, `app/layout.tsx`, `app/globals.css`

## Decisions Made
See `key-decisions` frontmatter. Headlines: dev runs on Turbopack (no webpack fallback); Secure cookie gated on production for local-first login; password compare via SHA-256 digest + timingSafeEqual.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Hand-crafted the scaffold instead of `create-next-app`**
- **Found during:** Task 1
- **Issue:** `create-next-app .` refuses a non-empty directory (CLAUDE.md, .planning/) and would overwrite our custom `.gitignore`.
- **Fix:** Authored the Next 16 + Tailwind v4 scaffold by hand with exact pinned versions (which the acceptance criteria require).
- **Verification:** `npm run build` compiles; installed versions match the pins exactly.
- **Committed in:** `f1439d2`

**2. [Rule 1 - Bug] Cookie `Secure` gated on production**
- **Found during:** Task 2
- **Issue:** The plan's literal `secure:true` makes browsers silently drop the session cookie on `http://localhost`, breaking local-first login (the phase's whole point).
- **Fix:** `secure: process.env.NODE_ENV === "production"` — Secure on Vercel HTTPS, not on local http.
- **Verification:** Human checkpoint confirmed correct-password login lands on the shell locally.
- **Committed in:** `70626a9`

**3. [Rule 1 - Bug] Constant-time compare via SHA-256 digests**
- **Found during:** Task 2
- **Issue:** A raw length-guarded `timingSafeEqual` still leaks password length via an early return.
- **Fix:** Compare fixed-size SHA-256 digests with `timingSafeEqual` — no value and no length side-channel.
- **Verification:** `timingSafeEqual` present; no `===` on the secret; tests green.
- **Committed in:** `70626a9`

**4. [Rule 2 - Missing Critical] Added `tsx` + `vitest`; pinned `turbopack.root`**
- **Found during:** Tasks 1–2
- **Issue:** Running the spike/smoke TS scripts needs `tsx`; the required session unit test needs `vitest`; a stray `…/Downloads/package-lock.json` made Next infer the wrong workspace root.
- **Fix:** Added `tsx`/`vitest` dev deps; set `turbopack.root: process.cwd()`.
- **Verification:** `npm run db:spike` and `npm run test` pass; the root-inference warning is gone.
- **Committed in:** `f1439d2`, `70626a9`

**5. [Rule 1 - Bug] Temporary `app/page.tsx` then removed**
- **Found during:** Tasks 1 → 3
- **Issue:** Task 1 needs a routable page for a green build, but the `(app)` group (Task 3) also owns `/` — both would conflict.
- **Fix:** Added a temp `app/page.tsx` in Task 1, removed it in Task 3 when `app/(app)/page.tsx` took over `/`.
- **Verification:** Build shows a single `/` route (now `ƒ` dynamic), no conflict.
- **Committed in:** `f1439d2` (add), `2ee515c` (remove)

---

**Total deviations:** 5 auto-fixed (1 blocking, 3 bug-class, 1 missing-critical)
**Impact on plan:** All necessary for a correct, secure, locally-runnable skeleton. ESLint deferral is the only scope reduction; no scope creep.

## Issues Encountered
- First `next build` failed TypeScript on an over-aggressive cast in `spike.ts` (RowList → typed array). Fixed by normalizing the driver result via `unknown`. Re-build clean.

## User Setup Required
None for local dev — `.env.local` is created with working values (`APP_PASSWORD`, a 48-byte `SESSION_SECRET`, `DATABASE_URL=./.pglite`). For deploy, see `.env.example`: set `APP_PASSWORD`, a fresh `SESSION_SECRET`, and the Supabase **pooled** `DATABASE_URL`.

## Next Phase Readiness (contract for Plan 01-02)
- **DB seam:** `lib/db/index.ts` exports `db` (a Drizzle instance), created WITHOUT a schema arg yet. Plan 02 adds `import * as schema from "./schema"` and passes `{ schema }` to both `pgliteDrizzle(client, { schema })` and `postgresDrizzle(client, { schema })`.
- **Migrator wiring:** local `db` is a `drizzle-orm/pglite` instance, so `migrate(db, { migrationsFolder: "./drizzle" })` from `drizzle-orm/pglite/migrator` is the local path; `ensureMigrated()` must no-op when `DATABASE_URL` matches `^postgres(ql)?:\/\//`.
- **Scripts ready:** `db:generate` (drizzle-kit), `db:migrate:local` (placeholder → wire to `tsx lib/db/migrate-cli.ts` in Plan 02), `db:studio`, `test`.
- **drizzle.config.ts** not yet created — Plan 02 Task 2 creates it (dialect postgresql, driver pglite, schema `./lib/db/schema.ts`, out `./drizzle`).

---
*Phase: 01-foundation*
*Completed: 2026-06-05*
