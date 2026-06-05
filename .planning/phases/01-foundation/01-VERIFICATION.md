---
phase: 01-foundation
status: passed
score: 9/9 requirements met (success criteria: 6/6)
verified: 2026-06-05
method: build + 25/25 vitest + 9/9 Playwright + 4 live-DB smokes + structural-invariant DB inspection; authored from direct code inspection across all five plans
requirements_met: [ACCESS-01, ACCESS-02, ACTV-01, ACTV-02, ACTV-03, ACTV-04, PRD-01, PRD-02, COMP-01]
requirements_unmet: []
review_2_status: issues-found (2 High + 4 Medium + 5 Low; both Highs fixed in commit 67697e0)
---

# Phase 1: Foundation — Verification (Final)

**Verdict: PASSED.** All 9 phase requirements are met with shipped code, build green, four live-DB invariants proven, end-to-end browser flows green, and the two High-severity findings from the second code review fixed (one of them upgraded D-11 from an app-level rule to a DB-level structural invariant).

## Requirement Verdicts

| ID | Verdict | Evidence |
|----|---------|----------|
| ACCESS-01 | ✅ MET | jose HS256 signed cookie minted on correct password (`lib/actions/auth.ts`); 30-day sliding window REAL (proxy.ts refreshes per request via `sessionCookieOptions`); Playwright login spec green; logout clears the cookie. |
| ACCESS-02 | ✅ MET | `proxy.ts` gates every route except `/login` + static; `(app)` layout re-verifies per render (defense-in-depth); HTTP-verified `GET / no cookie → 307 /login`. |
| ACTV-01 | ✅ MET | All six activities exist as config entries under `lib/activities/`: counter-wall, gsb, nlb, in-shop, pop-dealer-kit, dealer-certificate. `ACTIVITY_KEYS.length === 6` (vitest). |
| ACTV-02 | ✅ MET | Each `ActivityConfig` declares `planColumns` + `actualColumns` (FieldDef[]) and a `type` discriminator (measurement / item-list / status). Shared who/where columns flagged `shared: true` (vitest covers this). |
| ACTV-03 | ✅ MET | `activities:smoke` exit 0 — a synthetic 7th activity resolves purely via record-spread `{ ...ACTIVITIES, 'x': seventh }` with `registry.ts` byte-identical. ACTV-03 PROVEN. |
| ACTV-04 | ✅ MET | `/items` page (`app/(app)/items/page.tsx`) + add form + retire/restore buttons posting to Zod-validated, auth-rechecked Server Actions (`lib/actions/items.ts`). `items:smoke` exit 0 — D-09 PROVEN (no DELETE path; row survives retire). |
| PRD-01 | ✅ MET | `/periods` page + create form (`useActionState`); `createPeriod` accepts type/label/dates with `endDate >= startDate` refine; "make active" toggles via `setActiveTx`. Playwright `creates a period (makeActive)` green. |
| PRD-02 | ✅ MET | `lib/periods/active.ts` exports `getActivePeriod()` — the server-side scoping seam Phase 2+ filters reads on. PeriodSwitcher mounted in the (app) layout's reserved `data-slot="period-switcher"`; selecting a period sets active via Server Action and the page re-renders. |
| COMP-01 | ✅ MET | Off-plan guard structural: `executions.plan_row_id` NOT NULL FK `ON DELETE restrict`, NO `sfid` column on executions; `plan_rows` composite `UNIQUE(period_id, activity, sfid)`. `__smoke__/tables.ts` confirms all five tables live. |

## Success-Criterion Verdicts (ROADMAP Phase 1)

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Shared-password session; everything else blocked | ✅ MET |
| 2 | Six activities as config; 7th by config alone | ✅ MET (ACTV-03 smoke) |
| 3 | Create + mark active period; data scoped to a period | ✅ MET (PRD-01/02; D-11 STRUCTURAL via partial unique index) |
| 4 | DB structurally rejects unplanned-SFID actuals | ✅ MET (COMP-01) |
| 5 | Manage item master (no hard delete) | ✅ MET (D-09 STRUCTURAL — no delete API exists; smoke proves row survives retire) |
| 6 | Runs fully locally on PGlite; cloud is `DATABASE_URL` swap | ✅ MET |

## Live-DB Invariants Proven

| Invariant | Source | Proof | Exit |
|-----------|--------|-------|------|
| Live PGlite round-trip | `db:spike` | `dbSpike() => {"ok":true,"value":1}` | 0 |
| 7th activity by config alone (ACTV-03) | `activities:smoke` | "six known activities resolve; synthetic seventh resolves by spread; registry.ts unchanged" | 0 |
| D-11 single active period | `periods:smoke` | "exactly one active period (id=N) after two distinct setActiveTx calls" | 0 |
| D-11 — concurrent safety (NEW, post-HI-01 fix) | `pg_indexes` inspection + direct UPDATE attempt | `periods_single_active_idx` exists; direct `UPDATE … SET is_active=true` on a 2nd row is **rejected by the DB** | — |
| D-09 soft-retire | `items:smoke` | "retire is a soft toggle (active=false), restore flips it back; row count UNCHANGED; no DELETE path" | 0 |

## Automated Test Coverage

- **vitest:** 25 specs, 4 files, **25/25 green** — session, registry, periods (db + action layers with mocks for next/headers/cache), items (db + action layers).
- **Playwright (Chromium):** 9 specs, 3 files, **9/9 green** — login (3), periods (3), items (3).
- **Build:** `npm run build` clean; routes registered: `/`, `/login`, `/periods`, `/items`, `ƒ Proxy (Middleware)`.

## Code-Review Status

- **Review 1** (pre-gap closure, `01-REVIEW.md`): all High + Medium fixed in commit `8ad9e11` (auth boot assertion, sliding expiry, Supabase SSL doc).
- **Review 2** (post-gap closure, `01-REVIEW-2.md`): 2 High + 4 Medium + 5 Low. **Both Highs fixed in commit `67697e0`:**
  - **HI-01 (D-11 race):** `setActiveTx` was not race-safe under READ COMMITTED. Fix elevates D-11 from an app-level transactional rule to a **structural DB invariant** via a partial unique index (`periods_single_active_idx ON ((1)) WHERE is_active = true`). Now matches the off-plan-guard philosophy: prefer structural over policy.
  - **HI-02 (sliding-cookie 500 cascade):** the new `proxy.ts` sliding refresh called `mintSession()` unguarded — a runtime `SESSION_SECRET` problem would 500 every authenticated request. Wrapped in try/catch; instrumentation's boot assertion remains the primary defense.
- **Medium/Low** items in REVIEW-2 are advisory and worth picking up early in Phase 2 (form CSRF nuance, etc.).

## Gaps → None

All previously-flagged gaps (ACTV-01..04, PRD-01/02) are closed by plans 01-03, 01-04, 01-05. No new gaps surfaced.

---
*Phase 01-foundation — verification: PASSED (9/9 requirements, 6/6 success criteria). Ready to close.*
