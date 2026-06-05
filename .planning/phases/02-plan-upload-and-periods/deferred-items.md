# Phase 2 — Deferred Items

Items discovered during Phase 2 execution that are OUT OF SCOPE for the current plan
but should be addressed at the appropriate time.

---

## DEF-02-01-01: PGlite WASM "Aborted" on vitest runs of `lib/actions/{periods,items}.test.ts`

**Discovered during:** Plan 02-01, Task 3 (full-suite verification)
**Scope:** Pre-existing — reproduced at commit `35c7f13` (last Phase 1 commit) before
any Phase 2 work. Not caused by Plan 02-01.
**Symptom:** Running `npm test` (or any individual `lib/actions/periods.test.ts` /
`lib/actions/items.test.ts` invocation) yields:

```
RuntimeError: Aborted(). Build with -sASSERTIONS for more info.
  at abort (node_modules/@electric-sql/pglite/dist/index.js:1:78233)
  at __abort_js (.../index.js:2:68975)
  at <wasm anonymous frames>
  at Object.callMain (.../index.js:3:282314)
```

Tests report as **7 skipped** (NOT 7 passing) — the suite never runs the assertions
because `beforeAll(ensureMigrated)` aborts inside the PGlite WASM runtime.

**Why deferred:**
- Pre-existing on `35c7f13` (the start of Phase 2). Independent of the Plan 02-01
  scope (the Excel I/O layer is pure functions with no DB / WASM touch — its own
  17/17 + 22/22 + 10/10 vitest specs all pass cleanly).
- Fixing PGlite WASM init in vitest belongs to a DevEx / test-infra plan, not the
  Excel I/O plan.
- Plan 02-01's own success criteria are met: 49/49 Excel-layer tests pass.

**When to address:**
- Before Plan 02-02 starts (it will add `lib/actions/plans.test.ts` which depends on
  the same `beforeAll(ensureMigrated)` setup; the failure mode will block its tests
  too). Suggested investigation:
  - Vitest 4.1.8 + PGlite 0.5.1 WASM init race (possibly fixed in a newer PGlite)
  - Check whether `vitest run` vs `vitest run --pool=forks` changes the outcome
  - Verify migrations don't crash on a fresh PGlite in isolation (the smoke runs
    `npm run periods:smoke` may still be green — try those independently)

**Verification commands:**
```powershell
# Reproduce on master HEAD
npm test -- lib/actions/periods.test.ts
# Reproduce on Phase 1 close
git checkout 35c7f13 -- .
npm test -- lib/actions/periods.test.ts
git checkout master -- .
```

**Impact on Plan 02-01:** None. The Excel I/O layer is framework-free and its tests
are 100% green (49/49).
