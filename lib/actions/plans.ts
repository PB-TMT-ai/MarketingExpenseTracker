"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { db } from "../db";
import { planRows } from "../db/schema";
import {
  bulkInsertPlanRows,
  deletePlanRows,
  queryBlockedDealers,
  updatePlanRow,
  type BlockedDealer,
  type PlanRowInsert,
  type PlanRowUpdate,
} from "../db/plan-rows";
import { parseCommitInput } from "../excel/schema";
import type { ActivityKey } from "../activities/types";
import type { ParsedRow } from "../excel/types";

/**
 * Plan-upload Server Action — defense-in-depth re-checks the jose cookie on every call
 * (proxy.ts is the UX gate, not the boundary — CVE-2025-29927 lesson). Every incoming
 * row is re-validated server-side via `parseCommitInput`/`PLAN_ROW_SCHEMAS[activity]`,
 * so a lying browser cannot smuggle bad data past the preview.
 *
 * Atomic-commit mirror semantics (D2-01 — RESEARCH §3 verbatim):
 *   ONE Drizzle transaction containing insert(chunked 500) → update → delete on
 *   plan_rows for (periodId, activity). If FK RESTRICT fires on the delete branch
 *   (a removed SFID has child executions), the WHOLE transaction rolls back and
 *   the catch translates SQLSTATE 23001/23503 into { ok: false, blockedDealers }.
 *
 * The try/catch is AROUND db.transaction(...), NEVER inside the callback — the
 * callback throwing is HOW Drizzle knows to roll back. Common-Pitfalls A.
 *
 * SECURITY: This file MUST NEVER import the SheetJS library (D2-06). The Server
 * Action consumes JSON only; .xlsx parsing runs client-side. Acceptance gate
 * asserts zero SheetJS import statements in this file (CVE-2023-30533 surface).
 *
 * RESEARCH "Open Questions" §1: POP / dealer-cert / GSB / NLB plannedCost stays
 * null — those activities' planColumns don't declare a planned-cost field; the
 * Phase 4 dashboard will sum planned cost only across activities with the column.
 */

async function requireSession(): Promise<void> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    throw new Error("Unauthorized");
  }
}

/**
 * SQLSTATE 23001 = restrict_violation (what ON DELETE RESTRICT actually raises).
 * SQLSTATE 23503 = foreign_key_violation (what NO ACTION raises; some drivers normalize).
 *
 * PGlite's DatabaseError class is bundled and obfuscated (electric-sql/pglite#333) so
 * `instanceof` is unreliable across PGlite versions — duck-type on `.code`. Both
 * Drizzle wrappers (postgres-js and PGlite) expose the underlying SQLSTATE at
 * `err.cause.code`; we also fall back to `err.code` for any non-wrapped throw.
 *
 * Explicit two-code check, NOT `code?.startsWith("23")` — 23505 (unique violation,
 * e.g. duplicate SFID in the same period+activity) needs a different handling path
 * (let it propagate as a generic error). RESEARCH §8.
 */
function isFkRestrictError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const cause = (err as { cause?: unknown }).cause;
  const code =
    (cause as { code?: string } | undefined)?.code ??
    (err as { code?: string }).code;
  return code === "23001" || code === "23503";
}

export type CommitPlanInput = {
  periodId: number;
  activity: string;
  rows: readonly ParsedRow[];
};

export type CommitPlanState =
  | { ok: true; inserted: number; updated: number; deleted: number }
  | { ok: false; error: string; blockedDealers?: BlockedDealer[] };

/**
 * Convert a ParsedRow + (periodId, activity) into the shape `bulkInsertPlanRows` accepts.
 * `sharedFields` map keys → real plan_rows columns (region/state/district/taluka/distributor/dealer).
 */
function toInsertShape(
  periodId: number,
  activity: string,
  row: ParsedRow,
): PlanRowInsert {
  const s = row.sharedFields;
  return {
    periodId,
    activity,
    sfid: row.sfid,
    region: (s.region ?? null) as string | null,
    state: (s.state ?? null) as string | null,
    district: (s.district ?? null) as string | null,
    taluka: (s.taluka ?? null) as string | null,
    distributor: (s.distributor ?? null) as string | null,
    dealer: (s.dealer ?? null) as string | null,
    plannedCost: row.plannedCost,
    fields: row.jsonbFields as Record<string, unknown>,
  };
}

/**
 * Convert a ParsedRow into the patch shape `updatePlanRow` accepts. Same routing
 * decision as the insert path (shared → real columns; everything else → jsonb tail).
 */
function toUpdateShape(row: ParsedRow): PlanRowUpdate {
  const s = row.sharedFields;
  return {
    region: (s.region ?? null) as string | null,
    state: (s.state ?? null) as string | null,
    district: (s.district ?? null) as string | null,
    taluka: (s.taluka ?? null) as string | null,
    distributor: (s.distributor ?? null) as string | null,
    dealer: (s.dealer ?? null) as string | null,
    plannedCost: row.plannedCost,
    fields: row.jsonbFields as Record<string, unknown>,
  };
}

/**
 * commitPlanUpload — mirror-semantics commit + FK-restrict catch.
 *
 * The action accepts a JSON input shape `{ periodId, activity, rows: ParsedRow[] }`
 * (the wire payload the browser preview will send via useTransition in Plan 02-03).
 * useActionState callers should use `commitPlanUploadForm` which parses a `rows`
 * field of stringified JSON from a FormData wrapper.
 */
