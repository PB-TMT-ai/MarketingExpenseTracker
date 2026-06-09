# Phase 3.1: Actuals Grid Refinements — Research

**Researched:** 2026-06-08
**Domain:** AG Grid Community 35.x hot-path perf + clipboard, Drizzle/PGlite forward migration, Server Action transaction mirroring, React 19 state hygiene
**Confidence:** HIGH (all six requirements grounded in read source + AG Grid official docs; one reconciliation finding overrides three CONTEXT memory references — see Risks R1)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (research the HOW, never propose alternatives)
- **D3.1-02** — Off-plan **EXCEPTION** path. Add `source` to `plan_rows` (+ audit fields). New Server Action `addOffPlanExecution` inserts plan_row(`source='exception'`) AND execution in ONE transaction. Excel plan-upload off-plan rejection is UNCHANGED. Exception rows MUST survive a future plan re-upload.
- **D3.1-03** — Default `"In Progress"` in THREE places: `buildRowModel` placeholder branch, `cloneUnitForAdd`, AND a one-time backfill of `executions.status IS NULL`. Status stays a `text` column; registry `enumValues` stays the editor source of truth.
- **D3.1-04** — Done-row edits **fully unlocked**. Remove any predicate gating `editable` on `status === 'Done'`. No confirm dialog, no audit log. Default: simplify to `editable: true` boolean.
- **D3.1-05** — **Targeted** hot-path perf fixes only. NOT a rewrite, NOT TanStack, NOT row-store/server-side row model, NOT canvas. Community AG Grid stays.
- **D3.1-10** — Save bar at BOTH top and bottom. ONE source of truth for dirty state + onSaveResult. No double-submit, no divergent counts.
- **D3.1-11** — Custom **paste-block** handler (Excel TSV → many editable cells). Community-only; no Enterprise clipboard. Reuses `setOverride` for derived cells; only writes `fields.*` on EXISTING rows; never introduces an SFID.

### Claude's Discretion (planner picks; research gives a recommendation)
- File layout for off-plan affordance (modal vs inline) — **recommend: modal mirroring `pop-modal.tsx`**.
- Top save bar: second `<SaveBar>` instance with shared handler vs lifted-state — **recommend: lift state into a `useSaveExecutions` hook, render two presentational bars** (§GRID-12).
- Paste listener target (grid `div` vs `document`) — **recommend: grid container ref** (§GRID-13).
- `pgEnum('source')` vs `text` + check constraint — **recommend: `text` + CHECK** (§COMP-04, matches `status` precedent: text + registry enum, no pgEnum).
- Debounce duration — **recommend: 150ms via `useDeferredValue`** (§GRID-09).
- Drop or keep `resolveEditable` — **N/A: it does not exist in the codebase** (see R1). Just keep `editable: true`.
- Status custom single-click editor — **recommend: KEEP `agSelectCellEditor`; add `singleClickEdit` grid option** (§GRID-09).
- One migration vs two — **recommend: ONE migration file** with all DDL + the backfill UPDATE (§Migration Shape).

### Deferred Ideas (OUT OF SCOPE — ignore)
- `createdBy` on exception rows (no per-user identity in v1). A full audit-log table. Automated perf-regression test (manual baseline suffices). Bulk-import of exceptions. Exception-spend dashboard math (Phase 4). Per-activity configurable status defaults.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support (what enables it) |
|----|-------------|------------------------------------|
| GRID-09 | Cell-input no longer laggy; edits land in-place, derived state memoised, baseline proves it | `applyTransaction({update})` (Community, verified) replaces clone-on-edit; `useDeferredValue` debounce; dirty `Set` state; `singleClickEdit` |
| GRID-10 | Status defaults to "In Progress" on placeholders + add-unit clones; backfill NULL→'In Progress' | `buildRowModel` line 153 `fields:{}`, `cloneUnitForAdd` line 209 `fields:{}`, forward SQL migration in `./drizzle` |
| GRID-11 | Done-row edits unlocked; every cell editable | **No lock exists in current source** (R1). Requirement reduces to a regression-guard test asserting Done rows are editable |
| GRID-12 | Save reachable from top + bottom; single dirty source | Lift save into a hook; render 2 bars; keep one Ctrl/Cmd+S listener |
| GRID-13 | Paste a block from Excel into multiple editable cells | Plain DOM `paste` listener (Enterprise clipboard NOT available — verified); `getFocusedCell()` anchor; `getDisplayedRowAtIndex`; `applyTransaction` bulk write |
| COMP-04 | Audited off-plan exception: ONE plan_row `source='exception'` + execution in one tx; distinguishable for dashboard | `commitPlanUpload` tx pattern; 23505 unique-violation catch; merge-delete scoping guard |
</phase_requirements>

---

## Summary

Phase 3.1 is six surgical refinements to an already-shipped, well-tested actuals grid. The codebase is in excellent shape: pure modules (`calc.ts`, `rows.ts`, `filter.ts`, `colDefs.ts`) are fully unit-tested, the Server Action layer (`saveExecutionsBatch`, `commitPlanUpload`) has a clean transaction + Zod + `requireSession` pattern, and the DB layer uses a dual-driver seam (PGlite local / Supabase cloud) with a programmatic migrator. **The single most important finding (R1):** the "P3 lock-on-Done" predicate, the `resolveEditable` helper, the Ctrl/Cmd+S save handler, and the "No status" stat — all referenced in CONTEXT memory IDs 1455/1468/1470/1447/1482 — **do not exist in the current source.** They were reverted (or never landed) before commit `1487` / the design-pass rounds. `colDefs.ts` hard-codes `editable: true`; there is no status-gating predicate anywhere; `save-bar.tsx` has no keydown listener; there is no GridStats component. This means GRID-11 is effectively a no-op-plus-regression-test, and GRID-12's Ctrl/Cmd+S is a *new* addition, not a *preservation*. The planner MUST plan against the actual code, not the memory log.

For perf (GRID-09), the verified lever is AG Grid's **transaction API** (`api.applyTransaction({update:[row]})`), which is Community-edition (confirmed: included in `ClientSideRowModelApiModule`) and updates only the changed row's node in place — eliminating the `setRowMap(new Map(prev))` O(N) clone + `rowData` array rebuild + full `setRowData` reconcile on every keystroke. For bulk entry (GRID-13), AG Grid Community has **no** clipboard, range selection, or fill handle — all are Enterprise (verified against ag-grid.com/clipboard and /community-vs-enterprise). So the paste handler MUST be a plain DOM `paste` listener; `processDataFromClipboard`/`onPasteStart` are off-limits. The same `applyTransaction` call should write the whole pasted block in one shot.

**Primary recommendation:** Adopt `applyTransaction` as the single edit path for BOTH the per-cell hot fix (GRID-09) AND the paste bulk write (GRID-13); track dirty rowKeys in a `Set<string>` state separate from the row data; lift save state into a `useSaveExecutions` hook feeding two presentational bars; ship COMP-04 as a modal + a `commitPlanUpload`-shaped action with a 23505 unique-violation catch and a merge-delete `source='plan-upload'` scoping guard; ship GRID-10 as a one-line forward SQL migration plus two `fields:{status:"In Progress"}` injections; and treat GRID-11 as a regression test because the lock is already gone.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cell-edit responsiveness (GRID-09) | Browser/Client (React + AG Grid) | — | Pure client render hot path; no server involvement per edit |
| Status default on new rows (GRID-10) | API/Pure lib (`rows.ts`) | — | `buildRowModel`/`cloneUnitForAdd` run server-side (page) + client (add-unit); pure functions |
| Status backfill (GRID-10) | Database (migration) | — | One-time forward `UPDATE`; runs via migrator, not app code |
| Done-lock removal (GRID-11) | Pure lib (`colDefs.ts`) | Client | Column def is built client-side from pure mapper; just confirm `editable:true` |
| Off-plan exception (COMP-04) | API/Backend (Server Action + DB) | Client (modal) | Mutation + structural guard MUST be server-side in one transaction (COMP-01 invariant) |
| Top+bottom save bar (GRID-12) | Browser/Client | — | Presentational; one shared submit handler calling the existing action |
| Paste-block (GRID-13) | Browser/Client | API (save path) | Clipboard read + cell mapping is client-only; persistence reuses `saveExecutionsBatch` |

