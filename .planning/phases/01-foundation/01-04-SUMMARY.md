---
phase: 01-foundation
plan: 04
subsystem: periods
tags: [periods, server-actions, zod, drizzle-transactions, useActionState, switcher, playwright, PRD-01, PRD-02]

# Dependency graph
requires:
  - phase: 01-02
    provides: periods table + period_type enum + db.transaction support
  - phase: 01-01
    provides: jose-gated (app) shell with the reserved period-switcher slot; lib/auth/session.ts; Server Action pattern
provides:
  - createPeriod + setActivePeriod Server Actions (Zod-validated, auth-rechecked) and the setActivePeriodForm wrapper for <form action={...}> use
  - Transactional setActiveTx enforcing exactly-one-active (D-11) under MVCC
  - /periods management page (list + add form + "Make active" buttons)
  - PeriodSwitcher mounted in the (app) layout's reserved data-slot, auto-submits on change
  - getActivePeriod() — the PRD-02 server-side scoping seam Phase 2+ filters reads on
  - Playwright E2E harness for the periods flow (3 specs, Chromium)
affects: [plan-upload, actuals-grid, dashboard, export]

# Tech tracking
tech-stack:
  added:
    - "@playwright/test (dev; covers UI flows vitest can't)"
  patterns:
    - "Server Action with useActionState shape AND a thin form-action wrapper, so <form action={fn}> calls also work"
    - "Server Component data fetch + tiny Client child for event handlers — keeps the bundle slim"
    - "Playwright webServer command wipes .pglite/ before `next dev` launches — PGlite WASM FS and on-disk start aligned (avoids 58P01 race)"
    - "test/smoke helper `_resetPeriodsForTest` lives in lib/db/periods.ts (truncate; never call from app code)"

key-files:
  created:
    - lib/db/periods.ts
    - lib/actions/periods.ts
    - lib/actions/periods.test.ts
    - lib/periods/active.ts
    - app/(app)/periods/page.tsx
    - app/(app)/periods/period-form.tsx
    - app/(app)/period-switcher.tsx
    - app/(app)/period-switcher-select.tsx
    - lib/db/__smoke__/active-period.ts
    - playwright.config.ts
    - e2e/periods.spec.ts
    - e2e/login.spec.ts
    - vitest.config.ts
  modified:
    - app/(app)/layout.tsx
    - package.json (added periods:smoke + e2e scripts; @playwright/test dev dep)
    - .gitignore (Playwright artifacts)

key-decisions:
  - "D-11 enforced by setActiveTx (clear-all then set-one inside db.transaction) — under MVCC a reader never observes two active rows"
  - "Tests hit live PGlite (single shared db instance) — beforeEach wipes via the test helper, mocks cover next/headers + next/cache so Server Actions can be invoked"
  - "Server Components cannot carry onChange — PeriodSwitcher is split: Server Component for the data fetch, tiny PeriodSwitcherSelect Client child for the auto-submit handler"
  - "Playwright wipes .pglite/ INSIDE the webServer command (sync, pre-launch) — globalSetup was too far from the boot to be deterministic"
  - "Period switcher auto-submit re-renders the (app) shell; the authoritative D-11 check counts active-marker pills on /periods (not the switcher's defaultValue render)"

patterns-established:
  - "Server Action duo: useActionState-shape primary + form-action wrapper, in the same file"
  - "Playwright E2E lives under e2e/, vitest excludes it via vitest.config.ts include/exclude"
  - "Tests against PGlite use ensureMigrated() + a reset helper for isolation"

requirements-completed: [PRD-01, PRD-02]

# Metrics
duration: ~45 min
completed: 2026-06-05
---

# Phase 1 Plan 04: Periods + D-11 Single-Active Invariant Summary

**Period create + active-toggle wired end-to-end behind the auth gate: Zod-validated Server Actions, transactional single-active invariant (D-11) proven both in vitest and against live PGlite, and a Playwright-verified Server-Component switcher mounted in the (app) layout's reserved data-slot.**

## Performance
- **Duration:** ~45 min (incl. Playwright setup + E2E race debug)
- **Completed:** 2026-06-05
- **Tasks:** 3 auto
- **Files modified:** 13 + 3 edits

## Accomplishments
- `createPeriod` validates type (z.enum), label, ISO dates + endDate ≥ startDate refine, optional makeActive; re-checks the jose cookie inside the action (defense-in-depth, CVE-2025-29927)
- `setActiveTx` is the load-bearing piece: a single `db.transaction` that clears every `is_active` then sets the target — under MVCC no concurrent reader ever observes two active rows (D-11)
- /periods page lists periods, marks the active one with a `data-slot="active-marker"` pill, lets the user create one (Client form `useActionState`) and flip active via a per-row form
- PeriodSwitcher mounts in the layout's reserved slot (data-slot preserved), Server Component fetches + Client child auto-submits on change
- `getActivePeriod()` exported from `lib/periods/active.ts` — the PRD-02 scoping seam Phase 2 reads will filter on
- Playwright harness (Chromium) added; 3 periods E2E specs prove the flow drives correctly against the real browser

