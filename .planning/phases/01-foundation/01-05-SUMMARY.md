---
phase: 01-foundation
plan: 05
subsystem: items
tags: [item-master, server-actions, zod, soft-delete, playwright, ACTV-04, D-09]

# Dependency graph
requires:
  - phase: 01-02
    provides: item_master table with active flag (D-09)
  - phase: 01-01
    provides: jose-gated (app) shell + Server Action pattern + auth re-check seam
provides:
  - addItem + toggleItemActive Server Actions (Zod-validated, auth-rechecked) + toggleItemActiveForm wrapper
  - /items management UI (add form + list + per-row Retire/Restore)
  - Live-DB proof that retire is a soft toggle (D-09) — no DELETE path
affects: [actuals-grid (POP/dealer-kit picker, Phase 3)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-state per-row form: hidden input flips 'active' between true/false so one Server Action handles both Retire and Restore"
    - "Blank optional inputs coerced to null (not empty string) via Zod transform — keeps the schema's nullable shape honest"

key-files:
  created:
    - lib/db/items.ts
    - lib/actions/items.ts
    - lib/actions/items.test.ts
    - app/(app)/items/page.tsx
    - app/(app)/items/item-form.tsx
    - lib/db/__smoke__/item-master.ts
    - e2e/items.spec.ts
  modified:
    - package.json (added items:smoke script)

key-decisions:
  - "No delete API exists in lib/db/items.ts — D-09 is enforced by absence, not policy. The grep gate (no `.delete(` / `DELETE FROM item_master`) prevents future additions"
  - "Retire/Restore are the SAME Server Action (toggleItemActive) with a hidden form input flipping the target — half the code, single source of truth"
  - "Blank category coerced to null via z.string().transform — Postgres column stays nullable, no '' rows in the DB"
  - "Retired items get a `retired` badge + muted styling + data-active=\"false\" attribute (the picklist contract for Phase-3's POP item picker)"

patterns-established:
  - "Soft-toggle invariant proven both in vitest AND in Playwright (UI doesn't visibly delete the row)"
  - "Smoke harnesses live next to the queries they prove (lib/db/__smoke__/), not next to UI"

requirements-completed: [ACTV-04]

# Metrics
duration: ~30 min
completed: 2026-06-05
---

# Phase 1 Plan 05: Item-Master Management + D-09 Soft-Retire Summary

**Item master CRUD wired end-to-end with retire-as-soft-toggle (D-09) proven at three layers: vitest (row count unchanged on retire), Playwright (UI badge flips without removing the row), and a live-PGlite smoke. The DB has no DELETE path against item_master by construction.**

## Performance
- **Duration:** ~30 min
- **Completed:** 2026-06-05
- **Tasks:** 3 auto
- **Files modified:** 7 + 1 script line

## Accomplishments
- `addItem` (Zod: name trim+min(1); category optional → null) and `toggleItemActive` (Zod-validated id + active boolean) both re-verify the jose cookie defensively
- `toggleItemActiveForm` adapter lets `<form action={...}>` post directly without dragging useActionState into Server Components
- `/items` page lists items with a "retired" badge + muted row state for retired entries; the picklist contract carries `data-active="true|false"` for downstream consumers
- 7 vitest specs hit live PGlite — proving D-09 at the query layer (row count unchanged across retire)
- 3 Playwright specs prove the same invariant through the UI — including a retire-then-restore round-trip
- `npm run items:smoke` (the live-DB proof) exits 0: insert → retire → assert active=false + row count unchanged → restore → assert active=true + row count still unchanged

## Task Commits
1. **Task 1: queries + Server Actions + vitest** — `1fd3ead` (feat) — 7 specs; 25/25 total green
2. **Task 2: UI + Playwright E2E** — `…` (feat) — 9/9 e2e green (login + periods + items)
3. **Task 3: live-DB smoke (D-09)** — `…` (feat)

## Files Created/Modified
- `lib/db/items.ts` — listItems / insertItem / setItemActive / `_resetItemsForTest` (NO delete API)
- `lib/actions/items.ts` — addItem + toggleItemActive (+ form wrapper)
- `lib/actions/items.test.ts` — 7 specs hitting live PGlite
- `app/(app)/items/page.tsx` + `item-form.tsx` — management page + Client add form
- `lib/db/__smoke__/item-master.ts` — D-09 live-DB proof
- `e2e/items.spec.ts` — 3 Playwright specs (Chromium)
- `package.json`: added `items:smoke` script

## Decisions Made
See `key-decisions` frontmatter. Headline: D-09 is enforced by **absence** — there is no exported `delete*` in `lib/db/items.ts`, and a grep gate guards against future additions. Soft toggle is structural rather than policy.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Playwright counted rows before the add finished rendering**
- **Found during:** Task 2 E2E
- **Issue:** After `await page.click("Add item")`, immediate `.count()` on the list raced revalidatePath/rerender — first run saw the old count.
- **Fix:** Added `await expect(row).toBeVisible()` before counting; the toggle test then counted a stable post-add list.
- **Verification:** D-09 spec green on rerun.
- **Committed in:** Task 2 commit

---
**Total deviations:** 1 auto-fixed (test-timing)
**Impact on plan:** None. Same retire-as-soft-toggle contract, just observed more carefully.

## Issues Encountered
None at the production-code layer. The test-timing fix above was the only debug cycle.

## User Setup Required
None.

## Next Phase Readiness
- **ACTV-04 closed** — Phase 1's last gap. All 9 phase requirements now have shipped code.
- Phase 2 (Plan Upload) can build the POP/dealer-kit line-item picker on the `item_master.active=true` slice — `listItems()` is the seam; ACTV-04 carrying `(name + category + active)` matches the registry's POP `actualColumns` (item, qty, rate, total).
- Ready for `/gsd:verify-work 1` (hands-on UAT) or directly `/gsd:plan-phase 2`.

---
*Phase: 01-foundation*
*Completed: 2026-06-05*