---

## Per-Requirement HOW

### GRID-09 — Hot-path performance

**Current hot path (verified, `actuals-grid.tsx`):** every `onCellValueChanged` calls `setRowMap(prev => new Map(prev))` (line 232) → `rowData = useMemo(Array.from(rowMap.values()), [rowMap])` rebuilds the whole array (line 93) → `<AgGridReact rowData={rowData}>` triggers a full reconcile → `dirtyRows = useMemo(...filter, [rowMap])` re-scans the whole Map (line 328). Separately, the filter `useEffect` (line 106) calls `apiRef.current?.onFilterChanged()` on **every** `sfidSearch` keystroke with no debounce.

**Fix 1 — Replace clone-on-edit with `api.applyTransaction` [VERIFIED: ag-grid.com transaction API is Community via `ClientSideRowModelApiModule`].**
The grid already sets `getRowId={p => p.data.rowKey}` (line 428), which is the prerequisite for transaction updates. Mutate the row object and push it through `applyTransaction({update:[row]})` — AG Grid locates the node by `rowKey` and refreshes only that row (re-running `cellClassRules` and `valueGetter` for it). Keep an authoritative `Map`/ref off-React for save assembly, but stop driving `rowData` from state on every edit.

Concrete shape:
```ts
// Keep the source-of-truth rows in a ref (not state) so edits don't re-render the tree.
const rowsRef = useRef<Map<string, UnitRow>>(/* seed from initialRows */);
// Dirty tracking as a Set of rowKeys in STATE (drives the save bar count only).
const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(() => new Set());

const handleCellValueChanged = useCallback((event: CellValueChangedEvent<UnitRow>) => {
  const { data, colDef, newValue, api } = event;
  if (!data) return;
  const fieldPath = typeof colDef.field === "string" ? colDef.field : "";
  const fieldsKey = fieldPath.startsWith("fields.") ? fieldPath.slice(7) : colDef.colId ?? null;
  if (!fieldsKey || fieldPath.startsWith("plan.")) return;

  const row = rowsRef.current.get(data.rowKey);
  if (!row) return;
  const newFields = { ...row.fields, [fieldsKey]: newValue };
  if (colDef.valueGetter && newValue != null) setOverride(newFields, fieldsKey, true); // D3-05 preserved
  const updated: UnitRow = { ...row, fields: newFields, dirty: true, isPlaceholder: false };
  rowsRef.current.set(data.rowKey, updated);

  // Refresh ONLY this row's node — no full rowData rebuild, no setState churn.
  api.applyTransaction({ update: [updated] });

  setDirtyKeys(prev => prev.has(data.rowKey) ? prev : new Set(prev).add(data.rowKey));
}, []);
```
Note: `applyTransaction({update})` requires you pass an object the grid can match by `getRowId`. The `setDirtyKeys` add is O(1) amortised and only changes when a row *first* becomes dirty (count changes), so the save-bar re-render is rare, not per-keystroke. **The `Set(prev)` clone is still O(N) on first-dirty-of-a-row but NOT per keystroke** — acceptable. For derived cells, `setOverride` keeps the existing D3-05 sticky behaviour (Pitfall-4 guard intact).

**Fix 2 — Memoise / stop recomputing `dirtyRows`.** Replace `dirtyRows = useMemo(Array.from(rowMap.values()).filter(...), [rowMap])` with a derivation from `dirtyKeys`: `const dirtyRows = useMemo(() => [...dirtyKeys].map(k => rowsRef.current.get(k)!).filter(Boolean), [dirtyKeys])`. This recomputes only when the dirty *set* changes, not on every value edit.

**Fix 3 — Debounce the external filter.** The filter `useEffect` re-runs `onFilterChanged()` per keystroke. In React 19 prefer **`useDeferredValue`** over a manual debounce hook (it integrates with concurrent rendering and needs no cleanup):
```ts
const deferredSfid = useDeferredValue(sfidSearch);
useEffect(() => {
  sfidRef.current = deferredSfid;
  facetRef.current = facetSelections;
  apiRef.current?.onFilterChanged();
}, [facetSelections, deferredSfid]);
```
[VERIFIED: React 19 `useDeferredValue` is the idiomatic input-deferral primitive — react.dev/reference/react/useDeferredValue]. `facetSelections` changes are discrete (dropdown clicks), so they don't need deferral; only the typed `sfidSearch` does. A 150ms `setTimeout` debounce hook is an equivalent fallback if the planner prefers explicit control.

**Fix 4 — `singleClickEdit` for status.** The status column uses `agSelectCellEditor`, which requires a double-click to enter edit. Single-click activation IS feasible in Community via the grid-level `singleClickEdit` option (or per-column). Recommend setting `singleClickEdit` on the grid so the most-edited cell (status) opens on one click. This affects ALL editable cells; if that's undesirable for text cells, scope it via `colDef.singleClickEdit` on the status column only. **Do NOT build a custom cell editor** — that's more surface area than the UX win warrants, and risks breaking AG Grid keyboard nav (per CONTEXT discretion note).

**Fix 5 — grid options at scale.** Virtualization is ON by default and MUST stay on (do not set `suppressColumnVirtualisation`/`suppressRowVirtualisation`). `animateRows` defaults to true in v35 and adds layout cost on bulk updates; recommend `animateRows={false}` for a data-entry grid (no value, measurable cost during paste). Keep `stopEditingWhenCellsLoseFocus` (already set).

**Interaction with GRID-13 (LOCKED note):** the paste handler MUST write its whole block via ONE `applyTransaction({update: [...changedRows]})` call, not N `setState`/N `applyTransaction` calls. Same edit path, batched.

**Baseline (D3.1-06):** see §Performance Baseline Approach.

---

### GRID-10 — Default status + backfill

**Injection point 1 — `buildRowModel` placeholder branch (`lib/actuals/rows.ts` line ~147-156).** Currently `fields: {}`. Change to `fields: { status: "In Progress" }`.

**Injection point 2 — `cloneUnitForAdd` (`lib/actuals/rows.ts` line ~202-213).** Currently `fields: {}`. Change to `fields: { status: "In Progress" }`.

**Source-of-truth note:** the string `"In Progress"` is a member of every activity's `enumValues: ["Pending","In Progress","Done"]` (verified in `counter-wall.ts`; memory 1441 says all configs were centralised to a shared `STATUS_VALUES`). To avoid a magic string, the planner MAY import the constant, but a literal is acceptable since the registry enum is the editor source of truth and won't drift for v1. **Do NOT add a `status` default per-activity** (deferred). Recommend a single shared `DEFAULT_STATUS = "In Progress"` constant in `rows.ts` so both injection points reference one symbol.

**Backfill migration (D3.1-07).** Forward-only, single statement:
```sql
UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;
```
This is PGlite- and Supabase-compatible (plain UPDATE). It lands as a new file in `./drizzle` (see §Migration Shape for the exact mechanism — it is a hand-authored statement appended to a generated migration, since `drizzle-kit generate` only emits DDL, not data DML).

