---
phase: 04-compliance-dashboard
plan: 01
subsystem: compliance
tags: [status-registry, compliance-math, foundations]
requires: []
provides:
  - STATUS_VALUES
  - TERMINAL_STATUSES
  - StatusValue
  - computeCompleteness
  - CompletenessInput
  - Completeness
affects:
  - lib/activities/* (5 status-bearing configs now import STATUS_VALUES)
  - lib/actuals/colDefs.test.ts (cellEditorParams assertion widened to 4-value array)
tech_stack:
  added: []
  patterns:
    - "Pure module + barrel re-export (mirrors lib/actuals/filter convention)"
    - "Identity-equal (toBe) assertion proves config imports the constant rather than inlining"
key_files:
  created:
    - lib/activities/status.ts
    - lib/activities/status.test.ts
    - lib/compliance/completeness.ts
    - lib/compliance/completeness.test.ts
    - lib/compliance/index.ts
  modified:
    - lib/activities/counter-wall.ts
    - lib/activities/gsb.ts
    - lib/activities/nlb.ts
    - lib/activities/in-shop.ts
    - lib/activities/dealer-certificate.ts
    - lib/actuals/colDefs.test.ts
decisions:
  - "STATUS_VALUES is a 4-tuple in canonical order: Pending, In Progress, Done, Cancelled. Pending first (default for new executions, D3.1-03); Cancelled last (terminal + newest)."
  - "Identity-equality (statusField.enumValues === STATUS_VALUES) is the registry-consumption test — proves no future contributor can silently inline a 3-value array and pass tests."
  - "POP / Dealer Kit has NO status field — its actualColumns describe per-line items (itemName/qty/rate/lineTotal). Left untouched. Only 5 of 6 activities are status-bearing."
  - "colDefs.test.ts line 131 hardcoded the 3-value enum and would have broken — updated to the 4-value array (Rule 3, blocking issue caused directly by enum widening). This is documented in Deviations."
  - "computeCompleteness asymmetric denominators (D-03 vs D-04) are intentional and locked by the spec test {10,6,2} → {0.75, 0.20, 8}."
  - "Pure function: no clamping of pctExecuted to [0,1]. Display-side rounding lives in the consumer (Plan 04-04 RSC stat strip)."
metrics:
  tasks_completed: 2
  files_created: 5
  files_modified: 6
  tests_added: 17  # 8 status + 9 completeness
  total_tests_green: 28  # lib/activities (19) + lib/compliance (9)
  duration_minutes: 12
  completed_at: "2026-06-09"
---

# Phase 04 Plan 01: Foundations (status registry + completeness math) Summary

Centralised the four-value status enum (`STATUS_VALUES = ['Pending','In Progress','Done','Cancelled']`) and the asymmetric-denominator completeness math (`computeCompleteness`) into framework-free shared modules so that every downstream Phase 4 task (DAL, RSC, islands) and the Phase 5 export consume the same source of truth.

## What Shipped

### 1. Status registry centralisation (Task 1)

- New `lib/activities/status.ts` exports the canonical 4-tuple `STATUS_VALUES`, the terminal subset `TERMINAL_STATUSES = ['Done','Cancelled']`, and the derived `StatusValue` literal-union type.
- The five status-bearing activity configs now import the constant and use `enumValues: STATUS_VALUES` instead of an inline 3-value array:
  - `lib/activities/counter-wall.ts`
  - `lib/activities/gsb.ts`
  - `lib/activities/nlb.ts`
  - `lib/activities/in-shop.ts`
  - `lib/activities/dealer-certificate.ts`
- POP / Dealer Kit has no status column (it is an `item-list` activity whose actuals describe per-line items: itemName / qty / rate / lineTotal) — confirmed by reading `pop-dealer-kit.ts` and left untouched.
- Identity-equality assertion in `status.test.ts` (`expect(statusField.enumValues).toBe(STATUS_VALUES)`) mechanically blocks any future drift back to an inline literal — a deep-equal array would silently pass; `toBe` would not.
- Closes A4/R1: Phase 4 SQL clauses like `filter (where status = 'Cancelled')` now have a registered enum value to match.

### 2. Completeness math (Task 2)

- New `lib/compliance/completeness.ts` exports `computeCompleteness`, `CompletenessInput`, and `Completeness` (all `readonly`) — pure function, no React / Drizzle / DB imports (grep-verified, comments stripped).
- `lib/compliance/index.ts` barrels the public surface so consumers can `import { computeCompleteness } from "@/lib/compliance"`.
- Formula: `effectiveDenominator = max(0, planned - cancelled)`; `pctExecuted = denom === 0 ? 0 : executed / denom`; `pctCancelled = planned === 0 ? 0 : cancelled / planned`. The asymmetry (D-03 EXCLUDES vs D-04 INCLUDES cancelled in the denominator) is intentional and called out in the module header.
- Spec example locked: `{10, 6, 2} → {0.75, 0.20, 8}`.

## Verification

- `npm test -- lib/activities lib/compliance` → **3 files, 28/28 tests green**.
- `npx tsc --noEmit` → exits 0.
- `git diff package.json` → empty (no new dependency introduced).
- `grep -nE 'enumValues:\s*\[.*Pending' lib/activities/*.ts` → zero matches (no inline status enum remains).
- `grep -v '^\s*\*\|^\s*//' lib/compliance/completeness.ts | grep -E 'from "(react|drizzle-orm|@/lib/db)"'` → zero matches.

