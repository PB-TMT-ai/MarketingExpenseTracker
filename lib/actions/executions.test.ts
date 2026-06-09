import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

/**
 * Executions spec — mirrors lib/actions/plans.test.ts EXACTLY in structure.
 *
 * Two layers:
 *   - lib/db/executions.ts — typed query helpers (insert / versioned-update / list / savePopKit).
 *   - lib/actions/executions.ts — saveExecutionsBatch (auth + Zod + server recompute +
 *     per-unit version conflict collection + empty-placeholder skip).
 *
 * Live PGlite via the shared `db` instance. vitest.config.ts sets DATABASE_URL=memory://
 * so this never collides with the dev server's ./.pglite directory.
 *
 * The three vi.mock blocks MUST appear BEFORE any non-vi import — Server Actions need a
 * Next request context, so cookies() / revalidatePath / verifySession are mocked.
 *
 * `verifySession` is wired as a `vi.fn()` so individual tests can override it for the
 * auth-rejected path (mockImplementationOnce returns false).
 *
 * Critical tests (prove D3-11 and D3-02 — properties single-user testing never catches):
 *   - version-conflict-isolation: conflicting unit blocked + sibling saved + no clobber
 *   - empty-placeholder-skipped: pristine placeholder never creates an execution row
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
  _findPlanRowIdForTest,
} from "../db/plan-rows";
import * as executionsDb from "../db/executions";
import { _findExecutionForTest, _resetExecutionItemsForTest } from "../db/executions";
import { _resetPeriodsForTest, insertPeriod } from "../db/periods";
import { saveExecutionsBatch, addOffPlanExecution } from "./executions";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  // FK-safe order (children before parents, following the FK chain):
  //   execution_items → executions → plan_rows → periods
  // execution_items has ON DELETE RESTRICT on executions.id, so must be wiped first.
  await _resetExecutionItemsForTest();
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();
  // Reset the verifySession mock to the default "true for fake-token" after each test.
  verifySessionMock.mockImplementation(async (t: string) => t === "fake-token-for-tests");
});

/** Count executions for a given plan_row id. */
async function executionCount(planRowId: number): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from executions where plan_row_id = ${planRowId}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

/** Count execution_items for a given execution id. */
async function executionItemCount(execId: number): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from execution_items where execution_id = ${execId}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