## Task Commits
1. **Task 1: queries + Server Actions + vitest** — `fb158c2` (feat) — 7 specs added, 18/18 total green
2. **Task 2: UI + switcher + Playwright E2E** — `e353943` (feat) — 6/6 e2e green
3. **Task 3: [BLOCKING] D-11 live-DB smoke** — `f6a…` (feat) — smoke exits 0 with `D-11 PROVEN: exactly one active period (id=N)`

Plus: Playwright harness commit `619d5cd` (login e2e) landed before Task 1.

## Files Created/Modified
- `lib/db/periods.ts` — listPeriods / insertPeriod / getActivePeriodRow / setActiveTx / `_resetPeriodsForTest`
- `lib/actions/periods.ts` — createPeriod + setActivePeriod (Zod, requireSession, revalidatePath) + setActivePeriodForm wrapper
- `lib/actions/periods.test.ts` — 7 specs against live PGlite (mocks: next/headers + next/cache + verifySession)
- `lib/periods/active.ts` — getActivePeriod() Phase-2 seam
- `app/(app)/periods/page.tsx` + `period-form.tsx` — management page + Client create form
- `app/(app)/period-switcher.tsx` + `period-switcher-select.tsx` — Server + Client split for the switcher
- `app/(app)/layout.tsx` — replaced placeholder with `<PeriodSwitcher />`, added a small nav
- `lib/db/__smoke__/active-period.ts` — D-11 live-DB proof
- `playwright.config.ts`, `e2e/login.spec.ts`, `e2e/periods.spec.ts`, `vitest.config.ts` — split harnesses
- `package.json`: added `e2e`, `periods:smoke` scripts; `@playwright/test` dev dep
- `.gitignore`: Playwright outputs

## Decisions Made
See `key-decisions` frontmatter. Headline: D-11 is a *transactional* invariant, not just an app-level rule — clear-all-then-set-one inside `db.transaction` makes the "two active" state literally unobservable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Server Action signature didn't fit `<form action={fn}>`**
- **Found during:** Task 2 build
- **Issue:** Actions exported with `useActionState` shape `(prev, FormData) → state` don't satisfy the `<form action>` type `(FormData) → void`.
- **Fix:** Added a thin `setActivePeriodForm(formData)` wrapper that delegates. Server Component callers (page + switcher) use the wrapper; the Client form keeps the original.
- **Verification:** `npm run build` green; both call sites type-check.
- **Committed in:** `e353943`

**2. [Rule 1 - Bug] `.returning({ id })` rejected by the dual-driver `db` union type**
- **Found during:** Task 1 build
- **Issue:** Drizzle's `.returning(...)` overload differs between the PGlite and postgres-js drivers; the union doesn't accept an argument shape.
- **Fix:** Bare `.returning()` then read `(row as { id }).id`.
- **Verification:** `npm run build` green; tests pass.
- **Committed in:** `fb158c2`

**3. [Rule 1 - Bug] PGlite WASM FS desynced from disk under Playwright globalSetup**
- **Found during:** Task 2 E2E
- **Issue:** `globalSetup` wiped `.pglite/` but the gap between that and `next dev` launching let Turbopack re-import `lib/db/index.ts` and reconnect to a half-state, producing Postgres 58P01 (`could not open file base/5/...`).
- **Fix:** Moved the wipe INSIDE the webServer command (`node -e ... && npm run dev`) so it's atomic with the launch; dropped globalSetup.
- **Verification:** 6/6 E2E green deterministically.
- **Committed in:** `e353943`

**4. [Rule 1 - Bug] Vitest picked up Playwright spec under e2e/**
- **Found during:** Task 1
- **Issue:** Vitest's default discovery ran into Playwright's `test()` and threw `Playwright Test did not expect test() to be called here`.
- **Fix:** Added `vitest.config.ts` with `include: lib/**/*.test.*` and `exclude: e2e/**`.
- **Verification:** 18/18 vitest green; Playwright owns e2e/.
- **Committed in:** `fb158c2`

**5. [Rule 1 - Bug] Switcher D-11 assertion was reading the wrong DOM**
- **Found during:** Task 2 E2E
- **Issue:** Reading the switcher's `<option:checked>` after an auto-submit cycle was flaky (defaultValue + re-render timing). The test as-written was implementation-coupled.
- **Fix:** Use the authoritative /periods active-marker count + p2 row check — the invariant itself, not its UI sugar.
- **Verification:** D-11 E2E green.
- **Committed in:** `e353943`

---
**Total deviations:** 5 auto-fixed (4 bug-class, 1 test-harness)
**Impact on plan:** None to scope. All necessary for a correct, deterministic UI + test surface.

## Issues Encountered
- Spent a cycle chasing the 58P01 error before finding the FS/launch race — captured the lesson in `key-decisions` for future plans that mutate `.pglite/` from tooling.

## User Setup Required
None. `npm run e2e` works locally out of the box; the run wipes its own `.pglite/` first.

## Next Phase Readiness
- PRD-01/02 closed: 8/9 phase requirements now met; only ACTV-04 (item-master management) remains, scoped to Plan 01-05.
- Phase 2 plan upload now has a real PRD-02 seam: `getActivePeriod()` returns the scoping `period_id`; the import path will `WHERE period_id = active.id` on every read.

---
*Phase: 01-foundation*
*Completed: 2026-06-05*
