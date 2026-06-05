---
phase: 01-foundation
status: gaps_found
score: 3/9 requirements met (success criteria: 3/6)
verified: 2026-06-05
method: goal-backward against the live codebase (build + vitest + generated SQL + live smoke); authored from direct code inspection after the verifier subagent run was truncated
requirements_met: [ACCESS-01, ACCESS-02, COMP-01]
requirements_unmet: [ACTV-01, ACTV-02, ACTV-03, ACTV-04, PRD-01, PRD-02]
---

# Phase 1: Foundation — Verification

**Verdict: GAPS FOUND.** The two executed plans (01-01 walking skeleton, 01-02 schema) deliver a solid, locally-runnable, gated foundation with a structural off-plan guard — but only 3 of the phase's 9 requirements. The activity config registry (ACTV-01..04) and period/item-master management (PRD-01, PRD-02) were never planned into an executable plan, so the phase goal is not yet fully achieved.

## Requirement Verdicts

| ID | Verdict | Evidence |
|----|---------|----------|
| ACCESS-01 | ✅ MET | `lib/auth/session.ts` mints/verifies a jose HS256 signed cookie; `lib/actions/auth.ts` sets it on correct password (sliding 30-day, refreshed in `proxy.ts`) and `logout` clears it. Human-verified at the checkpoint; `npm run test` 3/3. |
| ACCESS-02 | ✅ MET | `proxy.ts` gate (registered by Next as `ƒ Proxy`) blocks every route except `/login` + static; `app/(app)/layout.tsx` re-verifies per render (defense-in-depth). HTTP-verified: `GET /` no cookie → 307 `/login`; forged cookie → 307 `/login`. |
| ACTV-01 | ❌ UNMET | No activity config registry exists. `lib/activities/` is absent; `plan_rows.activity` is a free `text` discriminator with no typed definition of the six activities. |
| ACTV-02 | ❌ UNMET | No per-activity plan/actual column config (type measurement / item-list / status). Nothing for the grid/import/export to read. |
| ACTV-03 | ❌ UNMET | No config-driven extensibility — there is no registry to add a 7th activity to. |
| ACTV-04 | ❌ UNMET | `item_master` TABLE exists and migrated, but there is NO UI or Server Action to manage the selectable item list. A table alone does not satisfy "user can manage the item master." |
| PRD-01 | ❌ UNMET | `periods` table + `period_type` enum exist, but there is NO create-period / mark-active Server Action or UI. The "exactly one active period" rule (D-11) is unimplemented. |
| PRD-02 | ❌ UNMET | Schema scopes `plan_rows` by `period_id` (DB foundation present), but no period selector / app-layer scoping ("selecting a period shows only that period's data") is built. |
| COMP-01 | ✅ MET | Structural off-plan guard proven: `drizzle/0000_*.sql` shows `executions.plan_row_id` NOT NULL FK `ON DELETE restrict`, **no `sfid` on executions**, composite `UNIQUE(period_id, activity, sfid)`, numeric(14,2) money, no CASCADE/GENERATED. `__smoke__/tables.ts` confirms all five tables live (exit 0). |

## Success-Criterion Verdicts (ROADMAP Phase 1)

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Correct password → persistent signed-cookie session; otherwise every page/action blocked | ✅ MET |
| 2 | Six activities as config entries (type measurement/item-list/status); a 7th by config alone | ❌ UNMET |
| 3 | Create a period (month/quarter/FY), mark active, all data scoped to a period | ❌ UNMET (schema only) |
| 4 | DB makes it structurally impossible to attach an actual to an unplanned SFID | ✅ MET |
| 5 | Manage the selectable item master for POP / dealer-kit | ❌ UNMET (table only) |
| 6 | Runs fully locally on PGlite; Supabase via `DATABASE_URL` swap | ✅ MET |

## What IS solid (built + verified)
- Locally-runnable Next 16 app on PGlite (`npm run dev`), proven `SELECT 1` round-trip
- Shared-password gate: jose signed cookie, constant-time password check, proxy gate + per-render re-verification, sliding expiry, boot-time secret assertion
- Period-scoped schema with the off-plan guard as a database invariant (COMP-01)
- One migration source applied identically to PGlite (and, by config, Supabase)

## Gaps → Closing Actions

All six gaps are app-layer features on top of the existing schema/registry seams. Recommended gap-closure plans (`/gsd:plan-phase 1 --gaps`):

1. **Activity config registry (ACTV-01, ACTV-02, ACTV-03)** — a typed `lib/activities/` registry defining all six activities (Counter Wall Painting, GSB, NLB, In-shop Branding, POP/Dealer Kit, Dealer Certificate), each declaring its plan columns, actual columns, and type (measurement / item-list / status). Extensible by adding one config entry. This is the SKELETON's "activities defined as config" decision, not yet built.
2. **Period management (PRD-01, PRD-02)** — a Server Action + minimal UI to create a period (month/quarter/FY) and mark exactly one active (enforce D-11), plus a period selector in the `(app)` shell's reserved slot that scopes data.
3. **Item-master management (ACTV-04)** — a Server Action + minimal UI to add/retire `item_master` entries (toggle the `active` flag; no hard delete, D-09).

## Code Review
See `01-REVIEW.md` (status: issues-found). The 2 High + 1 Medium items (HI-01 boot/secret failure mode, HI-02 sliding-expiry mismatch, ME-01 Supabase SSL doc) were fixed in commit `8ad9e11`. Remaining Low items are advisory.

---
*Phase 01-foundation — verification: gaps_found (3/9). Do not mark complete until gap-closure plans land ACTV-01..04 and PRD-01/02.*
