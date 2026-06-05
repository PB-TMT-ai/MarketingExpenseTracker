# Phase 2: plan-upload-and-periods — Pattern Map

**Mapped:** 2026-06-05
**Files analyzed:** 11 new + 1 modified
**Analogs found:** 8 / 11 (3 pure-function modules have no analog — fresh code)

## File Classification

| New file | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `lib/excel/parse.ts` | utility (pure) | transform (File→rows) | none | **fresh** |
| `lib/excel/template.ts` | utility (pure) | transform (cols→Blob) | none | **fresh** |
| `lib/excel/validate.ts` | utility (pure) | transform (rows→report) | none | **fresh** |
| `lib/db/queries/plans.ts` | model/query | CRUD (batch) | `lib/db/periods.ts` | role+flow |
| `lib/actions/plans.ts` | controller (Server Action) | request-response (batch) | `lib/actions/periods.ts` (`createPeriod`) | role-match |
| `lib/actions/plans.test.ts` | test | request-response | `lib/actions/periods.test.ts` | exact |
| `lib/db/__smoke__/plan-upload.ts` | smoke (live DB) | event-driven (assert) | `lib/db/__smoke__/item-master.ts` | exact |
| `app/(app)/plans/page.tsx` | server component | request-response | `app/(app)/periods/page.tsx` | exact |
| `app/(app)/plans/upload/page.tsx` | server component | request-response | `app/(app)/periods/page.tsx` | role-match |
| `app/(app)/plans/upload/upload-form.tsx` | client component | event-driven | `app/(app)/periods/period-form.tsx` | role+flow |
| `e2e/plans.spec.ts` | test (e2e) | request-response | `e2e/periods.spec.ts` | exact |

---

## Pattern Assignments

### `lib/actions/plans.ts` — `commitPlanUpload`
- **Analog:** [lib/actions/periods.ts](../../../lib/actions/periods.ts) — `createPeriod` (L39–67) + `setActivePeriod` (L75–88)
- **Follow:** `"use server"` header → local `async function requireSession()` (copy L15–20 verbatim) → `z.object({...}).safeParse(...)` over `formData.get(...)` → on failure `return { error: parsed.error.issues[0]?.message }` → call query layer → `revalidatePath("/plans")` → `return { ok: true, ... }`. State shape **must** be `{ ok?: true; error?: string; ... }` so it slots into `useActionState`.
- **Diverges:** payload is `{ periodId, activity, rows: ParsedRow[] }` not a single record — Zod schema validates `rows: z.array(rowSchema).min(1)`; body wraps `db.transaction(async (tx) => …)` doing diff→insert/update/delete in one atomic batch; **must catch SQLSTATE 23503** on the delete branch and translate to `{ ok: false, blockedDealers: string[] }` (the off-plan-guard FK from `executions.plan_row_id`). Do not throw — return the state.

### `lib/db/queries/plans.ts`
- **Analog:** [lib/db/periods.ts](../../../lib/db/periods.ts)
- **Follow:** module header comment ("Typed query helpers for…NO business rules live here") → exported `type PlanRow = {...}` + `type NewPlanRow = {...}` → named async functions returning `Promise<X[]>` / `Promise<number>` → use `db.select().from(...)`, `db.insert(...).returning()`, `db.update(...).set(...).where(eq(...))`, `db.transaction(async (tx) => ...)` (see `setActiveTx` L65–73) → expose `_resetPlanRowsForTest()` for vitest (`delete from plan_rows`).
- **Diverges:** functions are list/diff/insert/update/delete keyed on `(periodId, activity, sfid)`; `diffPlanRows(existing, incoming)` is the pure helper that classifies each incoming row as `insert | update | delete | unchanged` before the action calls the mutating helpers. **No** business rule (FK RESTRICT is the DB; the diff is just sets-math).

