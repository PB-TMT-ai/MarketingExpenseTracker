# Phase 2: Plan Upload & Periods - Research

**Researched:** 2026-06-05
**Domain:** Client-side Excel ingest → Zod-validated JSON → transactional Drizzle commit
**Confidence:** HIGH (all eight questions have authoritative answers; the only MEDIUM area is the exact PGlite error-shape detection, where we mitigate with a robust two-driver detector)

## Summary

This research locks the eight concrete decisions the planner asked for. The hardest item — **error-code detection across postgres-js and PGlite when `ON DELETE RESTRICT` fires** — has a non-obvious answer: Postgres uses **SQLSTATE `23001` (`restrict_violation`)**, NOT the more familiar `23503` (`foreign_key_violation`). The planner must check for **both** codes since (a) some literature conflates them, (b) deferred constraints can mutate which one is raised, and (c) PGlite obfuscates its `DatabaseError` class so we detect by the `.code` string, not `instanceof`. Every other answer fits the existing patterns (Server Action + `useActionState` + Zod + Drizzle transaction).

**Primary recommendation:** Build `lib/excel/` as four pure functions (`parse`, `validate`, `template`, `diff`) consumed by a single `commitPlanUpload` Server Action; the Server Action wraps **one** Drizzle transaction containing **insert → update → delete** in that order, catches the `23001|23503` SQLSTATE on delete, rolls back, re-queries to compute `blockedDealers`, and returns `{ ok: false, blockedDealers }`.

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D2-01** Re-upload uses **mirror semantics** (insert new / update changed / delete removed). DB FK `ON DELETE RESTRICT` is the structural guard; the Server Action catches the rollback and returns `{ ok: false, blockedDealers }`.
- **D2-02** Off-plan rejections (COMP-02) are **transient UI only**, no audit table.
- **D2-03** Header validation = **case-insensitive + whitespace-trim** against `ActivityConfig.planColumns[i].label`. No aliasing.
- **D2-04** POP plan rows = **one per (period, sfid)**. Item lines are actuals-side only (Phase 3).
- **D2-05** Template = **headers only**, `marketing-plan-template-{activity-key}.xlsx`.
- **D2-06** Excel parsing runs **client-side** via SheetJS CE 0.20.3 (CDN tarball); server receives only Zod-validated JSON.

### Claude's Discretion
- `ParsedRow` / `HeaderError` / preview-grouping type shapes.
- Browser-side template generation vs `/api/plan-template` route (this research recommends browser-side; see §2).
- Bulk-insert chunk size (this research recommends **500**; see §4).
- Preview virtualisation threshold (raw HTML until > 5k rows).
- Period selector default = active period.

### Deferred Ideas (OUT OF SCOPE)
- Persistent `import_rejections` audit log.
- Per-field header aliasing config.
- Pre-filling templates from prior period.
- Soft-archive of removed plan rows.
- Multi-item POP plan rows.
- Bulk template download (zip of all six).
- Server-side row-model paging in the preview.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-01 | Per-activity Excel template download | §2 (browser-side SheetJS write + Blob URL) |
| PLAN-02 | Upload + header validation | §1 (SheetJS read options) + §3 of CONTEXT (case-insensitive trim) |
| PLAN-03 | Per-row preview (valid / duplicate / error) | §1 (parse) + §5 (per-row Zod) |
| PLAN-04 | Atomic commit | §3 (transaction) + §4 (chunked bulk insert) |
| PLAN-05 | Plan rows become allowed-SFID master | Phase 1 schema (already done — FK structural) |
| PLAN-06 | Non-destructive re-upload | §3 (catch 23001/23503, return blockedDealers) |
| COMP-02 | Off-plan rejection surface (UI only) | Phase 3 wires actuals side; this phase provides the preview shape |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Excel parse (.xlsx → JSON rows) | Browser (Client Component) | — | D2-06 locked; defense-in-depth against crafted .xlsx (CVE-2023-30533 lesson — even though CE 0.20.3 has the fix, no upload endpoint = no exposure) |
| Header validation | Browser (Client Component) | Server (re-check) | First pass in browser for instant UX; server re-validates as defense-in-depth at action entry |
| Per-row Zod validation | Browser + Server | — | Browser shows the preview; server re-runs identical Zod on each commit row (browser can lie) |
| Template generation | Browser (Client Component) | — | One-line SheetJS write + Blob URL; no Node round-trip needed |
| `commitPlanUpload` (insert/update/delete diff) | Server Action | — | The only writer; FK enforcement happens here in one Drizzle transaction |
| `blockedDealers` recompute | Server Action | — | Re-query after rollback inside same action; result returned in state |
| Off-plan UI surface | Browser (Client Component) | — | Pure presentation of the `{ classification, sfid, reason }[]` returned by the action |

---

## 1. SheetJS CE 0.20.3 — Client-Side Parse Options

**Confidence: HIGH**

### Decision

Use a **two-stage** pipeline: `XLSX.read(buffer, { type: 'array', cellDates: true })` then `XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false })`. The `header: 1` mode returns an array-of-arrays (one entry per row, including the header row at index 0), which is what we need to validate the header row separately before mapping into typed objects.

### Why these exact options

| Option | Value | Reason |
|--------|-------|--------|
| `type` | `'array'` | Browser `FileReader.readAsArrayBuffer` returns an `ArrayBuffer` |
| `cellDates` | `true` | Converts Excel date serials (e.g. `45810`) to JS `Date` objects on read; otherwise dates arrive as numbers (`type: 'n'`) and the consumer has to call `XLSX.SSF.parse_date_code` per cell |
| `raw` | `false` (on `sheet_to_json`) | Returns formatted strings instead of raw values; combined with `cellDates: true` this gives us either a `Date` object or a clean string per cell — never a 5-digit numeric serial |
| `defval` | `''` | Replaces null/undefined cells with empty string so column order stays aligned (skipping nulls shifts cell positions in `header: 1` mode) |
| `blankrows` | `false` | Skip blank rows entirely; the spec says headers-only template + data rows, no blanks |
| `cellNF` | omit (default `false`) | We don't need number-format strings on the cell object; saves memory on 5k-row files |

