---
phase: 01-foundation
plan: 03
subsystem: activities
tags: [activity-registry, config, typescript, framework-free, ACTV-01, ACTV-02, ACTV-03]

# Dependency graph
requires:
  - phase: 01-02
    provides: plan_rows shared who/where columns the `shared:true` FieldDef flag maps to
provides:
  - Typed activity config registry under lib/activities/ — six activities as configs (ACTV-01)
  - Per-activity planColumns / actualColumns (FieldDef[]) with type discriminator and computeFrom (ACTV-02)
  - Extensible by config: a 7th activity is a one-entry record-spread (ACTV-03)
affects: [plan-upload, actuals-grid, dashboard, export]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Framework-free TypeScript module: no react/next/drizzle/node: imports — registry safe on both client and server (D-15)"
    - "`as const satisfies ActivityConfig` for exhaustive column type-checking against the contract"
    - "Public barrel (lib/activities/index.ts) is the single stable import surface"

key-files:
  created:
    - lib/activities/types.ts
    - lib/activities/registry.ts
    - lib/activities/index.ts
    - lib/activities/counter-wall.ts
    - lib/activities/gsb.ts
    - lib/activities/nlb.ts
    - lib/activities/in-shop.ts
    - lib/activities/pop-dealer-kit.ts
    - lib/activities/dealer-certificate.ts
    - lib/activities/registry.test.ts
    - lib/activities/__smoke__/registry.ts
  modified:
    - package.json (added one script: activities:smoke)

key-decisions:
  - "shared:true on who/where FieldDefs is the seam Phase-2 import uses to route values to real plan_rows columns vs the jsonb fields tail"
  - "Computed columns declare computeFrom (string[]) — the formula lives in the grid (Phase 3), not in the registry"
  - "ActivityKey is a closed literal union; adding a 7th means widening the union AND the record entry (proven by the spread smoke)"
  - "getActivity returns undefined (not throw) so callers treat resolution as an Option type — Phase-2 import surfaces unknown-activity rows as errors"

patterns-established:
  - "Activity configs live one-per-file under lib/activities/, default-exported via `as const satisfies ActivityConfig`"
  - "Registry imports each config statically; the by-key Record<...> means the resolver never grows with new activities"
  - "tsx __smoke__/ harnesses prove behaviors the type system can't (here: extensibility under spread)"

requirements-completed: [ACTV-01, ACTV-02, ACTV-03]

# Metrics
duration: ~15 min
completed: 2026-06-05
---

# Phase 1 Plan 03: Activity Config Registry Summary

**Framework-free typed activity registry — six activities (Counter Wall Painting, GSB, NLB, In-shop Branding, POP/Dealer Kit, Dealer Certificate) declared as one config module each, resolved by key, with extensibility (ACTV-03) proven by record-spread smoke against an unchanged registry.ts.**

## Performance
- **Duration:** ~15 min
- **Completed:** 2026-06-05
- **Tasks:** 3 (TDD red → green → smoke)
- **Files modified:** 11 + 1 script line

## Accomplishments
- All six activities exist as config entries declaring `planColumns`/`actualColumns` (verbatim from PROJECT.md) and a `type` discriminator (measurement / item-list / status)
- Shared who/where FieldDefs flagged `shared:true` — the Phase-2-import routing seam between real `plan_rows` columns and the jsonb `fields` tail
- Computed columns declare `computeFrom` (e.g. `totalCost` ← `[actualSqft, perUnitCost]`) — declarative, formula in consumers
- `lib/activities/__smoke__/registry.ts` proves a synthetic 7th activity resolves purely via `{ ...ACTIVITIES, 'x': seventh }` — `registry.ts` is byte-identical after the smoke (`git diff` empty)
- 11/11 vitest pass (3 session + 8 registry); `npm run build` clean; zero new dependencies

## Task Commits
1. **Task 1 (RED): types + spec** — `f7…` `test(01-03)` (RED commit; spec fails because `./index` not yet wired)
2. **Task 2 (GREEN): six configs + registry + barrel** — `feat(01-03)` (spec goes green; build clean)
3. **Task 3: extensibility smoke** — `feat(01-03)` (ACTV-03 proven; registry.ts unchanged)

## Files Created/Modified
- `lib/activities/types.ts` — ActivityType / FieldKind / FieldDef / ActivityConfig / ActivityKey
- `lib/activities/counter-wall.ts`, `gsb.ts`, `nlb.ts`, `in-shop.ts`, `pop-dealer-kit.ts`, `dealer-certificate.ts` — one config each
- `lib/activities/registry.ts` — ACTIVITIES record, ACTIVITY_KEYS, getActivity
- `lib/activities/index.ts` — public barrel
- `lib/activities/registry.test.ts` — vitest spec
- `lib/activities/__smoke__/registry.ts` — ACTV-03 proof
- `package.json` — added `activities:smoke` script (no dep change)

## Decisions Made
- Closed `ActivityKey` literal union — adding a 7th is a deliberate, type-checked widening (the smoke documents the shape).
- `as const satisfies ActivityConfig` so the column transcription is exhaustively type-checked against the contract.
- POP/Dealer Kit's `actualColumns` describes ONE line item; the multi-item popup is Phase 3 (GRID-06).

## Deviations from Plan

### Auto-fixed Issues
**1. [Rule 1 - Bug] Synthetic seventh smoke cast through `unknown`**
- **Found during:** Task 3
- **Issue:** The literal `key: "test-banner"` doesn't satisfy the closed `ActivityKey` union — directly assignable as `ActivityConfig`.
- **Fix:** Cast `as unknown as ActivityConfig` with an inline comment explaining: a real 7th in code is a one-character widening of the union plus the spread entry.
- **Verification:** Smoke exit 0; the comment documents the shape, making the widening explicit.
- **Committed in:** Task 3 commit

---
**Total deviations:** 1 auto-fixed (typing nuance)
**Impact on plan:** None — clarifies the design intent without changing the contract.

## Issues Encountered
None.

## User Setup Required
None — pure typed config, no deps, no env.

## Next Phase Readiness
Phase-2 plan-upload can read column lists from `lib/activities` directly; the `shared:true` flag drives "this goes to a real plan_rows column" vs "this goes to fields jsonb". The closed `ActivityKey` union prevents typos at compile time. No work in 01-04 / 01-05 depends on this — Wave 1 plans are independent.

---
*Phase: 01-foundation*
*Completed: 2026-06-05*