### `lib/excel/parse.ts` — **no analog (fresh module)**
- **Convention:** plain `.ts` under `lib/excel/`, framework-free (no `next`, no react, no `db`) — mirror the rule from `lib/activities/types.ts` L4–7. Named exports only, no default, no class.
- **Shape:** `export type ParsedRow = {...}`; `export function parseWorkbook(buf: ArrayBuffer, activity: ActivityKey): { ok: true; rows: ParsedRow[] } | { ok: false; error: string }` — tagged union, never throw for "expected" failures (wrong headers, empty file). SheetJS import: `import * as XLSX from "xlsx"` (CDN tarball per CLAUDE.md, never npm).
- **Diverges:** N/A — establishes the `lib/excel/*` convention.

### `lib/excel/template.ts` — **no analog (fresh module)**
- **Convention:** same as `parse.ts` — pure, framework-free, named exports.
- **Shape:** `export function buildPlanTemplate(activity: ActivityKey): Blob` — reads `getActivityConfig(activity).planColumns` (registry is the single source of column labels per ACTV-01..03) and uses `XLSX.utils.aoa_to_sheet` / `XLSX.write({ type: "array" })`. Returns Blob so a `<a download>` can consume it directly.

### `lib/excel/validate.ts` — **no analog (fresh module)**
- **Convention:** same — pure, framework-free, named exports.
- **Shape:** `export type ValidationReport = { ok: true; rows: ValidRow[] } | { ok: false; duplicates: SfidGroup[]; fieldErrors: FieldError[] }`. Single `validateRows(rows: ParsedRow[], cfg: ActivityConfig): ValidationReport`. Closest existing pure-function lib is the activities registry — copy that "framework-free + only `import type`" discipline.

### `lib/actions/plans.test.ts`
- **Analog:** [lib/actions/periods.test.ts](../../../lib/actions/periods.test.ts)
- **Follow:** copy the four `vi.mock(...)` blocks verbatim (L14–28: `next/headers`, `next/cache`, `../auth/session`) — they MUST appear **before** any `import` that pulls the action; `beforeAll(ensureMigrated)` + `beforeEach(_resetPlanRowsForTest)` (L42–48); `function fd(values)` helper (L96–100); split into two `describe` blocks — `lib/db/queries/plans` then `lib/actions/plans (Zod + auth re-check)`.
- **Diverges:** must exercise the FK-blocked branch — seed a plan row, insert an execution against it via raw SQL, then re-run `commitPlanUpload` with that sfid removed and assert `state.ok === false && state.blockedDealers.length === 1`.

### `lib/db/__smoke__/plan-upload.ts`
- **Analog:** [lib/db/__smoke__/item-master.ts](../../../lib/db/__smoke__/item-master.ts)
- **Follow:** **`console.log` + `process.exit(0|1)`** harness (NOT vitest). Copy verbatim: `function assert(cond, msg)` (L20–26), `main()` that ends `console.log("…PROVEN: …")` + `process.exit(0)`, the trailing `void main().catch((err) => { … process.exit(1) })` (L92–96). Run path: `npm run plans:smoke` (add to `package.json` like `items:smoke`).
- **Diverges:** assertion is that FK RESTRICT fires — wrap the mirror-delete in `try { … } catch (e: any) { assert(e.code === "23503", …) }` and prove the row is still present afterward.

### `app/(app)/plans/page.tsx`
- **Analog:** [app/(app)/periods/page.tsx](../../../app/(app)/periods/page.tsx)
- **Follow:** `export const dynamic = "force-dynamic"`; `async function PlansPage()` reads via query helper; outer `<div className="mx-auto grid max-w-3xl gap-6">`; `<header>` with `text-xl font-semibold` h1 + `text-sm text-neutral-600` p; section card `rounded-xl border border-neutral-200 bg-white shadow-sm` with `<h2>` header bar; empty-state `<p className="p-6 text-sm text-neutral-500">`; list as `<ul data-slot="..." className="divide-y divide-neutral-200">` — re-use `data-slot` naming for e2e selectors.
- **Diverges:** rows are `(activity × period)` cards, not periods; each card links to `/plans/upload?activity=X&periodId=Y` to re-upload.

### `app/(app)/plans/upload/page.tsx`
- **Analog:** [app/(app)/periods/page.tsx](../../../app/(app)/periods/page.tsx) (the "Server Component reads DB, renders Client form" shape)
- **Follow:** server component reads `listPeriods()` + `getAllActivityConfigs()`, passes both to the Client form as props.
- **Diverges:** no DB write here; page is purely a host for the upload-form Client Component.

