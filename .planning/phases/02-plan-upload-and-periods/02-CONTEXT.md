# Phase 2: Plan Upload & Periods - Context

**Gathered:** 2026-06-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The Excel-ingest layer that populates the `plan_rows` table built in Phase 1 — turning approved per-activity plans into the authoritative allowed-SFID master list for every `(period, activity)` combination, with safe non-destructive re-upload:

- **Template download** (PLAN-01) — per-activity `.xlsx` blob whose headers exactly match the registry config.
- **Upload + header validation** (PLAN-02) — client-side SheetJS parse; headers checked against `ActivityConfig.planColumns` before anything else runs.
- **Per-row preview** (PLAN-03) — valid / duplicate / error classification surfaced before any DB write.
- **Atomic commit** (PLAN-04, PLAN-05) — Server Action `commitPlanUpload` writes plan rows + shared who/where + `fields` jsonb + `planned_cost` in one transaction, becoming the allowed-SFID master for `(activity, period)`.
- **Non-destructive re-upload** (PLAN-06) — mirror semantics (insert new / update changed / delete removed-clean); the database's `ON DELETE RESTRICT` FK structurally blocks destructive removal when actuals exist; the app translates that block into a per-dealer warning list.
- **Off-plan rejection surface** (COMP-02) — wires the transient UI affordance for listing rejected rows; actuals import itself is Phase 3.

Out of scope here: the actuals editable grid (Phase 3), AG Grid integration (Phase 3), multi-item POP entry (Phase 3), budget-vs-actual dashboards (Phase 4), Excel export (Phase 5), archived-dealer browse UI, persistent import-rejection audit log, per-field header aliasing config, pre-filling templates from a prior period.

</domain>

<decisions>
## Implementation Decisions

### Re-Upload Semantics *(discussed)*
- **D2-01:** Re-upload uses **mirror semantics**: diff the parsed Excel rows against existing `plan_rows` for `(period_id, activity)`, then insert new SFIDs, update changed columns on matched SFIDs, and **attempt to delete removed SFIDs**. The deletion path leans on Phase 1's `ON DELETE RESTRICT` FK — if any removed SFID has child `executions`, the FK fires inside the transaction and the **entire commit rolls back**. The Server Action catches the rollback, queries which SFIDs have executions, and returns `{ ok: false, blockedDealers: [...] }` for the preview UI to render. This forces the user to either fix the source-of-truth Excel or explicitly retire actuals before retrying — no silent loss, no schema change.
- **D2-02:** Off-plan rejections (COMP-02) are **transient** — surfaced in the preview UI only, **not persisted** to a separate `import_rejections` log table. The requirement is "listed so the user can see what was rejected"; persistence can earn its way back in if audit demand emerges.

### Header Validation & Excel Parsing *(discussed)*
- **D2-03:** Header validation is **template-driven and lenient**. No real vendor Excel files are available for calibration, so the contract is the downloadable template (PLAN-01): `ActivityConfig.planColumns[i].label` is the canonical header. Incoming headers are matched **case-insensitively with whitespace-trim**. No per-field aliases are introduced — they are added only when a real vendor file is shown to break the canonical form.

### POP / Dealer Kit Plan Shape *(discussed)*
- **D2-04:** POP plan rows are **one per `(period, sfid)`** — the plan only declares which dealers are eligible for a POP kit. The "item-list" nature of POP applies to **actuals only** and the multi-item entry UI is Phase 3. This matches the existing `planColumns` for POP in the registry; no schema or registry change.

### Template Download *(discussed)*
- **D2-05:** The downloadable Excel template (PLAN-01) is **empty — headers only**. The header row mirrors `ActivityConfig.planColumns[i].label` exactly. Pre-filling from a prior period is footgun-shaped (stale data accidentally re-uploaded) and is deferred as a Phase 3+ ergonomic addition.

### Excel I/O Locus *(locked by PROJECT.md / CLAUDE.md)*
- **D2-06:** Excel parsing runs **client-side** via SheetJS CE 0.20.3 (CDN tarball, not npm). The server never receives an `.xlsx` file — only Zod-validated JSON rows cross the wire to the Server Action. This is defense-in-depth: no upload endpoint, no temp-file lifecycle, no server-side prototype-pollution exposure from a crafted workbook (CVE-2023-30533 lesson).

