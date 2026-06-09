import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  _findPlanRowIdForTest,
  _seedExecutionForTest,
} from "@/lib/db/plan-rows";
import { _findExecutionForTest } from "@/lib/db/executions";

/**
 * TEST-ONLY seed helper for the Playwright suite.
 *
 * Defense-in-depth (all three gates preserved — T-03-10):
 *   1. NODE_ENV !== "production" — 404 in production even if bundled by accident.
 *   2. Requires the session cookie (jose-signed JWT via lib/auth/session).
 *   3. Method = POST only (GET returns 405).
 *
 * Extended in 03-04 to also return the execution id + version after seeding,
 * so the e2e actuals conflict test can build a stale-version payload.
 *
 * Body: JSON `{ periodId, activity, sfid, status?, totalCost?, executionDate? }`.
 *   - `status` (optional) — execution status literal (default 'Pending'). The
 *     dashboard e2e passes 'Done' so `% Executed` is non-zero (DASH-01).
 *   - `totalCost` (optional) — execution ₹, drives weekly spend (DASH-06).
 *   - `executionDate` (optional, 'YYYY-MM-DD') — written into jsonb `fields`; the
 *     weekly aggregator buckets on this (DASH-06).
 * Response:
 *   200: { planRowId, executionId, version }
 *   4xx: { error }
 *
 * NEVER call from app code. NEVER reference from a Server Action.
 */

const NOT_FOUND = NextResponse.json(
  { error: "Not Found" },
  { status: 404 },
);

export async function POST(req: Request): Promise<Response> {
  // Gate 1: production lockdown.
  if (process.env.NODE_ENV === "production") {
    return NOT_FOUND;
  }

  // Gate 2: session.
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const periodId = Number(
    (body as { periodId?: unknown })?.periodId,
  );
  const activity = (body as { activity?: unknown })?.activity;
  const sfid = (body as { sfid?: unknown })?.sfid;
  if (
    !Number.isInteger(periodId) ||
    periodId <= 0 ||
    typeof activity !== "string" ||
    activity.length === 0 ||
    typeof sfid !== "string" ||
    sfid.length === 0
  ) {
    return NextResponse.json(
      { error: "Missing or invalid periodId/activity/sfid" },
      { status: 400 },
    );
  }

  const planRowId = await _findPlanRowIdForTest(periodId, activity, sfid);
  if (planRowId === null) {
    return NextResponse.json(
      { error: `No plan_row for (${periodId}, ${activity}, ${sfid})` },
      { status: 404 },
    );
  }

  // Optional dashboard-e2e knobs (Plan 04-04): status / totalCost / executionDate.
  const rawStatus = (body as { status?: unknown })?.status;
  const rawTotalCost = (body as { totalCost?: unknown })?.totalCost;
  const rawExecDate = (body as { executionDate?: unknown })?.executionDate;
  const seedOpts: {
    status?: string;
    totalCost?: number;
    executionDate?: string;
  } = {};
  if (typeof rawStatus === "string" && rawStatus.length > 0) {
    seedOpts.status = rawStatus;
  }
  if (typeof rawTotalCost === "number" && Number.isFinite(rawTotalCost)) {
    seedOpts.totalCost = rawTotalCost;
  }
  if (typeof rawExecDate === "string" && rawExecDate.length > 0) {
    seedOpts.executionDate = rawExecDate;
  }

  // Seed the execution (defaults: status='Pending', unitNo='e2e-seed-1').
  await _seedExecutionForTest(planRowId, seedOpts);

  // 03-04 extension: read back id + version so the e2e conflict test can use them.
  // _findExecutionForTest is a test-only helper — gate is already in effect above.
  const exec = await _findExecutionForTest(planRowId);
  if (exec === null) {
    return NextResponse.json(
      { error: "Seed inserted but could not read back execution" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    planRowId,
    executionId: exec.id,
    version: exec.version,
  });
}

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === "production") return NOT_FOUND;
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