export async function commitPlanUpload(
  _prev: unknown,
  input: CommitPlanInput,
): Promise<CommitPlanState> {
  // Auth re-check — BEFORE any DB touch. Throws on failure (proxy.ts is the UX gate,
  // this is the boundary). The Unauthorized throw matches periods.ts conventions.
  await requireSession();

  // Defense-in-depth Zod re-check. The browser preview already validated, but a lying
  // client can smuggle anything past it — `parseCommitInput` re-runs PLAN_ROW_SCHEMAS
  // on every row and returns the first ≤5 row errors. T-02-02-01 mitigation.
  // We forward the raw rows array to parseCommitInput so it can match against the
  // per-activity row shape. ParsedRow's nested `sharedFields`/`jsonbFields`/`plannedCost`
  // are FLATTENED here to match the per-activity schema (which mirrors planColumns keys).
  const rowsForZod = input.rows.map((r) => ({
    ...r.sharedFields,
    ...r.jsonbFields,
    plannedCost: r.plannedCost,
  }));
  const zodResult = parseCommitInput({
    periodId: input.periodId,
    activity: input.activity,
    rows: rowsForZod,
  });
  if (!zodResult.ok) {
    return { ok: false, error: zodResult.error };
  }
  const activity = zodResult.data.activity as ActivityKey;
  const periodId = zodResult.data.periodId;
  const incomingSfids = input.rows.map((r) => r.sfid);

  try {
    const result = await db.transaction(async (tx) => {
      // 1. Snapshot existing rows for (periodId, activity).
      const existing = await tx
        .select({ id: planRows.id, sfid: planRows.sfid })
        .from(planRows)
        .where(and(eq(planRows.periodId, periodId), eq(planRows.activity, activity)));
      const bySfid = new Map(existing.map((r) => [r.sfid, r.id]));
      const incomingSet = new Set(incomingSfids);

      // 2. Insert NEW rows in 500-row chunks (under 65535-param wire cap — RESEARCH §4).
      // The chunked loop runs INSIDE the transaction so a partial chunk failure rolls
      // back ALL chunks (Common-Pitfalls D + the atomic-commit guarantee).
      const toInsert = input.rows
        .filter((r) => !bySfid.has(r.sfid))
        .map((r) => toInsertShape(periodId, activity, r));
      const inserted = await bulkInsertPlanRows(tx, toInsert);

      // 3. Update EXISTING rows (per row — small N expected for "changed").
      let updated = 0;
      for (const row of input.rows) {
        const id = bySfid.get(row.sfid);
        if (id == null) continue;
        await updatePlanRow(tx, id, toUpdateShape(row));
        updated++;
      }

      // 4. DELETE removed — the only branch that can fail with FK RESTRICT.
      // Order is insert → update → delete because delete is the only recoverable
      // failure path; doing it last means the catch knows the failure is delete-related
      // (Common-Pitfalls D).
      const toDeleteIds = existing
        .filter((r) => !incomingSet.has(r.sfid))
        .map((r) => r.id);
      let deleted = 0;
      if (toDeleteIds.length > 0) {
        await deletePlanRows(tx, toDeleteIds);
        deleted = toDeleteIds.length;
      }

      return { inserted, updated, deleted };
    });

    // Plan 02-03 ships /plans; revalidatePath on a not-yet-existing route is a no-op
    // and will start working when the route ships. Keeping it here so 02-03 doesn't
    // have to retrofit cache invalidation across previously-shipped actions.
    revalidatePath("/plans");
    return { ok: true, ...result };
  } catch (err) {
    if (isFkRestrictError(err)) {
      // The transaction is rolled back — DB state is exactly what it was before the
      // commit attempted. Re-query OUTSIDE the failed transaction using the outer `db`
      // to compute which SFIDs blocked. Pitfall: `tx` cannot be reused here.
      const blocked = await queryBlockedDealers(db, periodId, activity, incomingSfids);
      return {
        ok: false,
        error: `Cannot remove ${blocked.length} dealer(s) with recorded actuals`,
        blockedDealers: blocked,
      };
    }
    // Anything else (network blip, schema drift, Zod-shaped unique-violation 23505) —
    // propagate so the framework's error boundary handles it; do NOT swallow.
    throw err;
  }
}

/**
 * `<form action={fn}>` adapter for callers that want useActionState ergonomics.
 * The `rows` field is a JSON-stringified ParsedRow[]; periodId + activity are plain
 * form fields. Mirrors the `setActivePeriodForm` pattern from periods.ts.
 */
export async function commitPlanUploadForm(
  _prev: unknown,
  formData: FormData,
): Promise<CommitPlanState> {
  const periodIdRaw = formData.get("periodId");
  const activityRaw = formData.get("activity");
  const rowsRaw = formData.get("rows");
  if (typeof periodIdRaw !== "string" || typeof activityRaw !== "string" || typeof rowsRaw !== "string") {
    return { ok: false, error: "Missing form fields (periodId, activity, rows)" };
  }
  const periodId = Number(periodIdRaw);
  if (!Number.isInteger(periodId) || periodId <= 0) {
    return { ok: false, error: "Invalid periodId" };
  }
  let rows: ParsedRow[];
  try {
    rows = JSON.parse(rowsRaw) as ParsedRow[];
  } catch {
    return { ok: false, error: "Invalid rows JSON" };
  }
  return commitPlanUpload(_prev, { periodId, activity: activityRaw, rows });
}
