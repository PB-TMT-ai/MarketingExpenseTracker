import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Plans spec.
 *
 * Two layers:
 *   - lib/db/plan-rows.ts — typed query helpers in isolation (list/insert/delete/blocker re-query).
 *   - lib/actions/plans.ts — Zod re-check + auth re-check + mirror-semantics commit + FK-restrict catch.
 *
 * Live PGlite via the shared `db` instance. vitest.config.ts sets DATABASE_URL=memory://
 * so this never collides with the dev server's ./.pglite directory (DEF-02-01-01 fix).
 *
 * The three vi.mock blocks MUST appear BEFORE any non-vi import — Server Actions need a
 * Next request context, so cookies() / revalidatePath / verifySession are mocked.
 *
 * `verifySession` is wired as a `vi.fn()` so individual tests can override it for the
 * auth-rejected path (mockImplementationOnce returns false).
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "session" ? { value: "fake-token-for-tests" } : undefined,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const verifySessionMock = vi.fn(async (t: string) => t === "fake-token-for-tests");
vi.mock("../auth/session", () => ({
  SESSION_COOKIE: "session",
  verifySession: (t: string) => verifySessionMock(t),
}));

import { sql } from "drizzle-orm";
import { db } from "../db";
import { ensureMigrated } from "../db/migrate";
import {
  _resetExecutionsForTest,
  _resetPlanRowsForTest,
  insertExceptionPlanRow,
  listByPeriodActivity,
} from "../db/plan-rows";
import {
  _resetPeriodsForTest,
  insertPeriod,
} from "../db/periods";
import { commitPlanUpload, deletePlanByScope } from "./plans";
import type { ParsedRow } from "../excel/types";

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  // FK-safe order: executions first (children), then plan_rows (parent), then periods.
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();
  // Reset the verifySession mock to the default "true for fake-token" after each test.
  verifySessionMock.mockImplementation(async (t: string) => t === "fake-token-for-tests");
});

/** Build a counter-wall ParsedRow with deterministic shared/jsonb shape. */
function makeCounterWallRow(sfid: string, region = "West", planSqft = 100): ParsedRow {
  return {
    sfid,
    sharedFields: {
      region,
      sfid,
      state: "MH",
      district: "Pune",
      taluka: "Haveli",
      distributor: "ACME",
    },
    jsonbFields: {
      dealerOrArea: `Dealer ${sfid}`,
      planSqft,
    },
    plannedCost: null,
  };
}

/** Helper: count plan_rows for (periodId, activity). */
async function planRowCount(periodId: number, activity: string): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from plan_rows where period_id = ${periodId} and activity = ${activity}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

/** Helper: count executions for a given plan_row id. */
async function executionCount(planRowId: number): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from executions where plan_row_id = ${planRowId}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

describe("lib/db/plan-rows queries", () => {
  it("listByPeriodActivity returns rows shaped per PlanRowRecord", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B")],
    });
    expect(state.ok).toBe(true);

    const rows = await listByPeriodActivity(periodId, "counter-wall");
    expect(rows).toHaveLength(2);
    const sfids = rows.map((r) => r.sfid).sort();
    expect(sfids).toEqual(["SF-A", "SF-B"]);
    // Shared columns routed correctly
    expect(rows[0].region).toBe("West");
    expect(rows[0].state).toBe("MH");
    // jsonb tail captured
    expect((rows[0].fields as { dealerOrArea?: string }).dealerOrArea).toContain("Dealer");
    expect((rows[0].fields as { planSqft?: number }).planSqft).toBe(100);
    expect(rows[0].plannedCost).toBeNull();
  });

  it("_resetPlanRowsForTest clears all plan rows", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A")],
    });
    expect(await planRowCount(periodId, "counter-wall")).toBe(1);
    await _resetPlanRowsForTest();
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
  });
});

