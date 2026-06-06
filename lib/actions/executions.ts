"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { db } from "../db";
import { computeDerived, isOverridden } from "../actuals/calc";
import {
  insertExecution,
  updateExecutionVersioned,
  savePopKit,
  type PopLine,
} from "../db/executions";

/**
 * saveExecutionsBatch — Server Action for the actuals grid Save bar.
 *
 * Mirrors the commitPlanUpload pattern (requireSession + Zod + ONE db.transaction
 * + revalidatePath) with these KEY DIFFERENCES from commitPlanUpload:
 *
 *   1. Per-unit version conflicts are COLLECTED, not thrown (D3-11).
 *      commitPlanUpload lets the FK-restrict throw roll back the WHOLE batch (correct for
 *      plan uploads, where partial success is not meaningful). Here, D3-11 REQUIRES that
 *      unaffected units still save even when one unit has a stale version — so conflicts
 *      are pushed to an array, never thrown. Throwing inside db.transaction rolls back
 *      EVERYTHING; collecting means the tx commits with partial success.
 *
 *   2. Server trust-recompute (D3-05 / Pitfall 9): for each unit, derived totals that are
 *      NOT overridden are re-computed from the authoritative formula (computeDerived from
 *      lib/actuals/calc.ts) before persisting. Client-sent totals for non-overridden cells
 *      are IGNORED. This prevents a lying client from persisting wrong totals.
 *
 *   3. Empty placeholder skip (D3-02 / Pitfall 5): a placeholder unit with no meaningful
 *      field edits is NOT inserted. Persisting empty rows would corrupt Phase-4's
 *      "% executed" metric.
 *
 *   4. Off-plan guard is STRUCTURAL — executions has no sfid column; the only FK target
 *      is planRowId. The Zod schema REJECTS any sfid field. NEVER accept sfid from the
 *      client (COMP-01).
 *
 * Security:
 *   - requireSession() is the FIRST statement (CVE-2025-29927 — middleware is the UX gate,
 *     not the boundary; this is the boundary).
 *   - Drizzle parameterized queries throughout (no string SQL with user input).
 *   - Zod caps the units array length to prevent DoS via oversized payloads.
 */

// ---------------------------------------------------------------------------
// Auth helper — verbatim copy from lib/actions/plans.ts
// ---------------------------------------------------------------------------

async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    throw new Error("Unauthorized");
  }
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

/**
 * One POP line item within a unit patch.
 * itemName is a text snapshot (D-08 — NOT an FK to item_master).
 */
const popLineSchema = z.object({
  itemName: z.string().min(1, "Item name is required"),
  qty: z.number().finite().positive("qty must be positive"),
  rate: z.number().finite().nonnegative("rate must be non-negative"),
  lineTotal: z.number().finite().nonnegative("lineTotal must be non-negative"),
});

/**
 * One unit in the batch. Each unit represents one execution row (real or placeholder).
 *
 * Security invariant: `sfid` is ABSENT from this schema — it cannot be injected by a
 * client even if they craft a custom payload. planRowId must reference a real plan_row
 * (the FK on `executions.plan_row_id` enforces this at the DB level).
 */
const unitPatchSchema = z.object({
  rowKey: z.string().min(1),
  planRowId: z.number().int().positive("planRowId must be a positive integer"),
  executionId: z.number().int().positive().nullable(),
  version: z.number().int().min(0, "version must be a non-negative integer"),
  // fields is the merged actuals+override blob from the client grid
  fields: z.record(z.string(), z.unknown()),
  // true = this row has no user edits (D3-02: skip if still pristine at save time)
  isPlaceholder: z.boolean(),
  // POP kit lines (only present for pop-dealer-kit activity)
  popLines: z
    .array(popLineSchema)
    .max(500, "popLines cannot exceed 500 items")
    .optional(),
});

const saveBatchSchema = z.object({
  activity: z.string().min(1, "activity is required"),
  periodId: z.number().int().positive("periodId must be a positive integer"),
  // Cap at 2000 units per batch (DoS guard — T-03-07)
  units: z
    .array(unitPatchSchema)
    .max(2000, "batch cannot exceed 2000 units"),
});