### Claude's Discretion
- Exact shape of `ParsedRow`, `HeaderError`, and the preview-grouping types (`valid` / `duplicate` / `fieldError` / `blocked`).
- Whether template generation runs in the browser (SheetJS write) or via a Server Route Handler (`/api/plan-template?activity=…`) — both are viable; browser-side avoids a Node-runtime serverless hop.
- Bulk-insert chunking size inside the commit transaction (target: 500 rows per `.values([…])` call); confirm both PGlite and Supabase tolerate it under load.
- Whether the preview table virtualises (rows > 1000) or just renders raw HTML — start raw; only add virtualisation if a real plan exceeds 5k rows.
- Whether the upload form's period selector defaults to the active period (per D-11) or forces explicit pick — pick the active-period default unless there's a UX argument otherwise.

### Items Planner Must Verify Against the Live Codebase
- **`plan_rows.plannedCost` nullability** — the registry's `planColumns` for `dealer-certificate`, `gsb`, and `nlb` does not list a planned-cost field, yet `plan_rows.plannedCost numeric(14,2)` is a real column. Planner must read `lib/db/schema.ts` and either (a) confirm `plannedCost` is nullable and let those activities store `null`, or (b) introduce a per-activity rule (e.g. always `0`, or a "total budget" entry on the upload form).
- **`fields` jsonb routing** — activity-specific plan fields (`planSqft` for counter-wall; `pinCode`, `gstNo`, `mobileNo` for in-shop) must route to `plan_rows.fields` jsonb, not real columns. The parser and `commitPlanUpload` must consult `FieldDef.shared` to make the column-vs-jsonb decision.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 1 Foundation (the substrate we're populating)
- `lib/db/schema.ts` — the `plan_rows` table is already defined with `UNIQUE(period_id, activity, sfid)` and the `executions.plan_row_id NOT NULL ON DELETE RESTRICT` FK. Phase 2 only inserts/updates/deletes against it; no migration needed (subject to the nullability check above).
- `lib/activities/registry.ts` + `lib/activities/types.ts` — the single source of truth for `planColumns`, their `label`, `kind`, `required`, `shared` properties. Header validation and field routing both read from here.
- `lib/auth/session.ts` (`requireSession`, `verifySession`) — every Server Action must call `requireSession()` at entry (defense-in-depth; CVE-2025-29927 lesson).
- `lib/db/index.ts` — dual-driver seam (PGlite local / Supabase via `DATABASE_URL`); transactions via `db.transaction(async tx => …)`.
- `lib/actions/periods.ts`, `lib/actions/items.ts` — established Server Action pattern: `requireSession()` + Zod parse + `{ ok | error }` state shape + `revalidatePath()` on success.
- `app/(app)/periods/period-form.tsx` — established client-component pattern: `"use client"` + `useActionState<State, FormData>(action, initial)` + manual form reset via ref on `state.ok`.

### Architecture & Pitfalls (read before designing the parser/validator)
- `.planning/research/ARCHITECTURE.md` §"Excel Importer" (≈ lines 199–222) — client-parse → validate → match → preview → commitImport flow; the canonical pattern this phase implements.
- `.planning/research/PITFALLS.md` — Excel coercion traps: `cellDates:true`, `raw:false`, treat all IDs as text (no scientific-notation loss), strip `₹` and commas before parse, parse DD/MM dates explicitly.
- `.planning/research/STACK.md` — SheetJS install is the **CDN tarball** (`npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`), never the npm registry.

### Requirements & Scope
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: PLAN-01..06, COMP-02 (with COMP-02's actuals-side completion in Phase 3).
- `.planning/ROADMAP.md` §"Phase 2: Plan Upload & Periods" — Goal, success criteria, and the discuss-step questions resolved by D2-01..05.
- `.planning/PROJECT.md` — Locked stack, per-activity column specs (already wired into the registry in Phase 1), client-parse-then-server-commit pattern.
- `.planning/phases/01-foundation/01-CONTEXT.md` — D-01 (FK RESTRICT), D-02 (UNIQUE match key), D-05 (numeric money), D-13/D-14 (auth, dual-driver) all flow into Phase 2 unchanged.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (Phase 1 ships these — Phase 2 imports, doesn't re-invent)

- **`requireSession()` pattern** — `lib/actions/periods.ts:13`, `lib/actions/items.ts:14` (approx). Wrap every new Server Action in this; same error semantics (`throw new Error("Unauthorized")`).
- **State-shape return** — `{ ok: true, … } | { ok: false, error: string, … }`. Never throw past Zod; always return a state object so `useActionState` can render it.
- **`revalidatePath()`** — call after successful mutations so server-rendered list pages refresh (e.g. `revalidatePath('/plans')`).
- **`db.transaction(async tx => …)`** — Drizzle's transaction primitive works identically on PGlite and Supabase; use `tx` (not the outer `db`) for every read and write inside.
- **`useActionState` + ref-reset pattern** — `app/(app)/periods/period-form.tsx`. Copy the shape: `const [state, action, pending] = useActionState(serverAction, { ok: false })` plus a `useEffect` that resets the form on `state.ok`.
- **PGlite test isolation** — `lib/actions/periods.test.ts` shows the `beforeEach: _resetXForTest()` + mocked `next/headers` / `next/cache` / `verifySession` pattern. Add a `_resetPlanRowsForTest` helper in the plans data-access module.
- **Live-DB smoke pattern** — `lib/db/__smoke__/tables.ts`, `lib/db/__smoke__/items.ts`. The smoke for D2-01 (FK-restrict on re-upload) follows the same shape: connect → seed → assert structural invariant fires.

### Established Patterns

- **Project structure:** `lib/excel/` for parse/template/validate (pure functions, no Next/React imports — same dependency-free spirit as `lib/activities/`); `lib/actions/plans.ts` for the Server Action; `app/(app)/plans/…` for UI. Mirrors the layering already in the repo.
- **No new dependencies except SheetJS** — installed from the CDN tarball per CLAUDE.md.
- **Tailwind only, no shadcn yet** — the preview table is plain HTML with Tailwind classes, matching the existing period/items pages.

### Integration Points

- **`lib/activities/registry.ts`** is read by `lib/excel/template.ts` (header generation), `lib/excel/parse.ts` (header validation + `shared`/jsonb routing), and `lib/actions/plans.ts` (Zod schema construction). Adding a 7th activity remains a one-entry registry change.
- **`executions.plan_row_id` FK** is the structural barrier that turns D2-01 from "trust app logic" into "trust the database." `commitPlanUpload` must let the FK throw and translate it, not pre-emptively block.
- **Active-period scoping (D-11)** — the upload form's period selector defaults to the active period; the user can override per upload, but the common case is "upload for current period."

</code_context>

<specifics>
## Specific Ideas

- **Per-row classification taxonomy for the preview UI:**
  - `valid` — passes header + field validation, no duplicate; will insert
  - `update` — SFID already exists in `(period, activity)`; will update changed columns
  - `duplicate` — same SFID appears more than once in the uploaded file (file-internal, not vs DB); user must fix
  - `fieldError` — required field missing, type coercion failed, enum out of range, etc.
  - `blocking` — SFID is in the existing DB plan but absent from this upload AND has child executions; commit will be rejected unless the user adds the SFID back or retires the actuals
- **Atomic commit guarantee:** the `commitPlanUpload` action must NEVER produce a partial write. If FK-restrict fires anywhere in the diff-delete phase, the whole transaction rolls back and the user sees `blockedDealers` — there is no "we deleted some and stopped" intermediate state.
- **Template file name convention:** `marketing-plan-template-{activity-key}.xlsx` (e.g. `marketing-plan-template-counter-wall.xlsx`) — consistent, machine-greppable, no period in the name (template is period-agnostic).
- **Preview ordering:** group rows by classification (errors first, then blocking, then duplicates, then updates, then valids) so the user's eye lands on what they must fix.
- **No external API surface** — Server Actions only; consistent with Phase 1's "no Route Handlers for in-app callers."

</specifics>

<deferred>
## Deferred Ideas

- **Persistent `import_rejections` audit log** (per D2-02) — earn it back in if audit demand emerges; for now COMP-02's "list rejections" is transient UI only.
- **Per-field header aliasing config** (per D2-03) — added only when a real vendor Excel file breaks the canonical headers.
- **Pre-filling templates from a prior period** (per D2-05) — Phase 3+ ergonomic addition.
- **Soft-archive of removed plan rows** — the alternative re-upload model (the "option D" considered during discuss) — only revisit if D2-01's block-on-actuals UX proves too punitive in practice.
- **Multi-item POP plan rows** — alternative POP shape considered during discuss; deferred because the actuals UI in Phase 3 will own the line-item entry surface.
- **Bulk template download** (one zip with all 6 activity templates) — convenience only; trivial follow-up if asked.
- **Server-side row-model paging in the preview** — only needed once a plan crosses ~5–10k rows; v1 renders raw HTML.

</deferred>

---

*Phase: 2-Plan-Upload-and-Periods*
*Context gathered: 2026-06-05*