## Tests Added

### `lib/activities/status.test.ts` (8 tests)

| # | Case | Asserts |
|---|------|---------|
| 1 | STATUS_VALUES content | `toEqual(['Pending','In Progress','Done','Cancelled'])` |
| 2 | Includes Cancelled | `toContain('Cancelled')` — A4/R1 invariant |
| 3 | Canonical order | `[0]==='Pending'`, last==='Cancelled' |
| 4 | TERMINAL_STATUSES content | `toEqual(['Done','Cancelled'])` |
| 5 | TERMINAL ⊆ STATUS_VALUES | each TERMINAL is in STATUS_VALUES |
| 6 | StatusValue is structurally usable | literal `'Cancelled'` assignable |
| 7-11 | Registry consumption (5 activities) | `statusField.enumValues === STATUS_VALUES` (identity-equal, by `toBe`) |

### `lib/compliance/completeness.test.ts` (9 tests)

| # | Input `{planned, executed, cancelled}` | Expected `{pctExecuted, pctCancelled, effectiveDenominator}` |
|---|----------------------------------------|--------------------------------------------------------------|
| 1 | `{10, 6, 2}` | `{0.75, 0.2, 8}` (spec example) |
| 2 | `{0, 0, 0}` | `{0, 0, 0}` (no /0) |
| 3 | `{5, 0, 5}` | `{0, 1, 0}` (denom collapses; no NaN) |
| 4 | `{5, 5, 0}` | `{1, 0, 5}` (fully executed) |
| 5 | `{0, 0, 0}` edge | `{0, 0, 0}` |
| 6 | `{7, 0, 7}` planned==cancelled | `{0, 1, 0}` |
| 7 | `{5, 6, 1}` over-executed | `pctExecuted === 1.5`, `denom === 4`, `pctCancelled === 0.2` (no clamping per spec) |
| 8 | determinism | two calls with identical input return identical output |
| 9 | barrel export | `lib/compliance/index.ts` re-exports `computeCompleteness` |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] `lib/actuals/colDefs.test.ts` hardcoded the 3-value enum**

- **Found during:** Task 1 (acceptance verification).
- **Issue:** `colDefs.test.ts:131` asserted `expect(col?.cellEditorParams).toEqual({ values: ["Pending", "In Progress", "Done"] })`. Widening `STATUS_VALUES` to four values caused the assertion to fail (deep-equal mismatch). The plan claimed "no existing test asserts the absence of 'Cancelled'" — grep confirmed there was no negative assertion, but the positive deep-equal of the 3-value array was, in effect, the same thing.
- **Fix:** Updated the assertion to the 4-value array `["Pending", "In Progress", "Done", "Cancelled"]`. The test still asserts the same contract (cellEditorParams.values mirrors enumValues); only the expected literal grew alongside `STATUS_VALUES`.
- **Files modified:** `lib/actuals/colDefs.test.ts`.
- **Commit:** GREEN of Task 1 (the migration commit).

### No other deviations

The rest of the plan executed exactly as written. No architectural changes, no Rule 4 escalation, no auth gates.

## Threat Flags

None. The change is type-system / pure-math only — no new network endpoints, no new auth paths, no schema changes, no file-system access.

## Known Stubs

None. Both modules are fully implemented; downstream consumers (Plans 04-02 / 04-03 / 04-04) will import them as-is.

## Self-Check

- [x] `lib/activities/status.ts` exists — FOUND.
- [x] `lib/activities/status.test.ts` exists — FOUND.
- [x] `lib/compliance/completeness.ts` exists — FOUND.
- [x] `lib/compliance/completeness.test.ts` exists — FOUND.
- [x] `lib/compliance/index.ts` exists — FOUND.
- [x] 5 activity configs import `STATUS_VALUES` (counter-wall, gsb, nlb, in-shop, dealer-certificate) — FOUND.
- [x] Commits exist on `worktree-agent-acca3b11ba51600b7` branch:
  - `7f1eb82` test(04-01): add failing test for STATUS_VALUES single source of truth
  - `0aa4c95` feat(04-01): centralize STATUS_VALUES + migrate 5 activity configs
  - `1828a4a` test(04-01): add failing test for computeCompleteness asymmetric-denominator spec
  - `079f8c3` feat(04-01): implement computeCompleteness shared math helper

## Self-Check: PASSED

## TDD Gate Compliance

Both tasks followed RED → GREEN with discrete commits:

| Task | RED commit | GREEN commit |
|------|------------|--------------|
| 1 (STATUS_VALUES + migrate configs) | `7f1eb82` (test:) | `0aa4c95` (feat:) |
| 2 (computeCompleteness) | `1828a4a` (test:) | `079f8c3` (feat:) |

No REFACTOR commits — implementations were minimal at GREEN and required no cleanup pass.
