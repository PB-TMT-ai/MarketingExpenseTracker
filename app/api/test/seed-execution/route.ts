import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import {
  _findPlanRowIdForTest,
  _seedExecutionForTest,
} from "@/lib/db/plan-rows";

/**
 * TEST-ONLY seed helper for the Playwright suite — Plan 02-03.
 *
 * Why this exists: the blocked-by-actuals e2e (closes COMP-02 user-facing path)
 * needs an `executions` row attached to a known plan_row so that re-uploading
 * a plan missing that SFID triggers the FK RESTRICT and the UI renders
 * `data-slot="blocked-dealers"`. Phase 3 will ship the actuals UI; until then
 * this gated Route Handler is the bridge.
 *
 * Defense-in-depth:
 *   1. NODE_ENV !== "production" — short-circuits with 404 in production.
 *      A back door doesn't exist on the deployed app even if this file is
 *      bundled by accident.
 *   2. Requires the same session cookie as every other Server Action
 *      (jose-signed JWT verified by lib/auth/session). Unauthenticated
 *      callers get 401.
 *   3. Method = POST only (GET returns 405).
 *
 * Body: JSON `{ periodId: number, activity: string, sfid: string }`.
 * Response: 200 with `{ planRowId }` on success; 4xx with `{ error }` otherwise.
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

  await _seedExecutionForTest(planRowId);
  return NextResponse.json({ planRowId });
}

export async function GET(): Promise<Response> {
  if (process.env.NODE_ENV === "production") return NOT_FOUND;
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
