# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 1-Foundation
**Areas discussed:** Execution grain & off-plan key, Item master (Login & session started, then set aside by user)
**Areas skipped (defaults recorded in CONTEXT.md):** Period model, Login & session (session length)

---

## Execution grain & off-plan key

### Q1 — Plan-row removal vs. recorded actuals

| Option | Description | Selected |
|--------|-------------|----------|
| Block removal, protect spend (RESTRICT) | DB refuses to drop a plan row that has recorded actuals; nothing recorded is silently lost; makes PLAN-06 structural | ✓ |
| Keep actuals, archive the row (soft-archive) | Mark plan row inactive but keep it + executions; more app logic for archived state | |
| Delete the actuals too (CASCADE) | Removing the dealer wipes recorded spend; simplest but destroys data | |

**User's choice:** Block removal, protect spend → `ON DELETE RESTRICT`
**Notes:** Consistent with a spend-of-record tool; forces Phase 2 re-upload to handle removals explicitly.

### Q2 — Duplicate dealer (SFID) within one plan

| Option | Description | Selected |
|--------|-------------|----------|
| One plan row per dealer | `UNIQUE (period_id, activity, sfid)`; multi-unit handled via multiple executions; repeated SFID flagged duplicate | ✓ |
| Allow the same dealer twice | Multiple plan rows per dealer per activity+period; matching an actual to the right row becomes ambiguous | |

**User's choice:** One plan row per dealer
**Notes:** Confirms the universal join key `(period_id, activity, sfid)`.

### Q3 — How multiple units (walls/boards) per dealer are stored

| Option | Description | Selected |
|--------|-------------|----------|
| Separate row per unit | `executions` one-to-many under `plan_rows`; each unit its own measurements/cost/status/location/date; per-unit version check; totals via SUM (matches GRID-05) | ✓ |
| One row, units in a JSON list | All units in a JSON list on one row; can't easily sum/filter units; coarser concurrency | |

**User's choice:** Separate row per unit
**Notes:** Drops the architecture-draft `UNIQUE(plan_row_id)`, which contradicted the confirmed multi-unit grain.

### Continue check
**User's choice:** Move to Item master (grain decisions resolved cleanly).

---

## Item master

### Q1 — Organization

| Option | Description | Selected |
|--------|-------------|----------|
| One global list | Single managed list; optional category tag; only POP uses it today; future item activities reuse it | ✓ |
| Per-activity / categorized | Items tagged per activity/category; more structure; only worth it if item sets diverge (they don't) | |

**User's choice:** One global list

### Q2 — Item fields

| Option | Description | Selected |
|--------|-------------|----------|
| Name + default rate + unit | Name, optional pre-filling rate (editable), unit label; fastest entry | |
| Name + default rate | Name + editable default rate; no unit | |
| Name only | Just the name; rate typed fresh on each POP line | ✓ |

**User's choice:** Name only
**Notes:** Keeps the master dead-simple; rate always entered per line at POP time.

### Q3 — Renaming a master item vs. recorded lines

| Option | Description | Selected |
|--------|-------------|----------|
| Recorded lines keep original name | Each POP line snapshots the name as entered; rename affects only new entries | ✓ |
| Recorded lines follow the rename | Past lines reference master by id; rename retroactively re-labels history | |

**User's choice:** Recorded lines keep original name (snapshot)
**Notes:** Consistent with the protect-recorded-spend choice for executions.

---

## Login & session *(started, then set aside)*

### Q1 — Session lifetime

| Option | Description | Selected |
|--------|-------------|----------|
| 30 days, sliding | Re-enter password ~monthly; balance of convenience + periodic re-auth | (default recorded) |
| 7 days, sliding | Re-enter weekly; tighter for shared/lost devices | |
| Until logout (long-lived) | Stays signed in ~1 year until explicit logout; max convenience | |

**User's response:** "skip this feature, not required" — then "execute what has been finalised till now."
**Resolution:** Session length recorded as a **default (30-day sliding)** in CONTEXT.md D-13, flagged as not-a-user-decision. The auth gate itself (ACCESS-01/02) remains required and is captured in D-12. Discussion ended here at the user's instruction.

---

## Claude's Discretion

- Exact Drizzle schema/column types, indexes, migration layout, middleware code structure.
- Per-activity computed-total formulas (derive from PROJECT.md column specs).
- `active period` representation (`is_active` boolean vs single-row pointer).
- Session-lifetime value (user deprioritized).

## Deferred Ideas

None — discussion stayed within Phase 1 scope. Period model and Login session-length were recorded as defaults, not deferred to another phase.