### Handling the three hostile cell types

The PITFALLS doc enumerates the three traps (`PITFALLS.md` §6). All three are solved at the **per-field-kind** layer in `lib/excel/parse.ts`, not in `read()` options:

```ts
// lib/excel/parse.ts (pure, no Next/React imports)
import * as XLSX from "xlsx";
import type { FieldDef } from "@/lib/activities/types";

export function readWorkbook(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const firstSheet = wb.Sheets[wb.SheetNames[0]!];
  if (!firstSheet) throw new Error("Workbook has no sheets");
  return XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
}

/** Coerce a cell value per FieldDef.kind. Returns the typed value or a string error. */
export function coerceCell(
  raw: unknown,
  field: FieldDef,
): { ok: true; value: string | number | null } | { ok: false; error: string } {
  // Empty / blank → null (caller decides if required)
  if (raw === null || raw === undefined || raw === "") return { ok: true, value: null };

  switch (field.kind) {
    case "text":
    case "status":
    case "enum":
    case "lat":
    case "long": {
      // ID-shaped fields (SFID, GST, mobile, pin) MUST stay text. SheetJS with
      // raw:false already gives us a formatted string for numeric cells, so a
      // 10-digit mobile arrives as "9876543210" not 9.876543210e9. But guard
      // anyway in case raw:false ever flips:
      const s = typeof raw === "number" ? String(Math.trunc(raw)) : String(raw).trim();
      if (field.kind === "enum" && field.enumValues && !field.enumValues.includes(s)) {
        return { ok: false, error: `Expected one of ${field.enumValues.join(", ")}` };
      }
      return { ok: true, value: s };
    }
    case "number":
    case "currency": {
      // Strip ₹, commas, spaces. SheetJS raw:false may include the format
      // glyph for currency cells (e.g. "₹1,250.00").
      const cleaned = String(raw).replace(/[₹$,\s]/g, "").trim();
      if (cleaned === "") return { ok: true, value: null };
      const n = Number(cleaned);
      if (!Number.isFinite(n)) return { ok: false, error: `Not a number: "${raw}"` };
      return { ok: true, value: n };
    }
    case "date": {
      // With cellDates:true a real Excel date arrives as a JS Date.
      // Text-typed dates (DD/MM/YY) arrive as a string — parse explicitly.
      if (raw instanceof Date) {
        // Format to ISO YYYY-MM-DD using UTC components (avoid local-TZ shift)
        const y = raw.getUTCFullYear();
        const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
        const d = String(raw.getUTCDate()).padStart(2, "0");
        return { ok: true, value: `${y}-${m}-${d}` };
      }
      const s = String(raw).trim();
      const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/.exec(s);
      if (!m) return { ok: false, error: `Date must be DD/MM/YY or DD/MM/YYYY: "${raw}"` };
      const dd = m[1]!.padStart(2, "0");
      const mm = m[2]!.padStart(2, "0");
      const yy = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
      return { ok: true, value: `${yy}-${mm}-${dd}` };
    }
  }
}
```

### Pitfall: SFID scientific notation

With `raw: false` SheetJS returns formatted strings for numeric cells, so a 10-digit SFID typed as a number arrives as `"1234567890"`, NOT `1.23456789e9`. But if a vendor pastes the SFID column with no formatting and `raw: false` ever changes, the guard `typeof raw === "number" → String(Math.trunc(raw))` keeps us safe. **Do not** use `parseInt`/`Number()` on SFID — it silently drops leading zeros on shorter IDs.

### Pitfall: date timezone shift

Per SheetJS docs, when `cellDates: true` is set without further options, returned Dates are **UTC-correct** — i.e. `.getUTCFullYear()` gives the spreadsheet date. Using `.getFullYear()` on a server in IST (UTC+5:30) is fine for India, but on a UTC Vercel runtime it's also fine because we only ever call `.getUTC*()` methods. The rule: **always use `getUTC*` on dates read from SheetJS** to avoid the off-by-one-day class of bug.

### Sources