// ---------------------------------------------------------------------------
// State types
// ---------------------------------------------------------------------------

export type SavedUnit = {
  rowKey: string;
  id: number;
  version: number; // the NEW version after save (version + 1 for updates, 0 for inserts)
};

export type SaveBatchState =
  | { ok: true; savedIds: SavedUnit[]; conflicts: number[] }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Server-side trust-recompute helper (D3-05 / Pitfall 9)
// ---------------------------------------------------------------------------

/**
 * Derived field keys that the server must recompute if not overridden.
 * This list matches the fields declared with `computeFrom` in the activity registry.
 */
const DERIVED_KEYS = ["totalSqft", "totalCost"] as const;

/**
 * Re-run the authoritative derived-calc formulas for non-overridden fields.
 * Returns a NEW fields object with server-computed values replacing any client-sent
 * values for non-overridden derived cells.
 *
 * An OVERRIDDEN cell (isOverridden(fields, key) === true) keeps the client value —
 * the user deliberately chose to override the formula (D3-05 sticky behaviour).
 *
 * This prevents a lying client from persisting wrong totals for non-overridden cells.
 * (Pitfall 9: "one authoritative calc path so grid, export, dashboard never disagree")
 */
function applyServerCalc(
  activityKey: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...fields };

  for (const key of DERIVED_KEYS) {
    if (isOverridden(out, key)) {
      // User deliberately overrode this cell — keep their value; do NOT recompute.
      continue;
    }
    const derived = computeDerived(activityKey, key, out);
    if (derived !== null) {
      out[key] = derived;
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Empty-placeholder detection (D3-02 / Pitfall 5)
// ---------------------------------------------------------------------------

/**
 * Returns true if a unit patch represents an untouched placeholder that should NOT
 * be persisted. A placeholder is "empty" when isPlaceholder is true AND the fields
 * object contains no meaningful user-entered values (only structural keys like
 * __overrides are excluded from the meaningfulness check).
 *
 * Rule (D3-02): a placeholder that received any edit (status, measurement, cost, etc.)
 * MUST be persisted as a real execution. Only a fully-pristine placeholder is skipped.
 */
function isEmptyPlaceholder(unit: {
  isPlaceholder: boolean;
  executionId: number | null;
  fields: Record<string, unknown>;
  popLines?: unknown[];
}): boolean {
  if (!unit.isPlaceholder || unit.executionId !== null) return false;

  // Check if the fields object has any meaningful entries (not just __overrides)
  const STRUCTURAL_KEYS = new Set(["__overrides"]);
  const meaningfulKeys = Object.keys(unit.fields).filter(
    (k) => !STRUCTURAL_KEYS.has(k) && unit.fields[k] != null && unit.fields[k] !== "",
  );
  if (meaningfulKeys.length > 0) return false;

  // A POP unit with lines is never empty — it's a real kit
  if (unit.popLines && unit.popLines.length > 0) return false;

  return true;
}

// ---------------------------------------------------------------------------
// saveExecutionsBatch — the action
// ---------------------------------------------------------------------------

/**
 * Batch-save execution patches from the actuals grid.
 *
 * Protocol:
 *   1. requireSession() — auth boundary (first statement, CVE-2025-29927)
 *   2. Zod safeParse — re-validate every unit (never trust the client)
 *   3. Filter empty placeholders (D3-02)
 *   4. Server trust-recompute (D3-05)
 *   5. ONE db.transaction:
 *        - placeholder → insertExecution (version 0)
 *        - POP unit → savePopKit (replace-all execution_items)
 *        - existing → updateExecutionVersioned (bump version; collect conflict if stale)
 *   6. revalidatePath("/actuals")
 *   7. Return { ok:true, savedIds, conflicts }
 *
 * The try/catch is AROUND db.transaction(...), NEVER inside the callback.
 * A throw inside the callback rolls back the transaction (Drizzle's mechanism).
 * Per-unit conflicts are COLLECTED (not thrown) so unaffected units still commit (D3-11).
 */
export async function saveExecutionsBatch(
  _prev: unknown,
  input: unknown,
): Promise<SaveBatchState> {
  // (1) Auth re-check — BEFORE any DB touch.
  await requireSession();

  // (2) Zod re-validate.
  const parsed = saveBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    };
  }

  const { activity, units } = parsed.data;

  const savedIds: SavedUnit[] = [];
  const conflicts: number[] = [];

  try {
    await db.transaction(async (tx) => {
      for (const unit of units) {
        // (3) Skip empty placeholders — do not persist (D3-02 / Pitfall 5).
        if (isEmptyPlaceholder(unit)) continue;

        // (4) Server trust-recompute: re-derive non-overridden derived fields.
        // This replaces any client-sent total for a non-overridden cell with the
        // server's authoritative computation (Pitfall 9 / D3-05).
        const serverFields = applyServerCalc(activity, unit.fields);

        // Extract the top-level numeric columns from the recomputed fields.
        // These are promoted to real numeric(14,2) columns on the row.
        const totalSqft =
          serverFields["totalSqft"] != null ? String(serverFields["totalSqft"]) : null;
        const totalCost =
          serverFields["totalCost"] != null ? String(serverFields["totalCost"]) : null;
        const perUnitCost =
          serverFields["perUnitCost"] != null ? String(serverFields["perUnitCost"]) : null;
        const status =
          typeof serverFields["status"] === "string" ? serverFields["status"] : null;
        const unitNo =
          typeof serverFields["unitNo"] === "string" ? serverFields["unitNo"] : null;

        // The jsonb fields blob persisted to `executions.fields` (measurements, lat/long, etc.)
        // Excludes the promoted numeric columns so they aren't duplicated in both places.
        const { totalSqft: _ts, totalCost: _tc, perUnitCost: _pu, status: _st, unitNo: _un, ...jsonbFields } =
          serverFields;
        void _ts; void _tc; void _pu; void _st; void _un;

        if (unit.popLines != null) {
          // (5a) POP kit: one execution + N execution_items atomically (D3-13/14).
          const lines: PopLine[] = unit.popLines.map((l) => ({
            itemName: l.itemName,
            qty: l.qty,
            rate: l.rate,
            lineTotal: l.lineTotal,
          }));
          const kitId = await savePopKit(tx, unit.planRowId, unit.executionId, lines);
          savedIds.push({ rowKey: unit.rowKey, id: kitId, version: 0 });
        } else if (unit.executionId == null) {
          // (5b) New placeholder that received edits → INSERT (version 0).
          const newId = await insertExecution(tx, {
            planRowId: unit.planRowId,
            fields: jsonbFields,
            version: 0,
            status,
            unitNo,
            perUnitCost,
            totalCost,
            totalSqft,
          });
          savedIds.push({ rowKey: unit.rowKey, id: newId, version: 0 });
        } else {
          // (5c) Existing execution → versioned UPDATE (D3-11).
          // Returns false if the row's stored version doesn't match expectedVersion
          // (someone else changed it — stale). Collect conflict; do NOT throw.
          const ok = await updateExecutionVersioned(
            tx,
            unit.executionId,
            unit.version,
            {
              fields: jsonbFields,
              status,
              unitNo,
              perUnitCost,
              totalCost,
              totalSqft,
            },
          );
          if (ok) {
            savedIds.push({
              rowKey: unit.rowKey,
              id: unit.executionId,
              version: unit.version + 1,
            });
          } else {
            // Version conflict: BLOCK this unit's save (do NOT overwrite), collect it.
            // D3-11: other units in the same batch still commit normally.
            conflicts.push(unit.executionId);
          }
        }
      }
      // The transaction commits here even if some units were collected as conflicts.
      // This is the explicit DIFFERENCE from commitPlanUpload:
      //   commitPlanUpload: let FK-restrict throw roll back everything (all-or-nothing batch).
      //   saveExecutionsBatch: per-unit conflicts are collected, tx commits (partial success ok).
    });
  } catch (err) {
    // Only genuine errors reach here (Zod already passed, DB blip, schema drift).
    // Per-unit conflicts are collected above — they never throw.
    throw err;
  }

  // (6) Invalidate the actuals page cache so the next load reflects the saved rows.
  revalidatePath("/actuals");

  // (7) Return the save result with collected conflicts for the grid's conflict UI.
  return { ok: true, savedIds, conflicts };
}