/** Read a single execution row by id. */
async function getExecution(id: number): Promise<{
  version: number;
  fields: Record<string, unknown>;
  total_cost: string | null;
  total_sqft: string | null;
  status: string | null;
} | null> {
  const raw = await db.execute(
    sql`select version, fields, total_cost, total_sqft, status from executions where id = ${id}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{
    version: number | string;
    fields: unknown;
    total_cost: string | null;
    total_sqft: string | null;
    status: string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    version: Number(row.version),
    fields: row.fields as Record<string, unknown>,
    total_cost: row.total_cost,
    total_sqft: row.total_sqft,
    status: row.status,
  };
}

/**
 * Seed a period + one plan_row, return { periodId, planRowId }.
 * Uses commitPlanUpload semantics via raw SQL to avoid the Server Action cookie dep.
 */
async function seedPlanRow(
  sfid = "TEST-SF-1",
  activity = "counter-wall",
): Promise<{ periodId: number; planRowId: number }> {
  const periodId = await insertPeriod({
    type: "month",
    label: "Test Jul 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
  await db.execute(
    sql`insert into plan_rows (period_id, activity, sfid, fields)
        values (${periodId}, ${activity}, ${sfid}, '{}')`,
  );
  const planRowId = await _findPlanRowIdForTest(periodId, activity, sfid);
  if (!planRowId) throw new Error(`seedPlanRow: could not find plan_row for sfid=${sfid}`);
  return { periodId, planRowId };
}

/** Count plan_rows for (periodId, activity), optionally filtered by source. */
async function planRowCount(
  periodId: number,
  activity: string,
  source?: string,
): Promise<number> {
  const raw =
    source == null
      ? await db.execute(
          sql`select count(*)::int as n from plan_rows where period_id = ${periodId} and activity = ${activity}`,
        )
      : await db.execute(
          sql`select count(*)::int as n from plan_rows where period_id = ${periodId} and activity = ${activity} and source = ${source}`,
        );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

/** Read a single plan_row's source/exception_reason/created_via by id. */
async function getPlanRowMeta(id: number): Promise<{
  source: string;
  exception_reason: string | null;
  created_via: string | null;
} | null> {
  const raw = await db.execute(
    sql`select source, exception_reason, created_via from plan_rows where id = ${id}`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ source: string; exception_reason: string | null; created_via: string | null }>;
  const row = rows[0];
  if (!row) return null;
  return {
    source: row.source,
    exception_reason: row.exception_reason,
    created_via: row.created_via,
  };
}

/** Seed a period only (no plan_row) — for off-plan-exception happy-path tests. */
async function seedPeriod(label = "OffPlan Jul 2026"): Promise<number> {
  return insertPeriod({
    type: "month",
    label,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
}

/** Build a minimal valid unit patch for the save action. */
function makeUnitPatch(
  planRowId: number,
  overrides: Partial<{
    rowKey: string;
    executionId: number | null;
    version: number;
    fields: Record<string, unknown>;
    isPlaceholder: boolean;
    popLines: Array<{ itemName: string; qty: number; rate: number; lineTotal: number }>;
  }> = {},
) {
  return {
    rowKey: overrides.rowKey ?? "row-1",
    planRowId,
    executionId: overrides.executionId ?? null,
    version: overrides.version ?? 0,
    fields: overrides.fields ?? {},
    isPlaceholder: overrides.isPlaceholder ?? false,
    popLines: overrides.popLines,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("saveExecutionsBatch — insert-fresh (placeholder with edits)", () => {
  it("inserts a new execution at version 0 and returns savedId", async () => {
    const { periodId, planRowId } = await seedPlanRow();

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "new-1",
          fields: { status: "In Progress", notes: "test entry" },
          isPlaceholder: false,
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.savedIds).toHaveLength(1);
    expect(state.savedIds[0]?.rowKey).toBe("new-1");
    expect(state.savedIds[0]?.version).toBe(0);
    expect(state.conflicts).toHaveLength(0);

    // Confirm the row was actually written to the DB.
    const count = await executionCount(planRowId);
    expect(count).toBe(1);

    const execRow = await getExecution(state.savedIds[0]!.id);
    expect(execRow?.version).toBe(0);
  });
});

describe("saveExecutionsBatch — update-with-version-bump", () => {
  it("updates an existing execution and bumps version by 1", async () => {
    const { periodId, planRowId } = await seedPlanRow();

    // First save: insert the execution.
    const insertState = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          fields: { status: "Pending" },
          isPlaceholder: false,
        }),
      ],
    });
    expect(insertState.ok).toBe(true);
    if (!insertState.ok) throw new Error("unreachable");
    const execId = insertState.savedIds[0]!.id;

    // Second save: update with current version (0).
    const updateState = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "row-upd",
          executionId: execId,
          version: 0, // current version
          fields: { status: "In Progress" },
          isPlaceholder: false,
        }),
      ],
    });

    expect(updateState.ok).toBe(true);
    if (!updateState.ok) throw new Error("unreachable");
    expect(updateState.savedIds).toHaveLength(1);
    expect(updateState.savedIds[0]?.version).toBe(1); // bumped from 0 → 1
    expect(updateState.conflicts).toHaveLength(0);

    const execRow = await getExecution(execId);
    expect(execRow?.version).toBe(1);
    expect(execRow?.status).toBe("In Progress");
  });
});

describe("saveExecutionsBatch — version-conflict-isolation (THE D3-11 test)", () => {
  it("stale unit is blocked; sibling unit saves; no overwrite; no full rollback", async () => {
    const { periodId, planRowId: planRowIdA } = await seedPlanRow("SF-A");
    // Seed a second plan_row for the sibling unit.
    await db.execute(
      sql`insert into plan_rows (period_id, activity, sfid, fields)
          values (${periodId}, 'counter-wall', 'SF-B', '{}')`,
    );
    const planRowIdB = await _findPlanRowIdForTest(periodId, "counter-wall", "SF-B");
    if (!planRowIdB) throw new Error("could not find SF-B plan_row");

    // Insert executions for both units (version = 0 each).
    const seedState = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowIdA, {
          rowKey: "a-1",
          fields: { status: "Pending", note: "original-A" },
        }),
        makeUnitPatch(planRowIdB, {
          rowKey: "b-1",
          fields: { status: "Pending", note: "original-B" },
        }),
      ],
    });
    expect(seedState.ok).toBe(true);
    if (!seedState.ok) throw new Error("unreachable");

    const execA = seedState.savedIds.find((s) => s.rowKey === "a-1");
    const execB = seedState.savedIds.find((s) => s.rowKey === "b-1");
    expect(execA).toBeDefined();
    expect(execB).toBeDefined();
    const execIdA = execA!.id;
    const execIdB = execB!.id;

    // Simulate a concurrent save: advance A's version to 1 directly, so the
    // subsequent batch's stale version=0 will fail for A.
    await db.execute(
      sql`update executions set version = 1 where id = ${execIdA}`,
    );

    // Now send a batch:
    //   - Unit A carries STALE version=0 (DB has version=1) → should CONFLICT
    //   - Unit B carries CURRENT version=0 (DB has version=0) → should SAVE (version→1)
    const batchState = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowIdA, {
          rowKey: "a-2",
          executionId: execIdA,
          version: 0, // STALE — DB is at version 1
          fields: { status: "Done", note: "SHOULD-NOT-PERSIST" },
        }),
        makeUnitPatch(planRowIdB, {
          rowKey: "b-2",
          executionId: execIdB,
          version: 0, // CURRENT — should save
          fields: { status: "Done", note: "updated-B" },
        }),
      ],
    });

    // The batch as a whole must succeed (ok:true — D3-11 requires no full rollback).
    expect(batchState.ok).toBe(true);
    if (!batchState.ok) throw new Error("unreachable");

    // Unit A: conflict collected, NOT in savedIds.
    expect(batchState.conflicts).toContain(execIdA);
    expect(batchState.savedIds.find((s) => s.rowKey === "a-2")).toBeUndefined();

    // Unit B: saved, version bumped.
    const savedB = batchState.savedIds.find((s) => s.rowKey === "b-2");
    expect(savedB).toBeDefined();
    expect(savedB?.version).toBe(1);

    // D3-11 invariant: A's stored value is UNCHANGED (not overwritten by the stale patch).
    const execARow = await getExecution(execIdA);
    expect(execARow?.version).toBe(1); // unchanged from the manual advance above
    expect((execARow?.fields as Record<string, unknown>)?.note).toBe("original-A");

    // Unit B's stored value reflects the successful save.
    const execBRow = await getExecution(execIdB);
    expect(execBRow?.version).toBe(1);
    expect(execBRow?.status).toBe("Done");
  });
});

describe("saveExecutionsBatch — empty-placeholder-skipped (D3-02 / Pitfall 5)", () => {
  it("a pristine placeholder with no field edits is NOT inserted", async () => {
    const { periodId, planRowId } = await seedPlanRow();

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "placeholder-1",
          executionId: null,
          version: 0,
          fields: {}, // no edits
          isPlaceholder: true, // pristine placeholder
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    // savedIds is empty — nothing was written.
    expect(state.savedIds).toHaveLength(0);
    expect(state.conflicts).toHaveLength(0);

    // Confirm the DB has NO execution row for this plan_row (D3-02 preserved).
    const count = await executionCount(planRowId);
    expect(count).toBe(0);
  });

  it("a placeholder with any non-empty field IS inserted (it received real edits)", async () => {
    const { periodId, planRowId } = await seedPlanRow();

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "edited-placeholder",
          executionId: null,
          version: 0,
          fields: { status: "In Progress" }, // has an edit
          isPlaceholder: true, // still marked placeholder by the grid
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    // Row has meaningful data → must be inserted.
    expect(state.savedIds).toHaveLength(1);
    const count = await executionCount(planRowId);
    expect(count).toBe(1);
  });
});

describe("saveExecutionsBatch — server-recompute-trust (Pitfall 9 / D3-05)", () => {
  it("a lying client totalCost on a non-overridden cell is NOT persisted; server recomputes", async () => {
    // in-shop: totalSqft = length × breadth; totalCost = totalSqft × perUnitCost
    const { periodId, planRowId } = await seedPlanRow("SF-ISH", "in-shop");

    const state = await saveExecutionsBatch(null, {
      activity: "in-shop",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          fields: {
            length: "10",
            breadth: "5",
            perUnitCost: "100",
            // Client sends a LYING totalCost of 99999 — server must ignore it.
            totalCost: 99999,
            // No __overrides flag — cell is NOT overridden; server must recompute.
          },
          isPlaceholder: false,
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    const execId = state.savedIds[0]?.id;
    expect(execId).toBeDefined();

    const execRow = await getExecution(execId!);
    // totalSqft = 10 × 5 = 50
    expect(Number(execRow?.total_sqft)).toBe(50);
    // totalCost = 50 × 100 = 5000; NOT 99999 (the lying client value)
    expect(Number(execRow?.total_cost)).toBe(5000);
  });

  it("an OVERRIDDEN totalCost keeps the client value (D3-05 sticky)", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-OVR", "in-shop");

    const state = await saveExecutionsBatch(null, {
      activity: "in-shop",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          fields: {
            length: "10",
            breadth: "5",
            perUnitCost: "100",
            // Client deliberately overrides totalCost with 12345
            totalCost: 12345,
            __overrides: { totalCost: true }, // override flag set
          },
          isPlaceholder: false,
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    const execId = state.savedIds[0]?.id;
    expect(execId).toBeDefined();

    const execRow = await getExecution(execId!);
    // The override flag means the server keeps the client value (12345), not 5000.
    expect(Number(execRow?.total_cost)).toBe(12345);
  });
});

describe("saveExecutionsBatch — zod-rejected", () => {
  it("a malformed payload (negative qty in popLine) → ok:false, nothing written", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-ZOD", "pop-dealer-kit");

    const state = await saveExecutionsBatch(null, {
      activity: "pop-dealer-kit",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          popLines: [
            { itemName: "Bad item", qty: -1, rate: 100, lineTotal: -100 }, // negative qty
          ],
        }),
      ],
    });

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toBeTruthy();

    // Nothing should have been written.
    const count = await executionCount(planRowId);
    expect(count).toBe(0);
  });

  it("a non-integer version → ok:false, nothing written", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-ZOD2");

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        {
          rowKey: "bad",
          planRowId,
          executionId: null,
          version: 1.5, // non-integer
          fields: {},
          isPlaceholder: false,
        },
      ],
    });

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toBeTruthy();
    expect(await executionCount(planRowId)).toBe(0);
  });

  it("units array over max cap (2001 items) → ok:false", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-CAP");

    const oversizedUnits = Array.from({ length: 2001 }, (_, i) =>
      makeUnitPatch(planRowId, { rowKey: `r-${i}` }),
    );

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: oversizedUnits,
    });

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toMatch(/2000/);
  });

  it("negative planRowId → ok:false", async () => {
    const { periodId } = await seedPlanRow();

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        { rowKey: "x", planRowId: -1, executionId: null, version: 0, fields: {}, isPlaceholder: false },
      ],
    });

    expect(state.ok).toBe(false);
  });
});

describe("saveExecutionsBatch — auth-rejected", () => {
  it("verifySession returns false → throws Unauthorized, nothing written", async () => {
    const { periodId, planRowId } = await seedPlanRow();

    verifySessionMock.mockImplementationOnce(async () => false);

    await expect(
      saveExecutionsBatch(null, {
        activity: "counter-wall",
        periodId,
        units: [
          makeUnitPatch(planRowId, {
            fields: { status: "Done" },
          }),
        ],
      }),
    ).rejects.toThrow(/Unauthorized/);

    // Nothing should have been written.
    expect(await executionCount(planRowId)).toBe(0);
  });
});

describe("saveExecutionsBatch — pop-kit", () => {
  it("a POP batch with 2 line items writes 1 execution + 2 execution_items; itemName snapshotted", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-POP", "pop-dealer-kit");

    const state = await saveExecutionsBatch(null, {
      activity: "pop-dealer-kit",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "pop-1",
          executionId: null,
          version: 0,
          fields: {},
          isPlaceholder: false,
          popLines: [
            { itemName: "Standee A4", qty: 5, rate: 50, lineTotal: 250 },
            { itemName: "Banner 3x2", qty: 2, rate: 750, lineTotal: 1500 },
          ],
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.savedIds).toHaveLength(1);
    expect(state.conflicts).toHaveLength(0);

    const kitId = state.savedIds[0]!.id;

    // 1 execution row created.
    const count = await executionCount(planRowId);
    expect(count).toBe(1);

    // 2 execution_items created.
    const itemCount = await executionItemCount(kitId);
    expect(itemCount).toBe(2);

    // Verify itemName snapshot (not an FK — stored as text).
    const raw = await db.execute(
      sql`select item_name, qty, rate, line_total from execution_items where execution_id = ${kitId} order by id`,
    );
    const items = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ item_name: string; qty: string; rate: string; line_total: string }>;
    expect(items[0]?.item_name).toBe("Standee A4");
    expect(Number(items[0]?.qty)).toBe(5);
    expect(Number(items[0]?.rate)).toBe(50);
    expect(Number(items[0]?.line_total)).toBe(250);
    expect(items[1]?.item_name).toBe("Banner 3x2");
    expect(Number(items[1]?.line_total)).toBe(1500);
  });

  it("a second savePopKit call on the same kit replaces prior items (replace-all)", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-POP2", "pop-dealer-kit");

    // First save: 2 lines.
    const first = await saveExecutionsBatch(null, {
      activity: "pop-dealer-kit",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "pop-a",
          popLines: [
            { itemName: "Item X", qty: 1, rate: 100, lineTotal: 100 },
            { itemName: "Item Y", qty: 2, rate: 200, lineTotal: 400 },
          ],
        }),
      ],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    const kitId = first.savedIds[0]!.id;
    expect(await executionItemCount(kitId)).toBe(2);

    // Second save: replace with 1 line.
    const second = await saveExecutionsBatch(null, {
      activity: "pop-dealer-kit",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          rowKey: "pop-b",
          executionId: kitId,
          version: 0,
          popLines: [
            { itemName: "New Item", qty: 3, rate: 50, lineTotal: 150 },
          ],
        }),
      ],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");

    // Only 1 item now (old 2 items deleted).
    expect(await executionItemCount(kitId)).toBe(1);
    const raw = await db.execute(
      sql`select item_name from execution_items where execution_id = ${kitId}`,
    );
    const items = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ item_name: string }>;
    expect(items[0]?.item_name).toBe("New Item");
  });

  it("off-plan guard: sfid cannot be injected via the unit patch (Zod strips unknown keys)", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-GUARD");

    // Attempt to inject an sfid field — Zod schema does not declare it,
    // so the parsed payload will not contain it.
    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        {
          rowKey: "guard-1",
          planRowId,
          executionId: null,
          version: 0,
          fields: { status: "Done" },
          isPlaceholder: false,
          // Injected sfid — must be silently stripped by Zod
          sfid: "INJECTED-SFID",
        } as unknown,
      ],
    });

    // The save should succeed (sfid is ignored, not rejected with an error).
    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    // Row was saved; sfid was NOT persisted (executions has no sfid column).
    expect(state.savedIds).toHaveLength(1);
    const execId = state.savedIds[0]!.id;
    const raw = await db.execute(
      sql`select * from executions where id = ${execId}`,
    );
    const rows = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
    // executions table has no sfid column — confirm it does not appear in the row.
    expect(Object.keys(rows[0] ?? {})).not.toContain("sfid");
  });
});

describe("saveExecutionsBatch — _findExecutionForTest helper", () => {
  it("_findExecutionForTest returns the execution id and version after an insert", async () => {
    const { periodId, planRowId } = await seedPlanRow("SF-FIND");

    const state = await saveExecutionsBatch(null, {
      activity: "counter-wall",
      periodId,
      units: [
        makeUnitPatch(planRowId, {
          fields: { status: "Pending" },
        }),
      ],
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    const found = await _findExecutionForTest(planRowId);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(state.savedIds[0]?.id);
    expect(found?.version).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addOffPlanExecution — COMP-04 off-plan-exception backend (Phase 3.1)
// ---------------------------------------------------------------------------

describe("addOffPlanExecution — happy path (exception plan_row + execution, one tx)", () => {
  it("measurement activity (counter-wall): inserts source='exception' plan_row + execution, applies server calc", async () => {
    const periodId = await seedPeriod();

    // No plan_row pre-exists for NEW-CW — this is a genuine off-plan SFID.
    const state = await addOffPlanExecution({
      periodId,
      activity: "counter-wall",
      sfid: "NEW-CW-1",
      dealer: "Off-plan Dealer A",
      region: "West",
      state: "MH",
      exceptionReason: "Vendor executed before plan was uploaded",
      fields: {
        status: "In Progress",
        actualSqft: "10",
        perUnitCost: "100",
        // Client sends a LYING totalCost — server must recompute to 10 × 100 = 1000.
        totalCost: 99999,
      },
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");
    expect(state.planRowId).toBeGreaterThan(0);
    expect(state.executionId).toBeGreaterThan(0);

    // The plan_row was stamped as an exception (audit columns set).
    const meta = await getPlanRowMeta(state.planRowId);
    expect(meta?.source).toBe("exception");
    expect(meta?.created_via).toBe("actuals-exception");
    expect(meta?.exception_reason).toBe("Vendor executed before plan was uploaded");

    // Exactly ONE execution FK'd to the new plan_row.
    expect(await executionCount(state.planRowId)).toBe(1);

    // Server trust-recompute: totalCost = 10 × 100 = 1000 (NOT the lying 99999).
    const execRow = await getExecution(state.executionId);
    expect(execRow?.status).toBe("In Progress");
    expect(Number(execRow?.total_cost)).toBe(1000);

    // Structural off-plan guard: executions row has NO sfid column.
    const raw = await db.execute(
      sql`select * from executions where id = ${state.executionId}`,
    );
    const rows = (
      Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
    ) as Array<Record<string, unknown>>;
    expect(Object.keys(rows[0] ?? {})).not.toContain("sfid");
  });

  it("status-only activity (dealer-certificate): registry-driven fields, exception row + execution committed", async () => {
    const periodId = await seedPeriod();

    const state = await addOffPlanExecution({
      periodId,
      activity: "dealer-certificate",
      sfid: "NEW-DC-1",
      dealer: "Off-plan Dealer B",
      exceptionReason: "Certificate issued off-plan",
      fields: {
        status: "Done",
        cost: "500",
      },
    });

    expect(state.ok).toBe(true);
    if (!state.ok) throw new Error("unreachable");

    const meta = await getPlanRowMeta(state.planRowId);
    expect(meta?.source).toBe("exception");
    expect(await executionCount(state.planRowId)).toBe(1);

    const execRow = await getExecution(state.executionId);
    expect(execRow?.status).toBe("Done");
  });
});

describe("addOffPlanExecution — dupe-SFID 23505 (clean {ok:false}, rolls back FIRST insert)", () => {
  it("an exception on an SFID already in the plan returns the dupe message; nothing persists", async () => {
    const periodId = await seedPeriod();

    // Seed an EXISTING plan-uploaded row for SFID 'DUP-1'.
    await db.execute(
      sql`insert into plan_rows (period_id, activity, sfid, fields, source)
          values (${periodId}, 'counter-wall', 'DUP-1', '{}', 'plan-upload')`,
    );
    const planRowsBefore = await planRowCount(periodId, "counter-wall");
    expect(planRowsBefore).toBe(1);

    // File an exception for the SAME (period, activity, sfid) → 23505 on the plan_row insert.
    const state = await addOffPlanExecution({
      periodId,
      activity: "counter-wall",
      sfid: "DUP-1",
      dealer: "Dealer dup",
      exceptionReason: "Should be rejected as a duplicate",
      fields: { status: "In Progress" },
    });

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toMatch(/already exists/i);
    expect(state.error).toMatch(/add unit/i);

    // The tx rolled back on the FIRST insert: no new plan_row, no execution anywhere.
    expect(await planRowCount(periodId, "counter-wall")).toBe(1);
    const execRaw = await db.execute(sql`select count(*)::int as n from executions`);
    const execRows = (
      Array.isArray(execRaw) ? execRaw : ((execRaw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(execRows[0]?.n ?? -1)).toBe(0);
  });
});

describe("addOffPlanExecution — tx atomicity via forced EXECUTION-insert failure (SECOND insert)", () => {
  it("a fresh non-dupe SFID whose execution insert throws rolls back the plan_row insert too", async () => {
    const periodId = await seedPeriod();

    // Force the SECOND insert (the execution) to fail on a FRESH, non-duplicate SFID —
    // so the plan_row insert (FIRST) would succeed on its own. This proves atomicity for
    // the execution leg, distinct from the dupe-SFID case which fails on the FIRST insert.
    const spy = vi
      .spyOn(executionsDb, "insertExecution")
      .mockRejectedValueOnce(new Error("forced execution insert failure"));

    try {
      await expect(
        addOffPlanExecution({
          periodId,
          activity: "counter-wall",
          sfid: "FRESH-ATOMIC-1", // never seeded → plan_row insert would succeed alone
          dealer: "Dealer atomic",
          exceptionReason: "Atomicity probe",
          fields: { status: "In Progress" },
        }),
      ).rejects.toThrow(/forced execution insert failure/);
    } finally {
      spy.mockRestore();
    }

    // Both-or-neither: the plan_row insert rolled back when the execution insert threw.
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
    const execRaw = await db.execute(sql`select count(*)::int as n from executions`);
    const execRows = (
      Array.isArray(execRaw) ? execRaw : ((execRaw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(execRows[0]?.n ?? -1)).toBe(0);
  });
});

describe("addOffPlanExecution — auth-rejected (boundary before any DB touch)", () => {
  it("verifySession returns false → throws Unauthorized, nothing persists", async () => {
    const periodId = await seedPeriod();

    verifySessionMock.mockImplementationOnce(async () => false);

    await expect(
      addOffPlanExecution({
        periodId,
        activity: "counter-wall",
        sfid: "AUTH-X",
        dealer: "Dealer auth",
        exceptionReason: "Should never run",
        fields: { status: "In Progress" },
      }),
    ).rejects.toThrow(/Unauthorized/);

    // No plan_row, no execution written.
    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
    const execRaw = await db.execute(sql`select count(*)::int as n from executions`);
    const execRows = (
      Array.isArray(execRaw) ? execRaw : ((execRaw as { rows?: unknown[] }).rows ?? [])
    ) as Array<{ n: number }>;
    expect(Number(execRows[0]?.n ?? -1)).toBe(0);
  });

  it("missing reason (empty string) → ok:false with a reason-required message; nothing persists", async () => {
    const periodId = await seedPeriod();

    const state = await addOffPlanExecution({
      periodId,
      activity: "counter-wall",
      sfid: "NO-REASON-1",
      dealer: "Dealer no-reason",
      exceptionReason: "", // empty → Zod min(1) rejects
      fields: { status: "In Progress" },
    });

    expect(state.ok).toBe(false);
    if (state.ok) throw new Error("unreachable");
    expect(state.error).toMatch(/reason/i);

    expect(await planRowCount(periodId, "counter-wall")).toBe(0);
  });
});