describe("lib/actions/plans (Zod + auth + mirror semantics)", () => {
  it("insert-fresh: 3 rows into empty period+activity → ok, inserted=3", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [
        makeCounterWallRow("SF-1"),
        makeCounterWallRow("SF-2"),
        makeCounterWallRow("SF-3"),
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.inserted).toBe(3);
    expect(state.updated).toBe(0);
    expect(state.deleted).toBe(0);
    expect(await planRowCount(periodId, "counter-wall")).toBe(3);
  });

  it("update-changed: re-upload with one SFID's region changed → ok, updated=2, count unchanged", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A", "West"), makeCounterWallRow("SF-B", "West")],
    });
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);

    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [
        makeCounterWallRow("SF-A", "South"), // region changed
        makeCounterWallRow("SF-B", "West"),
      ],
    });
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.inserted).toBe(0);
    expect(state.updated).toBe(2);
    expect(state.deleted).toBe(0);
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);
    const rows = await listByPeriodActivity(periodId, "counter-wall");
    const sfa = rows.find((r) => r.sfid === "SF-A");
    expect(sfa?.region).toBe("South");
  });

  it("delete-clean: re-upload drops a SFID with no executions → ok, deleted=1, count=1", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B")],
    });
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);

    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A")], // SF-B is dropped, no executions on it
    });
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.inserted).toBe(0);
    expect(state.updated).toBe(1);
    expect(state.deleted).toBe(1);
    expect(await planRowCount(periodId, "counter-wall")).toBe(1);
  });

  it("FK-blocked: re-upload dropping a SFID WITH execution → ok=false, blockedDealers reports SF-A, row count UNCHANGED, execution survives (D2-01 invariant)", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    // Seed two plan rows
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B")],
    });
    const rowsAfterSeed = await listByPeriodActivity(periodId, "counter-wall");
    const planRowA = rowsAfterSeed.find((r) => r.sfid === "SF-A");
    expect(planRowA).toBeDefined();
    if (!planRowA) throw new Error("unreachable");

    // Seed ONE execution against SF-A via raw SQL (no executions Server Action yet).
    await db.execute(
      sql`insert into executions (plan_row_id, status, unit_no) values (${planRowA.id}, 'Pending', 'unit-1')`,
    );
    expect(await executionCount(planRowA.id)).toBe(1);

    const countBefore = await planRowCount(periodId, "counter-wall");
    expect(countBefore).toBe(2);

    // Re-upload OMITTING SF-A → mirror-delete should fire FK RESTRICT → rollback.
    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-B")],
    });
    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toMatch(/Cannot remove .* dealer/);
    expect(state.blockedDealers).toBeDefined();
    expect(state.blockedDealers).toHaveLength(1);
    expect(state.blockedDealers?.[0]?.sfid).toBe("SF-A");
    expect(state.blockedDealers?.[0]?.executionCount).toBe(1);

    // Rollback held: plan_row count UNCHANGED, execution still exists.
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);
    expect(await executionCount(planRowA.id)).toBe(1);
  });

  it("Zod-rejected: row with empty sfid → ok=false, error mentions a row number, nothing written", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    // Construct a row whose sfid is empty string — required check from PLAN_ROW_SCHEMAS rejects it.
    const badRow: ParsedRow = {
      sfid: "",
      sharedFields: {
        region: "West",
        sfid: "",
        state: "MH",
        district: "Pune",
        taluka: "Haveli",
        distributor: "ACME",
      },
      jsonbFields: { dealerOrArea: "X", planSqft: 100 },
      plannedCost: null,
    };
    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-OK"), badRow],
    });
    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toMatch(/row \d+/);
    // Nothing should have been written.
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
  });

  it("R4 re-upload guard: re-upload {A} after {A,B}+exception X deletes B (plan-upload orphan) but PRESERVES X (exception) and keeps A", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });

    // 1. Upload a plan with SFIDs {A, B} (both source='plan-upload').
    const seed = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B")],
    });
    expect(seed.ok).toBe(true);
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);

    // 2. Add an off-plan-EXCEPTION row for SFID 'X' (source='exception'), via the same
    //    DB helper the addOffPlanExecution action uses. `db` doubles as a DbOrTx here.
    const exceptionId = await insertExceptionPlanRow(db, {
      periodId,
      activity: "counter-wall",
      sfid: "SF-X",
      region: "West",
      state: "MH",
      district: "Pune",
      taluka: "Haveli",
      distributor: "ACME",
      dealer: "Off-plan Dealer X",
      fields: {},
      exceptionReason: "Executed off-plan before upload",
    });
    expect(exceptionId).toBeGreaterThan(0);
    expect(await planRowCount(periodId, "counter-wall")).toBe(3);

    // 3. Re-upload a plan with {A} ONLY — both B and X are absent from the upload.
    const reupload = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A")],
    });
    expect(reupload.ok).toBe(true);
    if (!reupload.ok) throw new Error("unreachable");
    // Only B (the plan-upload orphan) is deleted — NOT X (the exception).
    expect(reupload.deleted).toBe(1);

    // 4. Assert final state directly: A kept, B deleted, X SURVIVES with source='exception'.
    const rows = await listByPeriodActivity(periodId, "counter-wall");
    const bySfid = new Map(rows.map((r) => [r.sfid, r]));
    expect(bySfid.has("SF-A")).toBe(true); // plan row kept
    expect(bySfid.has("SF-B")).toBe(false); // plan-upload orphan deleted
    expect(bySfid.has("SF-X")).toBe(true); // exception row PRESERVED (R4)
    expect(bySfid.get("SF-X")?.source).toBe("exception");
    expect(bySfid.get("SF-A")?.source).toBe("plan-upload");
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);
  });

  it("additive mode: re-upload {A} with commitMode='additive' after {A,B} KEEPS B (no orphan delete)", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A", "West"), makeCounterWallRow("SF-B")],
    });
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);

    // Re-upload only SF-A (with a change) in additive mode — SF-B must survive.
    const state = await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A", "South")],
      commitMode: "additive",
    });
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.inserted).toBe(0);
    expect(state.updated).toBe(1);
    expect(state.deleted).toBe(0); // additive: B is NOT deleted
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);
    const rows = await listByPeriodActivity(periodId, "counter-wall");
    expect(rows.find((r) => r.sfid === "SF-A")?.region).toBe("South");
    expect(rows.some((r) => r.sfid === "SF-B")).toBe(true);
  });

  it("deletePlanByScope: removes all rows for the scope when none have executions → ok, deleted=N", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B"), makeCounterWallRow("SF-C")],
    });
    expect(await planRowCount(periodId, "counter-wall")).toBe(3);

    const state = await deletePlanByScope(periodId, "counter-wall");
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.deleted).toBe(3);
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
  });

  it("deletePlanByScope: idempotent on empty scope → ok, deleted=0", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    const state = await deletePlanByScope(periodId, "counter-wall");
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.deleted).toBe(0);
  });

  it("deletePlanByScope: FK-blocked when a row has an execution → ok=false, blockedDealers, nothing deleted", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    await commitPlanUpload(null, {
      periodId,
      activity: "counter-wall",
      rows: [makeCounterWallRow("SF-A"), makeCounterWallRow("SF-B")],
    });
    const seeded = await listByPeriodActivity(periodId, "counter-wall");
    const planRowA = seeded.find((r) => r.sfid === "SF-A");
    if (!planRowA) throw new Error("unreachable");
    await db.execute(
      sql`insert into executions (plan_row_id, status, unit_no) values (${planRowA.id}, 'Pending', 'unit-1')`,
    );

    const state = await deletePlanByScope(periodId, "counter-wall");
    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.blockedDealers).toBeDefined();
    expect(state.blockedDealers?.some((b) => b.sfid === "SF-A")).toBe(true);
    // Rollback held — nothing deleted, execution survives.
    expect(await planRowCount(periodId, "counter-wall")).toBe(2);
    expect(await executionCount(planRowA.id)).toBe(1);
  });

  it("auth-rejected: verifySession returns false → throws Unauthorized, nothing written", async () => {
    const periodId = await insertPeriod({
      type: "month",
      label: "Aug 2026",
      startDate: "2026-08-01",
      endDate: "2026-08-31",
    });
    verifySessionMock.mockImplementationOnce(async () => false);
    await expect(
      commitPlanUpload(null, {
        periodId,
        activity: "counter-wall",
        rows: [makeCounterWallRow("SF-A")],
      }),
    ).rejects.toThrow(/Unauthorized/);
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
  });
});
