"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SESSION_COOKIE, verifySession } from "../auth/session";
import { upsertAdhocBatch, type AdhocBatchResult } from "../db/adhoc";

/**
 * saveAdhocExpenses — Server Action for the Adhoc tab Save bar.
 *
 * Mirrors the saveExecutionsBatch pattern:
 *   - requireSession() is the FIRST statement (CVE-2025-29927 — middleware is the UX
 *     gate, not the security boundary; the action is the boundary).
 *   - Zod validates the payload before it touches the DAL.
 *   - The DAL (`upsertAdhocBatch`) owns the single db.transaction + version conflict
 *     collection (partial-success semantics, D3-11).
 *   - revalidatePath("/actuals") after the DAL call so the grid re-fetches.
 *
 * Per-row periodId is required by AdhocInput, so the top-level periodId is injected
 * into each row before handing off to the DAL. expenseAmount arrives as `number`
 * from the client and is converted to a fixed-2 string for the numeric(14,2) column.
 */

// ---------------------------------------------------------------------------
// Auth helper — verbatim copy from lib/actions/executions.ts
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

const adhocRowSchema = z.object({
  id: z.number().int().positive().nullable(),
  region: z.string().nullable(),
  state: z.string().nullable(),
  district: z.string().nullable(),
  taluka: z.string().nullable(),
  activity: z.string().nullable(),
  activityDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "activityDate must be ISO YYYY-MM-DD")
    .nullable(),
  budgetHeader: z.string().nullable(),
  expenseAmount: z
    .number()
    .finite()
    .nonnegative("expense amount must be non-negative"),
  vendorName: z.string().nullable(),
  remarks: z.string().nullable(),
  version: z.number().int().min(0),
});

const payloadSchema = z.object({
  periodId: z.number().int().positive("periodId is required"),
  rows: z.array(adhocRowSchema).max(2000),
});

export type SaveAdhocPayload = z.infer<typeof payloadSchema>;

export async function saveAdhocExpenses(
  payload: SaveAdhocPayload,
): Promise<AdhocBatchResult> {
  await requireSession();
  const parsed = payloadSchema.parse(payload);

  const result = await upsertAdhocBatch(
    parsed.rows.map((r) => ({
      ...r,
      periodId: parsed.periodId,
      expenseAmount: r.expenseAmount.toFixed(2),
    })),
  );

  revalidatePath("/actuals");
  return result;
}