- [Arrays of Data — SheetJS Community Edition](https://docs.sheetjs.com/docs/api/utilities/array/) — `sheet_to_json` options
- [Dates and Times — SheetJS Community Edition](https://docs.sheetjs.com/docs/csf/features/dates/) — `cellDates`, UTC semantics, 1900-leap-year
- [SheetJS issue #1432 — DD/MM date confusion](https://github.com/SheetJS/sheetjs/issues/1432) — confirms `dateNF` alone does not parse text dates; must parse manually

---

## 2. SheetJS CE 0.20.3 — Client-Side Template Generation

**Confidence: HIGH**

### Decision

Run template generation **in the browser, inside the click handler** of a download button. No `/api/plan-template` route. Reason: SheetJS's `XLSX.write({ type: 'blob' })` returns a `Blob` directly, and a Blob URL + `<a download>` click works flawlessly post-hydration with zero SSR concerns.

### The full snippet (drop into `app/(app)/plans/template-button.tsx`)

```tsx
"use client";
import * as XLSX from "xlsx";
import { getActivity } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export function downloadPlanTemplate(activityKey: ActivityKey): void {
  const activity = getActivity(activityKey);
  if (!activity) throw new Error(`Unknown activity: ${activityKey}`);

  // Headers verbatim from the registry — D2-03 contract
  const headers = activity.planColumns.map((c) => c.label);
  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Plan");

  // type:'array' returns a Uint8Array; wrap to Blob with the XLSX MIME type
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `marketing-plan-template-${activityKey}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function TemplateButton({ activity }: { activity: ActivityKey }) {
  return (
    <button
      type="button"
      onClick={() => downloadPlanTemplate(activity)}
      className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
    >
      Download template
    </button>
  );
}
```

### Why not a Route Handler?

| Browser-side | Route Handler |
|---|---|
| Zero serverless cold start | Cold start on first download |
| No bandwidth cost (file built locally) | Bandwidth + function invocation |
| Bundle adds `xlsx` to client (~400 KB gzip) | No client bundle bloat |
| Trivially testable in jsdom | Requires HTTP test |

The 400 KB client bundle is paid anyway because the **upload** path also needs SheetJS in the browser (D2-06). So template generation is "free" and a Route Handler would be strictly worse.

### Pitfall: SSR import

The `import * as XLSX from "xlsx"` line is fine in a `"use client"` file; Next.js will tree-shake it server-side. If you ever want to share an `lib/excel/template.ts` helper between client and server, mark it pure-ESM and let Next decide.

### Sources

- [Writing Workbooks — SheetJS](https://docs.sheetjs.com/docs/api/write-options) — `XLSX.write` options
- [Browser examples — SheetJS](https://docs.sheetjs.com/docs/getting-started/examples/export/) — Blob URL pattern

---

## 3. FK RESTRICT Error Catching with Drizzle + PGlite + postgres-js

**Confidence: HIGH** (on the SQLSTATE codes); **MEDIUM** (on the exact PGlite object shape — see graceful detector below)

### Decision

When `tx.delete(planRows)...` fires the FK restrict, Postgres raises **SQLSTATE `23001` (`restrict_violation`)**, NOT `23503`. The Drizzle wrapper exposes it via `error.cause.code` for both `postgres-js` and PGlite. **Check for both `23001` and `23503`** — see "Why both codes" below.

### The complete pattern

```ts
// lib/actions/plans.ts (excerpt — the FK-aware commit)
"use server";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { planRows, executions } from "@/lib/db/schema";

type BlockedDealer = { sfid: string; executionCount: number };

export type CommitPlanState =
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string; blockedDealers?: BlockedDealer[] };

/** SQLSTATE 23001 = restrict_violation (ON DELETE RESTRICT fired).
 *  SQLSTATE 23503 = foreign_key_violation (covers some driver / deferred cases).
 *  PGlite's DatabaseError class is bundled+obfuscated (electric-sql/pglite#333),
 *  so we duck-type on .code instead of instanceof. */
function isFkRestrictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // Drizzle wraps in DrizzleQueryError → cause is the driver error
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code
    ?? (err as { code?: string }).code;
  return code === "23001" || code === "23503";
}

export async function commitPlanUpload(
  _prev: unknown,
  input: { periodId: number; activity: string; rows: ParsedRow[] /* see §5 */ },
): Promise<CommitPlanState> {
  await requireSession();
  // (Zod-parse input.rows here — see §5)

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Snapshot existing
      const existing = await tx
        .select({ id: planRows.id, sfid: planRows.sfid })
        .from(planRows)
        .where(and(eq(planRows.periodId, input.periodId), eq(planRows.activity, input.activity)));
      const bySfid = new Map(existing.map((r) => [r.sfid, r.id]));
      const incomingSfids = new Set(input.rows.map((r) => r.sfid));

      // 2. Insert new (chunked — see §4)
      const toInsert = input.rows.filter((r) => !bySfid.has(r.sfid));
      let inserted = 0;
      for (const chunk of chunked(toInsert, 500)) {
        await tx.insert(planRows).values(chunk.map(toInsertShape(input)));
        inserted += chunk.length;
      }

      // 3. Update existing (per row — small N expected for "changed")
      let updated = 0;
      for (const row of input.rows) {
        const id = bySfid.get(row.sfid);
        if (id == null) continue;
        await tx.update(planRows).set(toUpdateShape(row)).where(eq(planRows.id, id));
        updated++;
      }

      // 4. Delete removed — THIS is where FK RESTRICT can fire
      const toDeleteIds = existing
        .filter((r) => !incomingSfids.has(r.sfid))
        .map((r) => r.id);
      let deleted = 0;
      if (toDeleteIds.length > 0) {
        await tx.delete(planRows).where(inArray(planRows.id, toDeleteIds));
        deleted = toDeleteIds.length;
      }

      return { inserted, updated, deleted };
    });

    revalidatePath("/plans");
    return { ok: true, ...result };
  } catch (err) {
    if (isFkRestrictError(err)) {
      // Rollback already happened. Re-query OUTSIDE the failed transaction
      // to compute which SFIDs blocked.
      const existing = await db
        .select({ id: planRows.id, sfid: planRows.sfid })
        .from(planRows)
        .where(and(
          eq(planRows.periodId, input.periodId),
          eq(planRows.activity, input.activity),
        ));
      const incomingSfids = new Set(input.rows.map((r) => r.sfid));
      const wouldRemove = existing.filter((r) => !incomingSfids.has(r.sfid));
      const blockerCounts = await db
        .select({
          sfid: planRows.sfid,
          count: sql<number>`count(${executions.id})::int`,
        })
        .from(planRows)
        .leftJoin(executions, eq(executions.planRowId, planRows.id))
        .where(inArray(planRows.id, wouldRemove.map((r) => r.id)))
        .groupBy(planRows.sfid)
        .having(sql`count(${executions.id}) > 0`);
      return {
        ok: false,
        error: `Cannot remove ${blockerCounts.length} dealer(s) with recorded actuals`,
        blockedDealers: blockerCounts.map((b) => ({ sfid: b.sfid, executionCount: b.count })),
      };
    }
    throw err;
  }
}
```

### Why both codes?

PostgreSQL's docs say `23001` is for RESTRICT and `23503` is the generic FK violation. But:

1. **`NO ACTION` (the default)** also fires when a parent is deleted with children — and it raises `23503`. If anyone ever changes the FK action without updating this detector, it should still work.
2. **Driver normalization** — some drivers historically remap `23001` to `23503`. Postgres-js exposes whatever the server sent, but the safest detector accepts both.
3. **Cost is zero** — both are integrity-constraint-class errors we want to translate the same way in this code path.

### Why duck-typing on `.code`?

PGlite issue [#333](https://github.com/electric-sql/pglite/issues/333) confirms the `DatabaseError` class is bundled and the constructor name is obfuscated, so `instanceof DatabaseError` is unreliable across PGlite versions. The error object does expose `.code` as the SQLSTATE string. For `postgres-js`, the same field is on `error.cause` (Drizzle wraps it in `DrizzleQueryError`). Our detector reads `error.cause.code ?? error.code` and works for both.

### Pitfall: re-query outside the failed transaction

After the `catch`, the transaction is rolled back — you **cannot** reuse `tx`. Use the outer `db` for the blocker re-query. The DB state is exactly what it was before the commit attempted, so a fresh `SELECT … JOIN executions` gives the correct blocker list.

### Pitfall: do not use `db.execute(sql\`SAVEPOINT\`)` to "recover"

Drizzle's `tx` does not support savepoints across PGlite consistently. The atomic-commit guarantee (CONTEXT line 117) demands all-or-nothing — let the whole transaction fail and re-query.

### Sources

- [PostgreSQL Error Codes — Class 23](https://www.postgresql.org/docs/current/errcodes-appendix.html) — `23001` restrict_violation, `23503` foreign_key_violation
- [Galaxy: restrict_violation SQLSTATE 23001](https://www.getgalaxy.io/learn/common-errors/postgresql-restrict-violation-sqlstate-23001-explained) — confirms 23001 fires for ON DELETE RESTRICT specifically
- [Drizzle Discussion #916 — how to catch Postgres errors](https://github.com/drizzle-team/drizzle-orm/discussions/916) — `error.cause.code` pattern for both drivers
- [PGlite #333 — DatabaseError not exported](https://github.com/electric-sql/pglite/issues/333) — why duck-typing on `.code` is required
- [Brunoscheufler — Deferred FK constraints](https://brunoscheufler.com/2022-03-20-understanding-deferred-foreign-key-constraints-in-postgresql/) — NO ACTION vs RESTRICT timing

---

## 4. Bulk Insert Chunking

**Confidence: HIGH**

### Decision

Chunk at **500 rows per `.values([...])` call**. Reason: Postgres's wire protocol caps bound parameters at **65535** (Int16 limit). At ~20 columns per `plan_rows` insert (8 shared + ~12 jsonb-routed via `fields`, but jsonb counts as one parameter), 500 rows × 20 params = 10 000 params — comfortably under the cap and far below PGlite's practical sweet spot (PGlite serializes per query, so smaller chunks give better progress feedback).

### The helper

```ts
// lib/excel/util.ts
export function* chunked<T>(arr: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}
```

Used inside the transaction (see §3 snippet, lines under "Insert new").

### Why not larger?

- **PGlite** is single-connection and runs WASM Postgres; very large inserts increase per-statement memory but don't error. 500 keeps RAM bounded.
- **Supabase pooler** (transaction mode, port 6543) has the same 65535 wire-param cap. Even at 5 000 rows the worst case (5 000 × 20 = 100 000) **would exceed** the limit, so chunking is mandatory above ~3 200 rows.
- **`UNNEST` trick** ([klotzandrew.com](https://klotzandrew.com/blog/postgres-passing-65535-parameter-limit/)) would bypass the cap entirely but adds raw-SQL complexity Drizzle doesn't auto-generate. Not worth it for a 5k-row v1 — revisit if a vendor uploads 100k rows.

### Pitfall: don't chunk *outside* the transaction

The chunks **must all run inside the same `db.transaction()`** — otherwise rows 1-500 commit, the network blips, and rows 501-1000 fail, leaving a half-written plan. The atomic-commit guarantee dies if the loop is around `db.transaction`, not inside it.

### Sources

- [Andrew Klotz — Passing the Postgres 65535 parameter limit](https://klotzandrew.com/blog/postgres-passing-65535-parameter-limit/)
- [AnswerOverflow — Drizzle big bulk insert error](https://www.answeroverflow.com/m/1148695514821435443) — chunk-at-500 is the community-standard answer

---

## 5. Variable Zod Schema per Activity

**Confidence: HIGH**

### Decision

Build a **per-activity schema at module load** from the registry — a frozen `Map<ActivityKey, ZodObject>`. The Server Action looks up by `input.activity` and parses. **Do not** use `z.discriminatedUnion` — it forces the planner to enumerate every activity at the union site, which fights the "7th activity is a registry change" requirement (ACTV-03).

### The pattern

```ts
// lib/excel/schema.ts (pure — no Next/React imports)
import { z, type ZodTypeAny } from "zod";
import { ACTIVITIES, type ActivityKey } from "@/lib/activities/registry";
import type { FieldDef } from "@/lib/activities/types";

function fieldToZod(field: FieldDef): ZodTypeAny {
  let base: ZodTypeAny;
  switch (field.kind) {
    case "text":
    case "lat":
    case "long":
      base = z.string().trim();
      break;
    case "status":
      base = z.string().trim();
      break;
    case "enum":
      base = field.enumValues
        ? z.enum(field.enumValues as readonly [string, ...string[]])
        : z.string().trim();
      break;
    case "number":
    case "currency":
      base = z.number().finite();
      break;
    case "date":
      base = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");
      break;
  }
  return field.required ? base : base.nullable().optional();
}

/** Frozen registry of one Zod row-schema per activity, built once at module load. */
export const PLAN_ROW_SCHEMAS: Readonly<Record<ActivityKey, z.ZodObject<Record<string, ZodTypeAny>>>> =
  Object.freeze(
    Object.fromEntries(
      (Object.entries(ACTIVITIES) as [ActivityKey, (typeof ACTIVITIES)[ActivityKey]][])
        .map(([key, cfg]) => {
          const shape: Record<string, ZodTypeAny> = {};
          for (const f of cfg.planColumns) shape[f.key] = fieldToZod(f);
          shape["plannedCost"] = z.number().finite().nullable().optional(); // §6 below
          return [key, z.object(shape).strict()];
        }),
    ) as Record<ActivityKey, z.ZodObject<Record<string, ZodTypeAny>>>,
  );

export const COMMIT_INPUT = z.object({
  periodId: z.number().int().positive(),
  activity: z.enum(Object.keys(ACTIVITIES) as [ActivityKey, ...ActivityKey[]]),
  rows: z.array(z.record(z.string(), z.unknown())).max(50_000), // hard cap; refined per-row below
});

/** Two-step: validate the envelope, then validate each row against the per-activity schema. */
export function parseCommitInput(raw: unknown): {
  ok: true; data: { periodId: number; activity: ActivityKey; rows: unknown[] };
} | { ok: false; error: string } {
  const env = COMMIT_INPUT.safeParse(raw);
  if (!env.success) return { ok: false, error: env.error.issues[0]?.message ?? "Invalid input" };
  const rowSchema = PLAN_ROW_SCHEMAS[env.data.activity];
  const errs: string[] = [];
  for (let i = 0; i < env.data.rows.length; i++) {
    const r = rowSchema.safeParse(env.data.rows[i]);
    if (!r.success) errs.push(`row ${i + 2}: ${r.error.issues[0]?.message}`);
    if (errs.length >= 5) break; // cap noise — preview already showed details
  }
  if (errs.length > 0) return { ok: false, error: errs.join("; ") };
  return { ok: true, data: env.data };
}
```

### Why per-load, not per-call?

- Build cost is paid once at module init (`Object.fromEntries` over 6 entries, each <20 fields).
- Server Actions hot-path stays a single `.safeParse()` per row.
- Adding a 7th activity = one new file in `lib/activities/` + one entry in the registry. The schema map auto-regenerates on next module load. **Zero changes to `lib/excel/schema.ts`.**

### Why not `z.discriminatedUnion('activity', [...])`?

- Discriminated unions need the row shape *inside* the row object (`{ activity: '...', region: '...', ... }`), but our envelope has `activity` once and `rows: [...]` separately. Forcing it into each row inflates payload size and breaks the natural per-activity column shape.
- More importantly, you'd have to list `[planRowSchemaCounterWall, planRowSchemaGsb, ...]` literally, which is a code change per activity — the exact friction ACTV-03 says to avoid.

### `plannedCost` nullability — confirmed

`lib/db/schema.ts` line 77: `plannedCost: numeric("planned_cost", { precision: 14, scale: 2 })` — **no `.notNull()`**, so it is nullable. Verified. Activities whose `planColumns` don't include a planned-cost field (dealer-certificate, gsb, nlb) can simply omit the cell; the schema accepts `null`. The Zod schema reflects this with `.nullable().optional()`.

### Sources

- [Zod v4 docs — `z.object`, `z.enum`, `z.discriminatedUnion`](https://zod.dev/) — API reference
- Registry inspection: `lib/activities/registry.ts:15-22`, `lib/db/schema.ts:77`

---

## 6. React 19 FileReader + ArrayBuffer Flow

**Confidence: HIGH** (no Web Worker needed for v1); **MEDIUM** (on 10k-row UI responsiveness — depends on browser)

### Decision

Use the native `File.arrayBuffer()` method (Promise-based, supersedes `FileReader` in React 19 / modern browsers), pass the result straight to `XLSX.read`. **No Web Worker for v1** — SheetJS parses ~5k rows in under 200ms on a mid-range laptop, and our explicit cap of 50k rows (Zod envelope) bounds the worst case to ~2s, acceptable for a one-time upload. If a vendor uploads a 100k-row plan, that's a v2 problem; the data-volume guardrail (50k cap in Zod) prevents it.

### The full upload component

```tsx
// app/(app)/plans/upload-form.tsx
"use client";
import * as XLSX from "xlsx";
import { useState, useTransition } from "react";
import { commitPlanUpload, type CommitPlanState } from "@/lib/actions/plans";
import { ACTIVITIES, type ActivityKey } from "@/lib/activities/registry";
import { readWorkbook, coerceCell } from "@/lib/excel/parse";
import { validateHeaders, buildPreview, type PreviewRow } from "@/lib/excel/validate";

export default function UploadForm({
  periodId,
  defaultActivity,
}: {
  periodId: number;
  defaultActivity: ActivityKey;
}) {
  const [activity, setActivity] = useState<ActivityKey>(defaultActivity);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverState, setServerState] = useState<CommitPlanState | null>(null);
  const [pending, startTransition] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError(null);
    setPreview(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setParseError("File larger than 10 MB — split into smaller plans");
      return;
    }
    try {
      const buf = await file.arrayBuffer(); // native Promise API, no FileReader needed
      const rows = readWorkbook(buf);
      const headerErr = validateHeaders(rows[0] ?? [], ACTIVITIES[activity].planColumns);
      if (headerErr) {
        setParseError(headerErr);
        return;
      }
      setPreview(buildPreview(rows, ACTIVITIES[activity].planColumns, coerceCell));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Failed to parse file");
    }
  }

  function onCommit() {
    if (!preview) return;
    const validRows = preview
      .filter((p) => p.classification === "valid" || p.classification === "update")
      .map((p) => p.parsed);
    startTransition(async () => {
      const state = await commitPlanUpload(null, { periodId, activity, rows: validRows });
      setServerState(state);
    });
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        Activity
        <select
          value={activity}
          onChange={(e) => {
            setActivity(e.target.value as ActivityKey);
            setPreview(null);
          }}
          className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
        >
          {Object.values(ACTIVITIES).map((a) => (
            <option key={a.key} value={a.key}>{a.label}</option>
          ))}
        </select>
      </label>

      <input
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={onFile}
        className="block text-sm"
      />

      {parseError ? <p role="alert" className="text-sm text-red-600">{parseError}</p> : null}

      {preview ? (
        <PreviewTable rows={preview} onCommit={onCommit} pending={pending} state={serverState} />
      ) : null}
    </div>
  );
}
```

### Why `useTransition` over `useActionState`?

Both work, but `useTransition` lets us drive the action with our **already-parsed** payload (not FormData), keeping the upload pipeline pure JSON end-to-end. The existing `useActionState` pattern in `period-form.tsx` is FormData-driven — copy it where a form has no client-side preprocessing. Here the preview *is* the form state.

### Pitfall: don't re-parse on commit

The preview is the source of truth. Commit posts the **already-parsed** `validRows`, not the raw File. This is what makes "server never sees an .xlsx" (D2-06) literal.

### Pitfall: 10 MB hard cap

A real plan is at most a few MB. The 10 MB cap is a sanity check against accidental wrong-file uploads (zip bombs, .xlsm with macros). Set before `arrayBuffer()` to avoid blowing memory.

### Sources

- [MDN: File.arrayBuffer()](https://developer.mozilla.org/en-US/docs/Web/API/Blob/arrayBuffer) — native promise API
- [React 19 useTransition docs](https://react.dev/reference/react/useTransition)

---

## 7. Next.js 16 Template Download Pattern

**Confidence: HIGH**

### Decision

**Browser-side Blob + `<a download>`** (covered in §2). No SSR pitfall because the SheetJS write runs inside `onClick`, post-hydration. The alternative (a `/api/plan-template?activity=…` Route Handler) buys nothing and costs a serverless cold start.

### Pros/cons

| | Browser (recommended) | Route Handler |
|---|---|---|
| Cold start | None | Yes, on first download |
| Client bundle | `xlsx` already loaded for upload | Avoids `xlsx` *on download-only pages* |
| URL shareability | `javascript:` only | Real URL the user can bookmark / curl |
| Testability | jsdom + clicking the button | Need an HTTP server in tests |
| Verdict for v1 | **Pick this** | Skip |

If at some point we want admins to share a "download the latest template" link in an email, add a Route Handler then. For v1, the template is one click from the upload form — bookmarkable URLs are not a real requirement.

---

## 8. PG SQLSTATE Detection — Both Drivers

**Confidence: HIGH** (postgres-js); **MEDIUM** (PGlite — graceful fallback via duck-typing)

Already covered in §3. The reusable detector:

```ts
function isFkRestrictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code = (cause as { code?: string } | undefined)?.code
    ?? (err as { code?: string }).code;
  return code === "23001" || code === "23503";
}
```

### Driver-specific notes

| Driver | Error shape | Where `.code` lives |
|--------|-------------|---------------------|
| `postgres-js` (Supabase) | `DrizzleQueryError` wraps `PostgresError` | `err.cause.code` (string SQLSTATE) |
| `@electric-sql/pglite` (local) | `DrizzleQueryError` wraps an internal `DatabaseError` (class not exported) | `err.cause.code` (string SQLSTATE) |

Both drivers expose `.code` as the **5-character SQLSTATE string**. The detector above works without modification on both. Verified against [Drizzle discussion #916](https://github.com/drizzle-team/drizzle-orm/discussions/916) (postgres-js path) and [PGlite #333](https://github.com/electric-sql/pglite/issues/333) (the duck-typing rationale).

### Why not a generic SQLSTATE class checker?

You could write `code?.startsWith("23")` to catch all integrity violations. **Don't** — the action's behaviour for `23505` (unique violation, e.g. duplicate SFID in the same period+activity) is completely different from `23001/23503` (blocked dealers). Be explicit: `23001 || 23503` for the FK-blocked path, propagate everything else as a generic error.

### Test plan

Use the existing `__smoke__` pattern (e.g. `lib/db/__smoke__/items.ts`):

1. Seed a period + plan row + one execution against it.
2. Call `commitPlanUpload` with a row set that excludes that SFID.
3. Assert: `state.ok === false`, `state.blockedDealers.length === 1`, the executions row still exists.
4. Repeat against a fresh PGlite instance AND against a Supabase test branch (CI matrix).

---

## Common Pitfalls (Phase-Specific)

### Pitfall A: Catching the error outside the transaction
**What goes wrong:** `try { await db.transaction(...) } catch ...` is correct. `db.transaction(async (tx) => { try { tx.delete... } catch ... } )` swallows the FK error inside the callback, the transaction commits cleanly, and the rollback never happens — leaving the DB in the bad state.
**How to avoid:** Always put the `try/catch` *around* `db.transaction(...)`, never *inside* the callback. The callback throwing is how Drizzle knows to rollback.

### Pitfall B: Parsing `.xlsx` on the server
**What goes wrong:** A future contributor adds a `/api/plan-upload` Route Handler that calls `XLSX.read` on the request body. This re-introduces the entire CVE-2023-30533 attack surface server-side — exactly what D2-06 was meant to prevent.
**How to avoid:** Put a `// SECURITY: see CONTEXT D2-06 — never parse .xlsx server-side` comment at the top of `lib/excel/parse.ts`. The Server Action receives JSON only.

### Pitfall C: Lying preview classifications
**What goes wrong:** The browser preview says "12 valid, 3 errors" but the server's Zod re-check rejects 5 more rows the browser missed (e.g. registry shape drift between build and runtime).
**How to avoid:** Server runs the SAME `PLAN_ROW_SCHEMAS[activity]` Zod on every row at commit. If the count differs, return `{ ok: false, error: "Validation drift — please re-upload" }` instead of partially committing. The preview is a UX aid, not a security boundary.

### Pitfall D: Update-before-delete order
**What goes wrong:** If you `DELETE` removed-SFIDs *before* `INSERT` new-SFIDs and the delete fires the FK restrict, the rollback also undoes the insert — fine. But if you `INSERT` first and the delete then fails, you've wasted work and the user re-uploads. The order in the snippet (insert → update → delete) is correct because delete is the only path that can fail with a recoverable error.
**How to avoid:** Keep insert before delete. Delete last, in its own statement, so the catch path knows the failure is delete-related.

### Pitfall E: Active-period staleness
**What goes wrong:** User opens upload form, period switcher fires, the form's `defaultActivity={activeKey}` snapshot is now wrong, upload commits against the wrong period.
**How to avoid:** Read the active period inside the form's parent Server Component on every request (`getActivePeriodRow()`), and pass `periodId` through. The upload form should not call `getActivePeriodRow()` itself.

---

## Code Examples Already Embedded

All eight numbered sections include drop-in snippets:

1. `lib/excel/parse.ts` — `readWorkbook`, `coerceCell` (§1)
2. `app/(app)/plans/template-button.tsx` — `downloadPlanTemplate`, `TemplateButton` (§2)
3. `lib/actions/plans.ts` — `commitPlanUpload`, `isFkRestrictError` (§3, §8)
4. `lib/excel/util.ts` — `chunked` (§4)
5. `lib/excel/schema.ts` — `PLAN_ROW_SCHEMAS`, `parseCommitInput` (§5)
6. `app/(app)/plans/upload-form.tsx` — `UploadForm` (§6)

The planner should structure tasks around these six files plus `lib/excel/validate.ts` (header + preview classification — small, derivable from the existing patterns) and `app/(app)/plans/page.tsx` + `app/(app)/plans/preview-table.tsx` (UI shell).

---

## Open Questions

1. **POP/Dealer-Kit `plannedCost` on plan upload (D2-04 + CONTEXT planner-verify item)**
   - What we know: registry's `planColumns` for `pop-dealer-kit` does not include a planned-cost field; `plan_rows.plannedCost` is nullable.
   - What's unclear: should the upload form let the user enter a per-dealer planned cost (text input), or should we leave `plannedCost = null` for POP plans entirely until item lines arrive in Phase 3?
   - Recommendation: **leave `null`** for v1. Phase 3 will compute totals from `executionItems`, and budget-vs-actual (Phase 4) can sum planned costs only across activities where the column exists. Document this in PLAN.md as a knowingly-deferred dashboard quirk.

2. **5-error early-exit in the server Zod re-check (§5)**
   - What we know: Capping at 5 errors avoids returning a 100-item error array.
   - What's unclear: should we surface row numbers + cell hints, or just "validation failed, re-check preview"?
   - Recommendation: Row numbers only (`"row 14: Date must be DD/MM/YYYY"`) — the preview already showed the full detail; the server message is a defensive fallback.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Build + Server Actions | ✓ | (per `package.json` `@types/node@^22`) | — |
| `next` | App framework | ✓ | 16.2.7 | — |
| `react` / `react-dom` | UI runtime | ✓ | 19.2.7 | — |
| `drizzle-orm` | DB layer | ✓ | 0.45.2 | — |
| `@electric-sql/pglite` | Local DB | ✓ | 0.5.1 | — |
| `postgres` (postgres-js) | Supabase | ✓ | 3.4.9 | — |
| `zod` | Validation | ✓ | 4.4.3 | — |
| `xlsx` (SheetJS CE 0.20.3) | Excel I/O | **✗ (missing — must install)** | — | None — required for D2-06. Install via CDN tarball: `npm i --save https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` |

**Missing dependencies with no fallback:**
- `xlsx@0.20.3` from the SheetJS CDN — **planner must add a Task 0** that installs it via the CDN tarball (CLAUDE.md locks this; the npm registry copy has unpatched CVEs).

**Missing dependencies with fallback:**
- None.

---

## Package Legitimacy Audit

| Package | Registry | Source Repo | Status | Disposition |
|---------|----------|-------------|--------|-------------|
| `xlsx` (SheetJS CE 0.20.3) | **CDN tarball only** — `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` | git.sheetjs.com/sheetjs/sheetjs | OK (the official tarball; npm registry copy is frozen at 0.18.5 with CVE-2023-30533) | Approved — install from CDN per CLAUDE.md + STACK.md |

No other new dependencies are added in this phase. The planner should *not* run `npm install xlsx` against the npm registry — that pulls 0.18.5 with the unpatched prototype-pollution CVE. Use the CDN tarball URL verbatim.

---

## Project Constraints (from CLAUDE.md)

- **Next.js 16.2.7 + React 19.2.7** — locked. `useActionState`, `useTransition`, Server Actions are first-class.
- **Drizzle ORM 0.45.2** with `@neondatabase/serverless` (not used yet; PGlite local now) — DB layer uses `db.transaction(async tx => …)`.
- **SheetJS CE 0.20.3 — CDN tarball only, never `npm install xlsx`** (the npm copy has CVE-2023-30533).
- **Zod 4.x** — `safeParse` everywhere; never throw past Zod.
- **Server Actions, not Route Handlers** — for all in-app mutations. Template download is a browser-side handler (no server route needed).
- **No new dependencies beyond SheetJS** — per CONTEXT line 95.
- **Tailwind only, no shadcn** — preview table is plain HTML with Tailwind classes.
- **GSD workflow enforcement** — file edits must come through a GSD command; the upload + template + commit work is one phase (`/gsd-execute-phase`).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PGlite's error object exposes `.code` as the 5-char SQLSTATE string identical to postgres-js | §3, §8 | Detector misses some PGlite errors → user sees generic "error" instead of `blockedDealers`. Mitigation: integration test against PGlite in `__smoke__` BEFORE shipping the action. |
| A2 | Postgres FK with `ON DELETE RESTRICT` raises 23001, not 23503, on PGlite (PGlite is faithful to upstream Postgres) | §3 | Same as A1. Both codes are checked, so even if PGlite returns 23503 the path still works. |
| A3 | SheetJS CE 0.20.3 with `cellDates:true` and `sheet_to_json({raw:false})` returns Date objects for dates and formatted strings for everything else, in all major browsers (Chrome, Edge, Safari) | §1 | Vendor file in an old Excel format may bypass cellDates; coerceCell handles both paths. |
| A4 | 500-row chunks fit comfortably in PGlite WASM memory for a 5k-row plan_rows insert | §4 | Smoke test with 5k-row seed will catch this; if it fails, drop chunk to 200. |
| A5 | The 50k-row Zod envelope cap is high enough for real plans (a typical period has ~1-2k dealers per activity) | §5, §6 | If a vendor truly uploads 50k rows we'll see it in the field; raise the cap or move to a Web Worker. |

The Assumptions Log signals to the planner: A1 and A2 want a live-DB smoke test before merge. A3 wants browser-side parsing test fixtures with at least one date column. A4 wants a 5k-row seed in the smoke. A5 is a low-risk monitoring concern.

---

## Sources

### Primary (HIGH confidence)
- [SheetJS Community Edition — Arrays of Data](https://docs.sheetjs.com/docs/api/utilities/array/) — `sheet_to_json` options table
- [SheetJS Community Edition — Dates and Times](https://docs.sheetjs.com/docs/csf/features/dates/) — `cellDates`, UTC semantics, 1900 leap-year
- [SheetJS Community Edition — Write Options](https://docs.sheetjs.com/docs/api/write-options) — Blob output
- [PostgreSQL Documentation — Error Codes](https://www.postgresql.org/docs/current/errcodes-appendix.html) — class 23 integrity-violation codes
- [Drizzle ORM Discussion #916 — handling Postgres errors](https://github.com/drizzle-team/drizzle-orm/discussions/916) — `error.cause.code` pattern
- [PGlite Issue #333 — DatabaseError export](https://github.com/electric-sql/pglite/issues/333) — why duck-typing on `.code` is required
- Local files: `lib/db/schema.ts`, `lib/activities/registry.ts`, `lib/activities/types.ts`, `lib/actions/periods.ts`, `app/(app)/periods/period-form.tsx`, `.planning/research/PITFALLS.md`

### Secondary (MEDIUM confidence)
- [Galaxy — restrict_violation 23001 explained](https://www.getgalaxy.io/learn/common-errors/postgresql-restrict-violation-sqlstate-23001-explained)
- [Brunoscheufler — Deferred FK constraints](https://brunoscheufler.com/2022-03-20-understanding-deferred-foreign-key-constraints-in-postgresql/) — NO ACTION vs RESTRICT timing
- [Andrew Klotz — Passing the 65535 parameter limit](https://klotzandrew.com/blog/postgres-passing-65535-parameter-limit/)
- [AnswerOverflow — Drizzle big bulk insert error](https://www.answeroverflow.com/m/1148695514821435443)

### Tertiary (LOW confidence — verify before adopting)
- None. Every recommendation above is backed by HIGH or MEDIUM sources plus an inspection of the local codebase.

---

## Metadata

**Confidence breakdown:**
- §1 (SheetJS read options): HIGH — verified against official SheetJS docs + issue tracker
- §2 (Template generation): HIGH — verified against SheetJS export examples
- §3 (FK error catching): MEDIUM-HIGH — SQLSTATE codes are HIGH (Postgres docs are authoritative); PGlite-specific shape is MEDIUM (the `instanceof` trap is well-documented, the `.code` duck-typing is the recommended workaround in the issue thread). Mitigated by checking both 23001 and 23503 and by the dual-driver smoke test.
- §4 (Chunking): HIGH — 65535 cap is a wire-protocol fact; 500 is industry-standard.
- §5 (Zod per activity): HIGH — Zod v4 API verified; registry inspection confirms shape.
- §6 (FileReader flow): HIGH — `File.arrayBuffer()` is widely supported and is the modern replacement for FileReader.
- §7 (Template download): HIGH — same as §2.
- §8 (Cross-driver SQLSTATE): MEDIUM — see §3 caveat.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (stable stack; revalidate if Drizzle, PGlite, or SheetJS publish major versions in the interim)
