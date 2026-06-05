/**
 * Per-activity Zod schema map + commit envelope + the two-step parser
 * `commitPlanUpload` uses as its server-side defense-in-depth Zod re-check.
 *
 * Layering: framework-free. Imports ONLY zod + the activity registry (which itself is
 * framework-free). Does NOT import next/react/drizzle/lib/db so it can run unchanged in
 * the browser preview path AND on the Server Action hot path.
 *
 * Security boundary (RESEARCH "Common Pitfalls" C / T-02-02-01):
 *   The browser preview is a UX aid — a lying client can submit any JSON. The Server
 *   Action runs `parseCommitInput` on every commit; `.strict()` on each per-activity
 *   schema rejects unknown keys, the registry-derived shape rejects unknown fields, and
 *   noise is capped at 5 errors so a single 50_000-row payload can't OOM the response.
 *
 * ACTV-03 — adding a 7th activity:
 *   `PLAN_ROW_SCHEMAS` is built ONCE at module load from `Object.entries(ACTIVITIES)`,
 *   so registering a 7th activity in `lib/activities/registry.ts` requires ZERO edits
 *   to this file. (NOT `z.discriminatedUnion` — that would force enumeration at the
 *   union site and re-introduce a per-activity edit here. RESEARCH §5.)
 */

import { z, type ZodTypeAny } from "zod";
import { ACTIVITIES, ACTIVITY_KEYS } from "../activities/registry";
import type { ActivityKey, FieldDef } from "../activities/types";

/**
 * Translate a single FieldDef into its Zod validator.
 *
 * Date kind: ISO YYYY-MM-DD ONLY — the parse layer (`coerceCell`) already converted
 * Excel dates and DD/MM strings to ISO before they reach the Server Action. A row that
 * arrives at the commit with a non-ISO date is evidence of a lying client.
 */
function fieldToZod(field: FieldDef): ZodTypeAny {
  let base: ZodTypeAny;
  switch (field.kind) {
    case "text":
    case "status":
    case "lat":
    case "long":
      base = z.string().trim().min(1);
      break;
    case "enum":
      base = field.enumValues
        ? z.enum(field.enumValues as readonly [string, ...string[]])
        : z.string().trim().min(1);
      break;
    case "number":
    case "currency":
      base = z.number().finite();
      break;
    case "date":
      base = z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date YYYY-MM-DD");
      break;
  }
  return field.required ? base : base.nullable().optional();
}

/**
 * Frozen map of one Zod row-schema per activity, built ONCE at module load.
 *
 * Construction:
 *   - For each (key, ActivityConfig) pair in ACTIVITIES
 *   - Build the row shape from cfg.planColumns via fieldToZod
 *   - Append `plannedCost: z.number().finite().nullable().optional()` — `plan_rows.plannedCost`
 *     is a nullable numeric(14,2) column; activities whose planColumns lack a planned-cost
 *     field (currently ALL six — verified by reading lib/activities/*.ts) store null
 *   - Wrap with `.strict()` so unknown keys are REJECTED (T-02-02-01 mitigation)
 *
 * RESEARCH "Open Questions" §1: POP / dealer-cert / GSB / NLB plannedCost stays null
 * for v1 — the Phase 4 dashboard will sum planned cost only over activities that declare
 * the column. Documented as a knowingly-deferred quirk.
 */
export const PLAN_ROW_SCHEMAS: Readonly<
  Record<ActivityKey, z.ZodObject<Record<string, ZodTypeAny>>>
> = Object.freeze(
  Object.fromEntries(
    (Object.entries(ACTIVITIES) as [ActivityKey, (typeof ACTIVITIES)[ActivityKey]][]).map(
      ([key, cfg]) => {
        const shape: Record<string, ZodTypeAny> = {};
        for (const f of cfg.planColumns) shape[f.key] = fieldToZod(f);
        // plannedCost lives on plan_rows as a real numeric column but is NOT declared
        // by any current activity's planColumns. Accept null/optional so commits remain
        // valid even when the activity has no plannedCost field on the wire.
        shape["plannedCost"] = z.number().finite().nullable().optional();
        return [key, z.object(shape).strict()];
      },
    ),
  ) as Record<ActivityKey, z.ZodObject<Record<string, ZodTypeAny>>>,
);

/**
 * Top-level envelope the Server Action accepts. `rows` is hard-capped at 50_000 because
 * a typical period uploads ~1-2k dealers per activity (RESEARCH Assumption A5) — the cap
 * stops a hostile or buggy client from blowing memory on the server. Per-row shape is
 * re-validated below against `PLAN_ROW_SCHEMAS[activity]`.
 */
export const COMMIT_INPUT = z.object({
  periodId: z.number().int().positive(),
  activity: z.enum(ACTIVITY_KEYS as readonly [ActivityKey, ...ActivityKey[]]),
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .max(50_000, "Too many rows (max 50_000)"),
});

/**
 * The two-step parse:
 *   1. Validate the envelope (periodId positive int, activity in the registry, rows ≤ 50k)
 *   2. Validate each row against the per-activity schema, capping error noise at 5 rows
 *
 * Returns a tagged union so the caller never throws past Zod (mirrors the
 * `lib/excel/parse.ts` discipline established in Plan 02-01).
 *
 * Row error format: `"row {n+2}: {first issue message}"` — Excel-1-indexed so the user
 * can find the offending line in the source workbook. The PREVIEW already showed the
 * full per-cell detail; this is a defensive fallback.
 */
export function parseCommitInput(
  raw: unknown,
):
  | {
      ok: true;
      data: { periodId: number; activity: ActivityKey; rows: unknown[] };
    }
  | { ok: false; error: string } {
  const env = COMMIT_INPUT.safeParse(raw);
  if (!env.success) {
    return {
      ok: false,
      error: env.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const rowSchema = PLAN_ROW_SCHEMAS[env.data.activity];
  const errs: string[] = [];
  for (let i = 0; i < env.data.rows.length; i++) {
    const r = rowSchema.safeParse(env.data.rows[i]);
    if (!r.success) {
      errs.push(`row ${i + 2}: ${r.error.issues[0]?.message ?? "invalid row"}`);
      if (errs.length >= 5) break; // cap noise — preview already had details
    }
  }
  if (errs.length > 0) return { ok: false, error: errs.join("; ") };

  return { ok: true, data: env.data };
}