**Postgres column default — recommendation: DO NOT add one.** Phase 3 deliberately left `executions.status` nullable with no DB default (verified: `schema.ts` line 101 `status: text("status")`, no `.default()`; migration `0000` line 14 `"status" text`). The registry `enumValues` + the two `buildRowModel`/`cloneUnitForAdd` injections are the single source of truth for new-row defaults. Adding a DB-level `DEFAULT 'In Progress'` would create a *second* authority that could silently diverge from the registry and would mask a future bug where the client forgets to send a status. **Keep the app as the source of truth** (consistent with D3.1-03's explicit wording). The backfill is a one-time data correction, not a schema default.

**"No status" stat (memory 1482) — RECONCILIATION:** there is NO GridStats component and NO "No status" stat anywhere in the current source (grep of `app/` for `stat|Stat|No status` found nothing). It was reverted before the current HEAD. **There is nothing to remove or assert-zero against.** ROADMAP success-criterion 2 ("the 'No status' stat surfaces zero rows after backfill") is therefore satisfied vacuously — after the backfill no execution has NULL status, and there is no UI surfacing it. The planner should note this in the SUMMARY rather than reintroduce a stat just to zero it. (If the team WANTS a visible confirmation, a one-off `SELECT count(*) FROM executions WHERE status IS NULL` returning 0 in the migration test is the cheapest proof.)

**Test seams:**
- Unit (`rows.test.ts`): the existing tests at lines 76-82 ("placeholder row has empty fields") and 211-217 ("cloned row has empty fields") **will break** — they assert `fields` has no non-`__overrides` keys. The planner MUST update these to expect `fields.status === "In Progress"` and adjust the "empty fields" assertions to "only status (+ __overrides)".
- Migration unit test (new, PGlite): seed 3 executions with `status` NULL via raw SQL, run the backfill statement, assert all became `'In Progress'` and a non-NULL row is untouched. Use the exact `executions.test.ts` harness (vi.mock + `ensureMigrated()` + `db.execute(sql\`...\`)`). Idempotency: running the UPDATE twice is naturally idempotent (the WHERE clause matches nothing on the second pass) — assert that explicitly.

---

### GRID-11 — Done-lock removal

**RECONCILIATION (R1 — the most important finding):** The CONTEXT (D3.1-04) and memory IDs 1455/1468/1470 describe removing a `resolveEditable` helper and an `editable` predicate that returns `false` when `status === 'Done'`. **Neither exists in the current source.**

Evidence:
- `lib/actuals/colDefs.ts` read in full: every `editable` assignment is a hard-coded boolean — plan columns `editable: false` (line 79), non-derived actual `editable: true` (line 127), derived actual `editable: true` (line 101). There is NO function-valued `editable`, NO `resolveEditable`, NO `status`/`Done` reference.
- Grep across the repo for `resolveEditable|status === 'Done'|status === "Done"` returned only the planning docs (CONTEXT/ROADMAP), zero source hits.
- `colDefs.test.ts` read in full: it has tests for plan/actual/derived editability but **NO** P3 lock-on-Done test. The test memory 1470 references is not present — it was removed with the feature.

**Conclusion:** The lock was reverted (likely in commit `1487` "grid UX, registry, and tests" or the design-pass rounds f7c0dc5..eaa5bc4). **There is nothing to remove.** GRID-11 collapses to a *regression guard*: add a test to `colDefs.test.ts` proving that editability does NOT depend on row status, so the lock can never silently return.

Proposed regression test (since `editable` is a static boolean, the test asserts that property — there is no per-row evaluation to exercise):
```ts
describe("buildColumnDefs — GRID-11: editability is status-independent (no lock-on-Done)", () => {
  it("every actual column is editable:true regardless of status (boolean, not a function)", () => {
    const cfg = getActivity("counter-wall")!;
    const cols = buildColumnDefs(cfg);
    const actualCols = cols.filter(c => c.field?.startsWith("fields."));
    actualCols.forEach(c => {
      expect(c.editable).toBe(true);          // static true, not a predicate
      expect(typeof c.editable).toBe("boolean"); // guards against a function creeping back
    });
  });
});
```
If the planner finds (during execution) that a lock predicate HAS in fact reappeared on a branch, the removal is trivial: delete the function, restore `editable: true`. But research says: **plan for "confirm + add regression test," not "remove code."** The derived-override path is unaffected either way (derived cells are `editable: true` independent of status — verified line 101).

---

### COMP-04 — Off-plan exception path

**Schema migration (plan_rows).** Add four columns. Recommendation: `text` + CHECK constraint (matches the `status` precedent — no pgEnum — and avoids a Postgres enum migration which is harder to extend later):
```sql
ALTER TABLE "plan_rows" ADD COLUMN "source" text NOT NULL DEFAULT 'plan-upload';
ALTER TABLE "plan_rows" ADD CONSTRAINT "plan_rows_source_check"
  CHECK ("source" IN ('plan-upload','exception'));
ALTER TABLE "plan_rows" ADD COLUMN "exception_reason" text;
ALTER TABLE "plan_rows" ADD COLUMN "created_via" text;
ALTER TABLE "plan_rows" ADD COLUMN "created_at" timestamptz DEFAULT now();
```
Note: `plan_rows` currently has NO `created_at` (verified — `schema.ts` lines 61-90 and migration `0000` lines 41-55). The `DEFAULT 'plan-upload'` backfills every existing row as plan-uploaded automatically (no separate UPDATE needed). Mirror these in `schema.ts` with Drizzle: `source: text("source").notNull().default("plan-upload")`, a `check()` in the table's second-arg array, `exceptionReason: text("exception_reason")`, `createdVia: text("created_via")`, `createdAt: timestamp("created_at",{withTimezone:true}).defaultNow()`. **Generate the migration via `drizzle-kit generate`** (it handles ADD COLUMN + CHECK), then verify the emitted SQL.

**DB helper (`lib/db/plan-rows.ts`).** Add `insertExceptionPlanRow(tx, {...}): Promise<number>` returning the new id — a thin `tx.insert(planRows).values({... source:'exception', exceptionReason, createdVia:'actuals-exception'}).returning()`. Mirror the numeric-stringify discipline from `bulkInsertPlanRows`. Update `PlanRowRecord` and `listByPeriodActivity` to SELECT `source` (and optionally `exception_reason`) so the grid can surface exception rows (see Grid surfacing below). Currently `listByPeriodActivity` does `select()` (all columns), so `source` flows through automatically once the column exists — **but `PlanRowRecord` type and `buildRowModel`'s `planContext` must be extended to carry it** (see below).

**Server Action `addOffPlanExecution` (`lib/actions/executions.ts`, alongside `saveExecutionsBatch`).** Mirror `commitPlanUpload` structure exactly:
1. `await requireSession()` FIRST (the auth boundary — CVE-2025-29927; verbatim helper already in the file).
2. Zod parse: `{ periodId, activity, sfid, dealer, region?, state?, district?, taluka?, distributor?, exceptionReason (required, min 1), fields }`. **`sfid` IS accepted here** (unlike `saveExecutionsBatch`) because the whole point is to introduce a new plan_row — but it is written ONLY to the new `plan_rows.sfid`, never to `executions` (which has no sfid column — structural guard intact).
3. ONE `db.transaction(async tx => {...})`:
   - `const planRowId = await insertExceptionPlanRow(tx, {...})`
   - `const serverFields = applyServerCalc(activity, fields)` — apply the SAME server trust-recompute as `saveExecutionsBatch` (re-derive non-overridden totals; D3-05/Pitfall 9).
   - `await insertExecution(tx, { planRowId, fields: jsonbFields, status, totalSqft, totalCost, perUnitCost, version: 0 })` — extract promoted numeric columns exactly like `saveExecutionsBatch` lines 251-268.
4. `revalidatePath("/actuals")`.
5. Return `{ ok:true, planRowId, executionId }` or a typed error.

**The try/catch is AROUND `db.transaction`, NEVER inside** (Drizzle rollback mechanism — same rule as both existing actions).

**UNIQUE-collision handling (R3 — must not 500).** `plan_rows` has `UNIQUE(period_id, activity, sfid)` (verified — `plan_rows_match_key`). If the user files an exception for an SFID already in the plan, the insert raises SQLSTATE **23505** (`unique_violation`) and the transaction rolls back. The action MUST catch this and return a clean message. Reuse the duck-typed detection shape from `plans.ts` `isFkRestrictError` (note its comment explicitly calls out that 23505 needs a *different* path):
```ts
function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code ?? (err as { code?: string }).code;
  return code === "23505";
}
// ...in catch:
if (isUniqueViolation(err)) {
  return { ok:false, error: "This SFID already exists in the plan for this activity and period — use “+ add unit” on that row instead." };
}
throw err;
```
The `err.cause.code` / `err.code` fallback handles both postgres-js and PGlite wrappers (PGlite obfuscates the DatabaseError class — `instanceof` is unreliable, per the existing comment).

**Re-upload preservation (R4 — CRITICAL, exception rows must survive).** `commitPlanUpload`'s merge (verified, `plans.ts` lines 168-208) computes `toDeleteIds = existing.filter(r => !incomingSet.has(r.sfid))` — i.e. it deletes every plan_row whose SFID is absent from the uploaded file. **An exception SFID is by definition absent from any plan upload, so a future re-upload would DELETE it** (or fail with FK-restrict if it has executions, surfacing as a spurious "blocked dealer"). This violates D3.1-02 ("exception rows survive re-upload"). **Required guard:** scope the delete to `source='plan-upload'`. Two implementation options:
- (a) In the snapshot query (line 170-173), also SELECT `source`, and filter `toDeleteIds` to `r.source === 'plan-upload'`. Simplest, one-file change.
- (b) Pass a `WHERE source='plan-upload'` into `deletePlanRows`. More surface area.
Recommend **(a)**. This is a change to `commitPlanUpload` (a Phase 2 file) — flag it as a required cross-phase edit. Add a regression test: upload plan with SFIDs {A,B}; add exception SFID X; re-upload plan with {A} only; assert B is deleted but X survives.

**Grid surfacing.** Recommend a minimal `cellRenderer` on the SFID plan column that appends an "exception" pill when `plan.source === 'exception'`. For this, `buildRowModel`'s `planContext` (line 130-141) MUST include `source: pr.source` — currently it does not. Add `source: pr.source` to the planContext object. Then in `colDefs.ts`, the SFID plan column gets a `cellRenderer` that checks `p.data?.plan?.source`. Keep it presentational and read-only. (This also requires `PlanRowRecord` to declare `source: string`.)

**UI affordance (recommend: modal mirroring `pop-modal.tsx`).** A "+ off-plan execution" button in the actuals page header (`page.tsx`, next to the activity selector — it's a Server Component, so the button is a small client island, or place it inside `ActualsGrid`). Clicking opens a modal (same fixed-overlay pattern as `pop-modal.tsx`, with `data-slot="offplan-modal"`). Field set, driven by the activity registry:
- **Identity (always):** SFID (required, text), Dealer (required, text), Region / State / District / Taluka / Distributor (optional free-text — these map to the real `plan_rows` who/where columns).
- **Audit:** Reason (required, textarea → `exception_reason`).
- **Actuals:** iterate `getActivity(activityKey).actualColumns` and render one input per `FieldDef` (status as a select from `enumValues`, number/currency as number inputs, date as DD/MM/YY text, lat/long as text). Default status to "In Progress" (D3.1-03). This reuses the registry exactly like the grid does, so a 7th activity needs no modal change (ACTV-03 preserved).
On submit → `addOffPlanExecution` → on success close modal and `router.refresh()` (or rely on `revalidatePath` + a navigation) so the new exception row appears in the grid.

---

### GRID-12 — Save bar top + bottom (single source of truth)

**Current state (verified, `save-bar.tsx`):** `SaveBar` owns its own `useActionState` flow internally — it builds the `units[]` from `dirtyRows` and calls `saveExecutionsBatch`. There is **NO** Ctrl/Cmd+S handler in the file (memory 1447's P2-4 shortcut is NOT in current source — same revert pattern as R1). So GRID-12 adds the keyboard shortcut fresh.

**Recommended design (avoids double-submit + divergent counts):** Lift the action flow OUT of `SaveBar` into a `useSaveExecutions` hook (or directly into `ActualsGrid`), and make `SaveBar` purely presentational. ONE `useActionState`, ONE submit function, ONE `onSaveResult`. Render two `<SaveBar>` instances (top + bottom) that both receive the same `{ dirtyCount, pending, lastResult, onSave }` props.

```ts
// hook (new): lib/actuals/use-save-executions.ts  (or inline in ActualsGrid)
function useSaveExecutions(getDirtyUnits: () => UnitPatch[], activityKey: string, periodId: number, onResult: (r: SaveBatchState) => void) {
  const [state, submit, pending] = useActionState<SaveBatchState, void>(
    async () => saveExecutionsBatch(undefined, { activity: activityKey, periodId, units: getDirtyUnits() }),
    INITIAL_STATE,
  );
  useEffect(() => { if (state !== INITIAL_STATE) onResult(state); }, [state]);
  return { submit, pending, state };
}
```
`ActualsGrid` owns `dirtyKeys` (from GRID-09), derives `dirtyRows`, calls the hook once, and passes `submit`/`pending`/`dirtyCount` to BOTH bars. Because there is ONE `useActionState`, both buttons trigger the same pending state and the same result — no divergence, no double-submit (React serialises the action; disabling on `pending` prevents re-entry).

**Ctrl/Cmd+S (new):** register ONE `keydown` listener at the grid container (or `window`) in `ActualsGrid`:
```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (dirtyKeys.size > 0 && !pending) submit();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [dirtyKeys.size, pending, submit]);
```
This lives in ONE place, drives the same `submit` — so the shortcut works regardless of which bar is visible.

**Sticky positioning.** Top bar: `sticky top-0 z-30` rendered ABOVE the `<div style={{height:600}}>` grid container and BELOW `<FilterBar>`. Bottom bar keeps `sticky bottom-0`. **Z-index watch (R6):** AG Grid's pinned header has its own stacking context; give the top save bar `z-30` (above the grid's default header z-index ~`z-10`-ish) but ensure it's not inside the AG Grid `overflow-x-auto` wrapper (`page.tsx` line 212 wraps the grid in `overflow-x-auto` — a sticky bar inside an `overflow` ancestor sticks to that ancestor, not the viewport). Render both bars as siblings of the grid container inside `ActualsGrid`'s flex column, NOT inside the page's `overflow-x-auto` div. The current bottom bar already works this way.

**`data-slot` contract:** keep `data-slot="save-bar"`, `unsaved-count`, `save-button`, `save-confirmation`. With two bars, the e2e selectors will match TWO elements — scope tests with `.first()`/`.last()` or add `data-slot="save-bar-top"`/`save-bar-bottom`. Recommend the latter for unambiguous e2e.

---

### GRID-13 — Paste-block handler

**Capability confirmation (verified against AG Grid official docs):**
- **Range selection (cell selection): Enterprise** [CITED: ag-grid.com/community-vs-enterprise — "Range Selection" listed under Enterprise].
- **Clipboard (copy/paste, `processDataFromClipboard`, `processCellFromClipboard`, `onPasteStart`/`onPasteEnd`, `ClipboardModule`): Enterprise** [CITED: ag-grid.com/clipboard — "Copying from the grid is enabled by default for enterprise users"; pasting a range from Excel is the Enterprise clipboard feature].
- **Fill handle: Enterprise** (part of range selection).
- **`applyTransaction`/`applyTransactionAsync`: Community** [CITED: ag-grid.com transaction-updates — included in `ClientSideRowModelApiModule`].

**Therefore the handler MUST be a plain DOM `paste` listener** — `processDataFromClipboard` is off-limits. Attach to the grid container ref (recommended over `document` to scope paste to when the grid has focus and avoid hijacking pastes elsewhere on the page).

**Concrete shape:**
```ts
const gridWrapRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const el = gridWrapRef.current;
  if (!el) return;
  const onPaste = (e: ClipboardEvent) => {
    const api = apiRef.current;
    if (!api) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    const focused = api.getFocusedCell();        // { rowIndex, column }
    if (!focused) return;
    e.preventDefault();

    // 1. Parse TSV into a 2-D array (Excel/Sheets clipboard format).
    const matrix = text.replace(/\r\n?$/,"").split(/\r\n|\n|\r/).map(line => line.split("\t"));

    // 2. Build the ordered list of EDITABLE columns at/after the anchor (skip read-only plan.* + action cols).
    const allCols = api.getAllDisplayedColumns();
    const anchorColIdx = allCols.findIndex(c => c.getColId() === focused.column.getColId());
    const editableCols = allCols.slice(anchorColIdx).filter(c => {
      const def = c.getColDef();
      return def.editable === true && typeof def.field === "string" && def.field.startsWith("fields.");
    });

    // 3. Walk displayed rows from the anchor down (respects current sort + external filter).
    const changed: UnitRow[] = [];
    let dropped = 0;
    for (let i = 0; i < matrix.length; i++) {
      const node = api.getDisplayedRowAtIndex(focused.rowIndex + i);
      if (!node?.data) { dropped += matrix[i].length; continue; } // ran off the bottom
      const row = rowsRef.current.get(node.data.rowKey)!;
      const newFields = { ...row.fields };
      for (let j = 0; j < matrix[i].length; j++) {
        const col = editableCols[j];
        if (!col) { dropped++; continue; }                         // ran off the right edge
        const key = (col.getColDef().field as string).slice(7);    // strip "fields."
        const coerced = coerceForKind(matrix[i][j], kindOf(col));   // §coercion below
        newFields[key] = coerced;
        if (col.getColDef().valueGetter && coerced != null) setOverride(newFields, key, true); // derived → override (LOCKED)
      }
      const updated = { ...row, fields: newFields, dirty: true, isPlaceholder: false };
      rowsRef.current.set(node.data.rowKey, updated);
      changed.push(updated);
    }

    // 4. ONE transaction for the whole block (GRID-09 interaction — batched write).
    api.applyTransaction({ update: changed });
    setDirtyKeys(prev => { const s = new Set(prev); changed.forEach(r => s.add(r.rowKey)); return s; });

    // 5. Overflow note.
    if (dropped > 0) notify(`Pasted block; ${dropped} cell(s) outside the editable area were ignored.`);
  };
  el.addEventListener("paste", onPaste);
  return () => el.removeEventListener("paste", onPaste);
}, []);
```

**Anchor on filtered/sorted rows (R5):** using `api.getDisplayedRowAtIndex(focused.rowIndex + i)` and `focused.rowIndex` (which is a *displayed* index) guarantees the paste lands on the rows the user actually sees, in their current sort/filter order — NOT the underlying data order. This is the correct primitive; do not map onto `rowData` array indices.

**Type coercion per column kind.** `lib/excel/*` has parsing helpers (the import path uses per-activity Zod schemas via `parseCommitInput`), but those operate on whole rows, not single cells — there is no cell-level coercer to reuse directly. The `calc.ts` `num()` helper (strips ₹/commas → number|null) is the right primitive for number/currency. Recommend a small local `coerceForKind(raw, kind)`:
- `number`/`currency` → `num(raw)` (reuse `calc.ts`'s logic; export `num` or duplicate the 3-line function).
- `date` → keep as **DD/MM/YY string** (Phase 2 D2 locked DD/MM/YY; ISO rejected). Pass the string through as-is (the `agDateStringCellEditor` and downstream expect the display string); do NOT convert to ISO.
- `text`/`lat`/`long` → as-is string (NEVER numeric-coerce coordinates — existing PITFALL).
- `status`/`enum` → as-is string; optionally validate against `enumValues` and drop/ignore non-members (recommend: accept as-is, let the next save's server validation handle it, to keep the paste forgiving).

**Derived cells (LOCKED):** pasting into a derived cell sets the override flag via `setOverride` (shown in the shape above) — identical to `handleCellValueChanged`'s existing behaviour. Do NOT special-case derived columns out.

**Placeholder promotion:** setting `isPlaceholder:false` + `dirty:true` on a pasted row promotes it; if status wasn't in the pasted block, the default-status rule (D3.1-03) already seeded `fields.status` at row build time, so it persists. The save path's `isEmptyPlaceholder` skip won't drop it (it has meaningful fields).

**Optimistic concurrency / version conflicts:** pasted rows go dirty and save through the SAME `saveExecutionsBatch` batch path, so D3-11 version handling applies unchanged (a stale row pasted-into will conflict on save exactly as a manually-edited stale row does).

**Security invariant (LOCKED):** the handler only writes `fields.*` on EXISTING displayed rows (each already has a `planRowId`). It can NEVER introduce an SFID or bypass the off-plan guard — confirmed by step 2's `field.startsWith("fields.")` filter (plan.* columns are excluded).

**e2e (Playwright):** simulate paste by dispatching a `ClipboardEvent` with a `DataTransfer` carrying `text/plain` TSV, after focusing an anchor cell. Sketch:
```ts
await page.locator('.ag-row[row-index="0"] [col-id="fields.actualSqft"]').click(); // set focused cell
await page.evaluate((tsv) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", tsv);
  const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
  document.querySelector('[data-slot="actuals-grid"]')!.dispatchEvent(ev);
}, "10\t20\n30\t40");
```
Note: Chromium may require `--enable-blink-features=ClipboardCustomFormats` or granting clipboard permissions; dispatching a synthetic `ClipboardEvent` with a constructed `DataTransfer` (as above) avoids real-clipboard permissions entirely and is the robust approach. Verify the focused cell is set (the existing e2e uses `.dblclick()`; for paste you want a single `.click()` to focus without entering edit mode).

---

## AG Grid Community Capability Table (free vs Enterprise)

| Feature | Edition | Source | Phase 3.1 impact |
|---------|---------|--------|------------------|
| `applyTransaction` / `applyTransactionAsync` | **Community** (`ClientSideRowModelApiModule`) | [CITED: ag-grid.com/data-update-transactions] | Core lever for GRID-09 + GRID-13 |
| Row + column virtualization | **Community** (on by default) | [CITED: CLAUDE.md stack table; ag-grid docs] | Keep ON; never suppress |
| Inline cell editing, cellEditor framework | **Community** | already in use | unchanged |
| External filter (`isExternalFilterPresent`/`doesExternalFilterPass`) | **Community** | already in use | unchanged |
| `getFocusedCell`, `getDisplayedRowAtIndex`, `getAllDisplayedColumns` | **Community** | grid API | Paste anchor + mapping |
| `singleClickEdit` grid/col option | **Community** | [ASSUMED — standard Community option; verify in v35 API] | Status single-click (GRID-09) |
| `refreshCells` (change-detection refresh) | **Community** | [CITED: ag-grid.com/view-refresh] | already used; cheap |
| **Range Selection / Cell Selection** | **Enterprise** | [CITED: ag-grid.com/community-vs-enterprise] | NOT available → custom paste |
| **Clipboard (copy/paste, range paste)** | **Enterprise** | [CITED: ag-grid.com/clipboard] | NOT available → custom DOM listener |
| **`processDataFromClipboard` / `processCellFromClipboard`** | **Enterprise** | [CITED: ag-grid.com/clipboard] | CANNOT use → plain `paste` event |
| **`onPasteStart` / `onPasteEnd` events** | **Enterprise** | [CITED: ag-grid.com/clipboard] | CANNOT use |
| **Fill handle** | **Enterprise** | [CITED: ag-grid.com/clipboard, range-selection] | NOT available |
| **Set Filter / Multi Filter / native Excel export** | **Enterprise** | [CITED: CLAUDE.md "What NOT to Use"] | unchanged from Phase 3 |

**Net:** every bulk-clipboard convenience is Enterprise. GRID-13 is necessarily a hand-rolled DOM handler. The transaction API — the one thing GRID-09/13 actually need — is Community.

---

## `applyTransaction` API (used by both GRID-09 and GRID-13)

[VERIFIED: ag-grid.com — Community via `ClientSideRowModelApiModule`; `AllCommunityModule` is already registered in `ag-grid-setup.ts`]

```ts
// RowDataTransaction shape:
type RowDataTransaction<T> = { add?: T[]; update?: T[]; remove?: T[]; addIndex?: number };

// Single-row update (GRID-09 per-cell):
api.applyTransaction({ update: [updatedRow] });

// Bulk update (GRID-13 paste block — ONE call for the whole block):
api.applyTransaction({ update: changedRows });

// Returns a RowNodeTransaction (the affected nodes), not row data.
```
**Prerequisites (all already satisfied):** `getRowId={p => p.data.rowKey}` is set (line 428) — required so the grid matches the updated object to its existing node by id instead of object reference. When matched, AG Grid refreshes only that row's cells (re-running `valueGetter` + `cellClassRules` for it), avoiding the full-grid reconcile that `rowData={newArray}` causes. **You no longer pass a fresh `rowData` array on every edit** — that's the whole point.

`applyTransactionAsync` batches multiple calls into the next animation frame (useful if you ever fire many single-row updates in a tight loop); for GRID-13 a single `applyTransaction({update: changedRows})` is simpler and sufficient. For GRID-09 per-keystroke, `applyTransaction` (sync) is fine — it's already scoped to one row.

---

## Migration Shape

**Mechanism (verified):**
- Schema is `lib/db/schema.ts`. `drizzle.config.ts` → `out: "./drizzle"`, `dialect: "postgresql"`, `driver: "pglite"`.
- `npm run db:generate` (`drizzle-kit generate`) reads the schema and emits a numbered `.sql` file into `./drizzle` + a snapshot under `./drizzle/meta/` + updates `_journal.json`. **It only emits DDL, never data DML.**
- Local apply: `lib/db/migrate.ts` → `ensureMigrated()` runs the PGlite migrator over `./drizzle` (no-op when `DATABASE_URL` is `postgres://`). Called from `instrumentation.ts` at boot and `npm run db:migrate:local`. Tests call `ensureMigrated()` in `beforeAll`.
- Cloud apply: `npm run db:migrate:prod` (`drizzle-kit migrate --config=drizzle.config.prod.ts`) against the direct Supabase URL at deploy.
- Existing files: `0000_abnormal_magneto.sql` (initial), `0001_wealthy_caretaker.sql` (the partial-unique active-period index). Statements separated by `--> statement-breakpoint`.

**Recommended approach — ONE new migration `0002_*.sql` containing BOTH the COMP-04 DDL and the GRID-10 backfill DML:**
1. Add the four `plan_rows` columns + CHECK to `schema.ts`, run `drizzle-kit generate` → produces `0002_*.sql` with the ADD COLUMN + CHECK statements (and the snapshot/journal updates). Verify the emitted SQL matches the §COMP-04 DDL.
2. **Hand-append** the backfill statement to the SAME generated file (drizzle won't generate it because it's data, not schema):
```sql
--> statement-breakpoint
UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;
```
Appending to a generated migration is safe — the PGlite migrator and `drizzle-kit migrate` both execute every statement in the file by breakpoint. (If the planner prefers strict separation, split into `0002_*` for DDL and a `0003_*` hand-authored for the backfill — both apply via the same mechanism. Recommend ONE file for atomicity: the backfill and the schema change ship together.)

**Test pattern (PGlite, from `executions.test.ts`):**
- `vitest.config.ts` sets `DATABASE_URL=memory://` (in-memory PGlite, isolated from the dev `./.pglite`).
- `beforeAll(() => ensureMigrated())` applies all migrations including `0002`.
- The three `vi.mock` blocks (`next/headers`, `next/cache`, `../auth/session`) are required for any test that touches a Server Action.
- FK-safe reset order in `beforeEach`: `_resetExecutionItemsForTest` → `_resetExecutionsForTest` → `_resetPlanRowsForTest` → `_resetPeriodsForTest`.
- Migration test: seed NULL-status executions via `db.execute(sql\`...\`)`, then run the backfill UPDATE (or assert it already ran via `ensureMigrated`), assert all NULL→'In Progress' and a pre-set non-NULL row untouched; assert idempotency (second UPDATE matches 0 rows).

---

## File-Touch Inventory (grouped by requirement)

**GRID-09 (perf):**
- MODIFY `app/(app)/actuals/actuals-grid.tsx` — replace clone-on-edit with `applyTransaction`; `dirtyKeys` Set state + `rowsRef`; `useDeferredValue` for filter; `singleClickEdit`; `animateRows={false}`.
- READ `lib/actuals/calc.ts` (`setOverride` reuse — no change).
- NEW `phases/03_1-.../baseline-perf.md` (before/after numbers).

**GRID-10 (default status + backfill):**
- MODIFY `lib/actuals/rows.ts` — `fields:{status:"In Progress"}` in placeholder branch (~line 153) and `cloneUnitForAdd` (~line 209); add `DEFAULT_STATUS` const.
- MODIFY `lib/actuals/rows.test.ts` — update "empty fields" assertions (lines 76-82, 211-217) to expect status.
- NEW migration `drizzle/0002_*.sql` — backfill UPDATE (+ COMP-04 DDL if combined).
- NEW `lib/db/<migration>.test.ts` (or extend an existing DB test) — backfill unit test.

**GRID-11 (Done-lock — confirm + regression guard):**
- READ `lib/actuals/colDefs.ts` — confirm `editable:true` (no change expected; R1).
- MODIFY `lib/actuals/colDefs.test.ts` — add status-independent-editability regression test.

**COMP-04 (off-plan exception):**
- MODIFY `lib/db/schema.ts` — add `source`/`exception_reason`/`created_via`/`created_at` to `planRows` + `check()`.
- MODIFY `lib/db/plan-rows.ts` — extend `PlanRowRecord` (+`source`); add `insertExceptionPlanRow`; ensure `listByPeriodActivity` surfaces `source` (it `select()`s all cols already).
- MODIFY `lib/actions/executions.ts` — add `addOffPlanExecution` action + `isUniqueViolation` helper; reuse `applyServerCalc`.
- MODIFY `lib/actions/plans.ts` — **scope merge-delete to `source='plan-upload'`** (R4 guard); SELECT `source` in the snapshot.
- MODIFY `lib/actuals/rows.ts` — add `source: pr.source` to `planContext`.
- MODIFY `lib/actuals/colDefs.ts` — SFID plan-column `cellRenderer` exception pill.
- NEW `app/(app)/actuals/offplan-modal.tsx` — modal mirroring `pop-modal.tsx`.
- MODIFY `app/(app)/actuals/actuals-grid.tsx` or `page.tsx` — "+ off-plan execution" button wiring.
- NEW/MODIFY tests: `lib/actions/executions.test.ts` (add `addOffPlanExecution` cases: happy path, dupe-SFID 23505, tx rollback), `lib/actions/plans.test.ts` (re-upload preserves exception rows).
- NEW e2e in `e2e/actuals.spec.ts` — off-plan affordance.

**GRID-12 (save bar top+bottom):**
- NEW `lib/actuals/use-save-executions.ts` (or inline in `ActualsGrid`).
- MODIFY `app/(app)/actuals/save-bar.tsx` — make presentational (props in, no internal `useActionState`); add `data-slot="save-bar-top"`/`-bottom`.
- MODIFY `app/(app)/actuals/actuals-grid.tsx` — render two bars; add Ctrl/Cmd+S `keydown` listener.
- MODIFY `e2e/actuals.spec.ts` — selectors for two bars.

**GRID-13 (paste):**
- MODIFY `app/(app)/actuals/actuals-grid.tsx` — `paste` listener on grid wrapper ref; `coerceForKind`; one `applyTransaction`.
- MODIFY/READ `lib/actuals/calc.ts` — export `num` for coercion reuse (or duplicate locally).
- NEW unit test for `coerceForKind`.
- NEW e2e in `e2e/actuals.spec.ts` — synthetic ClipboardEvent paste.

---

## Risks / Landmines

- **R1 — Memory vs source mismatch (lock-on-Done, resolveEditable, Ctrl+S, "No status" stat).** CONTEXT memory IDs 1455/1468/1470/1447/1482 describe features that **are not in current source** (verified by reading `colDefs.ts`, `save-bar.tsx` in full + repo-wide grep). They were reverted before HEAD. **Impact:** GRID-11 is a regression test, not a removal; GRID-12's Ctrl/Cmd+S is a NEW feature; GRID-10's "No status" stat has nothing to zero out. Plan against the code, and have the planner re-grep at execution start to confirm (a branch could differ). This is the single biggest planning hazard.
- **R3 — Dupe-SFID UNIQUE 23505.** Exception insert on an existing SFID violates `plan_rows_match_key` → MUST be caught (duck-type `err.cause.code === '23505'`) and returned as a clean message, never a 500. `plans.ts`'s `isFkRestrictError` explicitly does NOT cover 23505 — write a sibling `isUniqueViolation`.
- **R4 — Re-upload deletes exception rows.** `commitPlanUpload` deletes any plan_row whose SFID isn't in the upload; exception SFIDs are never in an upload → they'd be deleted (or throw FK-restrict). MUST scope the merge-delete to `source='plan-upload'`. This edits a Phase 2 file — flag as a required cross-phase change with its own regression test.
- **R5 — Paste anchor on filtered/sorted rows.** Map the pasted block onto **displayed** rows via `getDisplayedRowAtIndex(focusedRowIndex + i)`, NOT onto `rowData` array indices, or paste lands on the wrong rows when a filter/sort is active.
- **R6 — Two save bars: double-submit + sticky/overflow + z-index.** ONE `useActionState` shared by both bars prevents double-submit/divergent counts (LOCKED invariant). The sticky bar must NOT be nested inside `page.tsx`'s `overflow-x-auto` wrapper (line 212) or it sticks to that box, not the viewport — render both bars as siblings of the grid container inside `ActualsGrid`. Give the top bar `z-30` to clear AG Grid's header stacking context.
- **R7 — Clipboard hooks are Enterprise.** `processDataFromClipboard`/`onPasteStart`/range/fill are ALL Enterprise (verified). Using them silently fails / requires a paid key. GRID-13 must be a plain DOM `paste` listener.
- **R8 — `rows.test.ts` breaks on the default-status change.** Two existing tests assert placeholder/clone `fields` is empty. They WILL fail after GRID-10. Update them in the same task, or the suite goes red.
- **R9 — Appending DML to a generated migration.** `drizzle-kit generate` won't emit the backfill UPDATE; it must be hand-appended (with a `--> statement-breakpoint`) or shipped as a separate hand-authored migration. Don't expect `generate` to produce it.
- **R10 — `applyTransaction` requires the row object match `getRowId`.** Already satisfied (`getRowId` returns `rowKey`), but if a refactor drops `getRowId`, transactions silently fall back to slow object-reference matching. Keep `getRowId`.
- **R11 — PGlite migration ordering in tests.** `ensureMigrated()` applies ALL migrations in `_journal.json` order. A new `0002` must be journaled by `drizzle-kit generate` (don't hand-create the `.sql` without updating the journal/snapshot, or the migrator skips or mis-orders it).
- **R12 — Server trust-recompute must apply to `addOffPlanExecution`.** Reuse `applyServerCalc` so exception-row derived totals are server-authoritative (D3-05/Pitfall 9), identical to `saveExecutionsBatch`. A client could otherwise lie about totals on the exception path.
- **R13 — Stack doc vs reality (Neon vs Supabase).** CLAUDE.md's prescriptive stack names Neon + `@neondatabase/serverless`; the ACTUAL code uses PGlite (local) + postgres-js→Supabase (cloud). Research/plans must follow the CODE (Supabase/PGlite), not the aspirational stack table. No Neon driver is installed.

---

## Performance Baseline Approach (D3.1-06 → makes GRID-09 verifiable)

1. **Seed a realistic period (~500 plan_rows).** No bulk seed helper exists for 500 rows; the available seams are `/api/test/seed-execution` (one row, gated) and `_seedExecutionForTest`. Recommend a small **dev-only** seed script (`tsx`-run, like the `__smoke__` scripts) that inserts one period + ~500 `plan_rows` across activities via `db.execute`, OR a temporary loop in a smoke file. Mirror `__smoke__/executions.ts` (insert period → loop plan_rows). Keep it out of app code.
2. **Scripted scenario (Chrome DevTools Performance):** open `/actuals?activity=counter-wall`, focus "Actual Sq Ft", type 10 chars → Tab → toggle status → paste a 10×5 block. Record the profile; capture scripting time per keystroke and frames.
3. **Targets:** "<16ms per keystroke" (one frame) OR ≥50% reduction in scripting time per edit vs baseline.
4. **Write `phases/03_1-.../baseline-perf.md`** with before/after numbers (markdown notes only, no LFS). Put the side-by-side in SUMMARY.md.
5. Capture baseline BEFORE any perf change lands (so the before-number is the current clone-on-edit path).

---

## Validation Architecture

> nyquist_validation is enabled (no `.planning/config.json` opt-out found). Test framework: **Vitest 4.1.8** (unit/contract, `lib/**`) + **Playwright** (e2e, `e2e/**`). PGlite `memory://` for DB tests; `vi.mock` for Server Action context.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.8 (unit) + Playwright ^1.60 (e2e) |
| Config file | `vitest.config.ts` (`DATABASE_URL=memory://`), `playwright.config.ts` |
| Quick run command | `npm test` (= `vitest run`, single file: `vitest run lib/actuals/rows.test.ts`) |
| Full suite command | `npm test` then `npm run e2e` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | Exists? |
|-----|----------|------|---------|---------|
| GRID-09 | edit via applyTransaction marks dirty, no full re-render | manual perf baseline + e2e edit-persists | `npm run e2e` (existing test 1) | ✅ baseline ❌ |
| GRID-10 | placeholder/clone default status; backfill NULL→IP | unit + migration unit | `vitest run lib/actuals/rows.test.ts`, new migration test | ⚠️ existing tests need update |
| GRID-11 | editability status-independent | unit (regression) | `vitest run lib/actuals/colDefs.test.ts` | ❌ Wave 0 |
| GRID-12 | two bars, one dirty count, Ctrl/Cmd+S, no double-submit | e2e | `npm run e2e` | ❌ Wave 0 |
| GRID-13 | paste block → multi-cell, coercion, skip read-only, overflow drop | unit (coerce) + e2e (synthetic paste) | `vitest run`, `npm run e2e` | ❌ Wave 0 |
| COMP-04 | exception tx integrity, dupe-SFID 23505, re-upload preservation | unit (action) + e2e (modal) | `vitest run lib/actions/executions.test.ts`, `plans.test.ts` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `vitest run <touched-test-file>`.
- **Per wave merge:** `npm test` (full vitest).
- **Phase gate:** full `npm test` + `npm run e2e` green before `/gsd:verify-work`.

### The 4 Sampling Dimensions (for VALIDATION.md)
1. **Perf across activity types × dataset size.** Sample: `measurement` (counter-wall, derived totals), `item-list` (pop-dealer-kit, modal/kit), `status-only` (dealer-certificate) at ~50 and ~500 rows. Confirms `applyTransaction` win generalises and virtualization holds; catches a regression that only shows on derived-heavy or modal activities.
2. **Status default + backfill across all six activities + idempotency.** Sample: placeholder default for each of the 6 registry activities (they share `enumValues`, so one parametrised test covers all); backfill on a mixed NULL/non-NULL set; run backfill twice (idempotent — second pass touches 0 rows).
3. **Off-plan exception across activities + failure modes.** Sample: happy-path exception for a measurement and a status-only activity (proves registry-driven field set); dupe-SFID → 23505 clean error (not 500); transaction rollback (plan_row insert succeeds but execution insert fails → neither persists); re-upload preserves `source='exception'` while deleting an orphaned `source='plan-upload'` row.
4. **Paste-block across coercion kinds + boundaries.** Sample: number/currency (₹/comma strip via `num`), date (DD/MM/YY passthrough, NOT ISO), text/lat-long (no numeric coercion); read-only `plan.*` column skipped in the editable-column walk; overflow (block wider/taller than remaining editable area → silent drop + count note); paste into a placeholder promotes it and the default status survives.

---

## Security Domain

> `security_enforcement` not set to false → included. This phase adds ONE new mutation surface (`addOffPlanExecution`) and one new read path (exception rows in the grid).

### Applicable ASVS Categories
| ASVS | Applies | Standard Control (this codebase) |
|------|---------|----------------------------------|
| V2 Authentication | yes | `requireSession()` (jose JWT cookie) FIRST statement in `addOffPlanExecution` — same as both existing actions (CVE-2025-29927: middleware is UX gate, action is the boundary) |
| V4 Access Control | yes | Shared-password model; no per-user identity (so no `createdBy`). Off-plan guard is STRUCTURAL (FK NOT NULL ON DELETE RESTRICT) — the exception path inserts a plan_row FIRST then the execution; it never adds an sfid to `executions` nor bypasses the FK (COMP-01 preserved) |
| V5 Input Validation | yes | **Zod on `addOffPlanExecution` input** (sfid/dealer/reason/fields), mirroring `saveExecutionsBatch`/`commitPlanUpload`. Reason required (min 1). `applyServerCalc` re-derives totals server-side (no trusting client totals) |
| V6 Cryptography | no | No new crypto; session signing unchanged (`jose`) |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Mitigation (this phase) |
|---------|--------|-------------------------|
| SQL injection | Tampering | Drizzle parameterized queries / `sql\`\`` tagged templates throughout; no string concat with user input |
| Off-plan bypass (inject sfid into executions) | Tampering/Elevation | `executions` has no sfid column; exception path writes sfid only to a NEW `plan_rows` row, then FKs the execution to it. The paste handler writes only `fields.*` on existing rows — cannot introduce an SFID |
| Client-lied totals on exception spend | Tampering | `applyServerCalc` server trust-recompute on `addOffPlanExecution` (R12) |
| Auth bypass via direct action call | Elevation | `requireSession()` first; throws Unauthorized before any DB touch (test: `auth-rejected`) |
| DoS via oversized payload | DoS | Exception action is single-row (no array); Zod bounds string lengths. Paste batch saves through `saveExecutionsBatch` which caps `units` at 2000 |
| Test-seed route in prod | Elevation | `/api/test/seed-execution` triple-gated (NODE_ENV≠production, session, POST-only) — unchanged |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `singleClickEdit` exists as a grid/column option in AG Grid Community v35 | GRID-09, capability table | LOW — if absent, status stays double-click (UX nicety lost, no functional break); verify in v35 API before relying on it |
| A2 | The four `1455/1468/1470/1447/1482` features are reverted on `master` HEAD (not just on another branch) | R1, GRID-11/12 | MEDIUM — re-grep at execution start; if a lock exists on the working branch, GRID-11 becomes a small removal (still easy) |
| A3 | Appending a DML statement to a `drizzle-kit generate`d migration file applies cleanly via both the PGlite migrator and `drizzle-kit migrate` | Migration Shape, R9 | LOW — both execute every breakpoint-separated statement; if the planner is uneasy, ship the backfill as a separate hand-authored `0003` |
| A4 | A synthetic `ClipboardEvent` + constructed `DataTransfer` dispatched on the grid container triggers the `paste` listener in Playwright Chromium without clipboard permissions | GRID-13 e2e | LOW — standard technique; fallback is granting `clipboard-read/write` permissions and using the real clipboard API |
| A5 | `getDisplayedRowAtIndex` / `getAllDisplayedColumns` / `getFocusedCell` are stable Community APIs in v35 | GRID-13 | LOW — long-standing core grid APIs; verify method names against installed `ag-grid-community@35.3.1` types |

---

## Sources

### Primary (HIGH)
- Read in full: `actuals-grid.tsx`, `page.tsx`, `colDefs.ts`, `rows.ts`, `calc.ts`, `filter.ts`, `executions.ts` (action + db), `plans.ts`, `schema.ts`, `plan-rows.ts`, `save-bar.tsx`, `pop-modal.tsx`, `filter-bar.tsx`, `ag-grid-setup.ts`, `registry.ts`, `counter-wall.ts`, `types.ts`, `migrate.ts`, `migrate-cli.ts`, `index.ts`, `vitest.config.ts`, `drizzle.config.ts`, `0000_*.sql`, `0001_*.sql`, `colDefs.test.ts`, `rows.test.ts`, `executions.test.ts`, `__smoke__/executions.ts`, `seed-execution/route.ts`, `package.json` — establishes the actual current state (overrides memory log; see R1).
- Repo-wide grep for `resolveEditable|status === 'Done'|metaKey|ctrlKey|No status|GridStats|STATUS_VALUES|editable` — confirms lock/shortcut/stat absence (R1).
- ag-grid.com/javascript-data-grid/community-vs-enterprise/ — Range Selection + Clipboard are Enterprise. [HIGH]
- ag-grid.com/javascript-data-grid/clipboard/ — copy/paste, `processDataFromClipboard`, `onPasteStart`, `ClipboardModule` are Enterprise. [HIGH]
- ag-grid.com/react-data-grid/data-update-transactions/ — `applyTransaction`/`applyTransactionAsync` Community via `ClientSideRowModelApiModule`; RowDataTransaction shape; `getRowId` integration. [HIGH]
- ag-grid.com/react-data-grid/view-refresh/ — `refreshCells` change-detection vs `redrawRows`. [HIGH]

### Secondary (MEDIUM)
- react.dev `useDeferredValue` — React 19 input-deferral idiom (GRID-09 debounce). [MEDIUM — standard React 19 API]
- CLAUDE.md stack tables — version pins, AG Grid Community/Enterprise feature split, Excel CVE notes. [HIGH for versions, contextual]

### Tertiary (LOW / to verify at execution)
- `singleClickEdit` v35 availability (A1); `getDisplayedRowAtIndex`/`getAllDisplayedColumns` v35 names (A5) — verify against installed `ag-grid-community@35.3.1` types.

## Metadata
**Confidence breakdown:**
- Per-requirement HOW: HIGH — grounded in read source + verified AG Grid docs.
- AG Grid capability split (clipboard/range Enterprise; transaction Community): HIGH — official docs.
- R1 reconciliation (lock/shortcut/stat absent): HIGH — full file reads + grep, zero source hits.
- Migration mechanism: HIGH — read config + migrator + existing migrations + test harness.
- `singleClickEdit` / paste-API method names in v35: MEDIUM — standard APIs, flagged for execution-time verification.

**Research date:** 2026-06-08
**Valid until:** ~2026-07-08 (stable internal codebase; AG Grid 35.x pinned). Re-grep R1 at execution start regardless.

## RESEARCH COMPLETE