### `app/(app)/plans/upload/upload-form.tsx`
- **Analog:** [app/(app)/periods/period-form.tsx](../../../app/(app)/periods/period-form.tsx)
- **Follow:** `"use client"`; `useActionState<CommitPlanState, FormData>(commitPlanUpload, {})`; `formRef.current?.reset()` in `useEffect` on `state.ok`; styling stack (`rounded-xl border ...`, label/input classes); inline error `<p role="alert" className="text-sm text-red-600">{state.error}</p>`; submit button text swaps with `pending`.
- **Diverges:** flow is **two-step** — file-picker `onChange` runs `parseWorkbook` + `validateRows` **client-side** (no Server Action call yet) and renders a preview table + duplicate/error report; only then a "Commit upload" button posts the validated rows array via `useActionState`. Pass `rows` as JSON in a hidden `<input name="rows" value={JSON.stringify(rows)}>`.

### `e2e/plans.spec.ts`
- **Analog:** [e2e/periods.spec.ts](../../../e2e/periods.spec.ts)
- **Follow:** `const DEV_PASSWORD = "jsw-marketing-2026"`; `login(page)` helper (L10–16) clears cookies + visits `/login` + waits for `/`; each test calls `login(page)` fresh; `expect(page.getByRole("alert"))` for action errors; `data-slot="..."` selectors; `await page.waitForLoadState("networkidle")` after Server Action submits.
- **Diverges:** uses `page.setInputFiles("input[type=file]", path)` against a fixture `.xlsx` (commit a tiny pre-built fixture). The "blocked-by-actuals" test must first POST an execution row via the app UI (or a seed Server Action), then upload a plan missing that sfid and assert the action returns the blocked-list error.

---

## Shared Patterns

### Auth re-check (every Server Action)
**Source:** [lib/actions/periods.ts](../../../lib/actions/periods.ts) L15–20
```ts
async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) throw new Error("Unauthorized");
}
```
Apply to `commitPlanUpload`. Throws on failure (proxy.ts is the UX gate, this is the boundary — CVE-2025-29927 lesson).

### State-shape return contract
**Source:** [lib/actions/periods.ts](../../../lib/actions/periods.ts) L37, L73
```ts
export type CreatePeriodState = { ok?: true; id?: number; error?: string };
```
For plans add `blockedDealers?: string[]` to the union. Never throw for "expected" user errors — return state.

### Form refs reset on success
**Source:** [app/(app)/periods/period-form.tsx](../../../app/(app)/periods/period-form.tsx) L13–16
```ts
useEffect(() => { if (state.ok) formRef.current?.reset(); }, [state]);
```

### Test mocks (must precede imports)
**Source:** [lib/actions/periods.test.ts](../../../lib/actions/periods.test.ts) L14–28 — three `vi.mock` calls for `next/headers`, `next/cache`, `../auth/session`.

### Smoke harness
**Source:** [lib/db/__smoke__/item-master.ts](../../../lib/db/__smoke__/item-master.ts) — plain `console.log`/`process.exit` + local `function assert()`. **Not** vitest. Wired via `npm run <name>:smoke` script.

---

## No Analog Found

| File | Reason |
|---|---|
| `lib/excel/parse.ts` | First SheetJS module in the repo (verified by grep — zero hits for `xlsx`/`sheetjs` under `lib/`). Establishes `lib/excel/*` convention: pure, framework-free, named exports, tagged-union returns. |
| `lib/excel/template.ts` | Same as parse.ts. |
| `lib/excel/validate.ts` | No pure-function validator pattern exists yet (Zod schemas live inline inside Server Actions). Closest spiritual cousin is `lib/activities/types.ts` for the "framework-free, only `import type`" rule. |

## Metadata

**Analog search scope:** `lib/actions/`, `lib/db/`, `lib/db/__smoke__/`, `lib/activities/`, `app/(app)/`, `e2e/`
**Files scanned:** ~30
**Verified absences:** `lib/excel/` does not exist; no `xlsx`/`sheetjs` references in `lib/`.
