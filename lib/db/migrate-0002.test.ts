import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * Migration 0002 backfill spec (GRID-10 / D3.1-07).
 *
 * Proves the forward-only, idempotent status backfill carried by
 * drizzle/0002_funny_winter_soldier.sql:
 *   UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL;
 *
 * Live PGlite via the shared `db` instance. vitest.config.ts sets DATABASE_URL=memory://
 * so this never collides with the dev server's ./.pglite directory.
 *
 * This is a PURE migration/data test — it touches NO Server Action, so the three vi.mock
 * blocks (next/headers, next/cache, ../auth/session) used by executions.test.ts are omitted.
 *
 * `ensureMigrated()` in beforeAll applies ALL journaled migrations (incl. 0002) to the
 * in-memory DB — so 0002's backfill already ran once against the empty fixtures (touching
 * 0 rows). Tests 1-3 therefore seed NULLs AFTER migration then run the SAME statement to
 * prove the semantics deterministically; Test 4 proves the journaled migration file is the
 * one carrying that statement (ship-wiring).
 */

import { sql } from "drizzle-orm";
import { db } from "./index";
import { ensureMigrated } from "./migrate";
import {
  _resetExecutionsForTest,
  _resetPlanRowsForTest,
  _findPlanRowIdForTest,
} from "./plan-rows";
import { _resetExecutionItemsForTest } from "./executions";
import { _resetPeriodsForTest, insertPeriod } from "./periods";

// The exact statement that ships in 0002 (D3.1-07). Tests 1-3 run this against the DB;
// Test 4 asserts the journaled .sql file literally contains it after a statement-breakpoint.
const BACKFILL_SQL = `UPDATE "executions" SET "status" = 'In Progress' WHERE "status" IS NULL`;

beforeAll(async () => {
  await ensureMigrated();
});

beforeEach(async () => {
  // FK-safe order (children before parents): execution_items → executions → plan_rows → periods.
  await _resetExecutionItemsForTest();
  await _resetExecutionsForTest();
  await _resetPlanRowsForTest();
  await _resetPeriodsForTest();
});

/** Coerce db.execute output (array OR { rows }) to a plain array of rows. */
function rowsOf<T>(raw: unknown): T[] {
  return (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])) as T[];
}

/** Seed a period + one plan_row, return planRowId. */
async function seedPlanRow(sfid = "MIG-SF-1", activity = "counter-wall"): Promise<number> {
  const periodId = await insertPeriod({
    type: "month",
    label: "Migrate Jul 2026",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  });
  await db.execute(
    sql`insert into plan_rows (period_id, activity, sfid, fields)
        values (${periodId}, ${activity}, ${sfid}, '{}')`,
  );
  const planRowId = await _findPlanRowIdForTest(periodId, activity, sfid);
  if (!planRowId) throw new Error(`seedPlanRow: could not find plan_row for sfid=${sfid}`);
  return planRowId;
}

/** Run the backfill UPDATE; return the affected row count (PGlite exposes `affectedRows`). */
async function runBackfill(): Promise<number> {
  const raw = (await db.execute(sql.raw(BACKFILL_SQL))) as { affectedRows?: number };
  return Number(raw?.affectedRows ?? 0);
}

describe("migration 0002 backfill — NULL status → 'In Progress'", () => {
  it("Test 1: three NULL-status executions all become 'In Progress' after the backfill", async () => {
    const planRowId = await seedPlanRow();
    // Seed 3 executions with status NULL (explicit NULL — no default exists on the column).
    for (let i = 0; i < 3; i++) {
      await db.execute(
        sql`insert into executions (plan_row_id, status, unit_no) values (${planRowId}, NULL, ${`u-${i}`})`,
      );
    }

    // Pre-condition: 3 rows with NULL status.
    const before = rowsOf<{ n: number }>(
      await db.execute(
        sql`select count(*)::int as n from executions where plan_row_id = ${planRowId} and status is null`,
      ),
    );
    expect(Number(before[0]?.n)).toBe(3);

    const affected = await runBackfill();
    expect(affected).toBe(3);

    // Post-condition: 0 NULL, 3 'In Progress'.
    const after = rowsOf<{ status: string | null }>(
      await db.execute(
        sql`select status from executions where plan_row_id = ${planRowId}`,
      ),
    );
    expect(after).toHaveLength(3);
    after.forEach((r) => expect(r.status).toBe("In Progress"));
  });

  it("Test 2: a pre-set non-NULL status (e.g. 'Done') is left untouched", async () => {
    const planRowId = await seedPlanRow("MIG-SF-2");
    await db.execute(
      sql`insert into executions (plan_row_id, status, unit_no) values (${planRowId}, 'Done', 'done-1')`,
    );
    await db.execute(
      sql`insert into executions (plan_row_id, status, unit_no) values (${planRowId}, NULL, 'null-1')`,
    );

    const affected = await runBackfill();
    expect(affected).toBe(1); // only the NULL row is touched

    const done = rowsOf<{ status: string | null }>(
      await db.execute(sql`select status from executions where unit_no = 'done-1'`),
    );
    expect(done[0]?.status).toBe("Done"); // unchanged

    const wasNull = rowsOf<{ status: string | null }>(
      await db.execute(sql`select status from executions where unit_no = 'null-1'`),
    );
    expect(wasNull[0]?.status).toBe("In Progress");
  });

  it("Test 3: the backfill is idempotent — a second pass affects 0 rows", async () => {
    const planRowId = await seedPlanRow("MIG-SF-3");
    await db.execute(
      sql`insert into executions (plan_row_id, status, unit_no) values (${planRowId}, NULL, 'idem-1')`,
    );

    const first = await runBackfill();
    expect(first).toBe(1);

    // Second pass: WHERE status IS NULL now matches nothing.
    const second = await runBackfill();
    expect(second).toBe(0);

    const after = rowsOf<{ status: string | null }>(
      await db.execute(sql`select status from executions where unit_no = 'idem-1'`),
    );
    expect(after[0]?.status).toBe("In Progress");
  });

  it("Test 4 (ship-wiring): the journaled 0002 .sql carries the backfill after a statement-breakpoint", () => {
    const file = readdirSync("drizzle").find(
      (n) => n.startsWith("0002") && n.endsWith(".sql"),
    );
    expect(file).toBeDefined();
    const contents = readFileSync(`drizzle/${file}`, "utf8");

    // The literal backfill statement (proven semantically in Tests 1-3) actually ships in 0002.
    expect(contents).toContain(BACKFILL_SQL);

    // It is sequenced AFTER a statement-breakpoint (i.e. it is its own statement, not glued
    // onto the trailing DDL) — this is what makes it run as a distinct migration step.
    const breakpointIdx = contents.indexOf("--> statement-breakpoint");
    const backfillIdx = contents.indexOf(BACKFILL_SQL);
    expect(breakpointIdx).toBeGreaterThanOrEqual(0);
    expect(backfillIdx).toBeGreaterThan(breakpointIdx);

    // Sanity: the COMP-04 DDL also ships in the same migration file (one-file atomicity).
    expect(contents).toMatch(/ADD COLUMN\s+"source"/i);
  });
});
