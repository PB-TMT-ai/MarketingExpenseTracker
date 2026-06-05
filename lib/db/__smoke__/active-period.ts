/**
 * Live-DB proof of D-11 — the "exactly one active period" invariant.
 *
 * Build/type checks pass from the function signatures alone, so they cannot prove the
 * runtime row-count invariant. This script migrates, inserts two periods, toggles active
 * to each in turn, then runs a raw COUNT against PGlite to prove only one row carries
 * is_active=true AND it's the second period (last-write-wins).
 *
 * Run with: `npm run periods:smoke`
 */
import { sql } from "drizzle-orm";
import { db } from "../index";
import { ensureMigrated } from "../migrate";
import {
  _resetPeriodsForTest,
  getActivePeriodRow,
  insertPeriod,
  setActiveTx,
} from "../periods";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
}

async function activeCount(): Promise<number> {
  const raw = await db.execute(
    sql`select count(*)::int as n from periods where is_active = true`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

async function main() {
  await ensureMigrated();
  // Start from a known empty state so the count assertion is unambiguous.
  await _resetPeriodsForTest();

  const id1 = await insertPeriod({
    type: "month",
    label: "P1 (smoke)",
    startDate: "2026-08-01",
    endDate: "2026-08-31",
  });
  const id2 = await insertPeriod({
    type: "month",
    label: "P2 (smoke)",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
  });
  assert(id1 !== id2, "insertPeriod must return distinct ids");

  await setActiveTx(id1);
  assert(
    (await activeCount()) === 1,
    `after first setActiveTx, expected count(is_active)=1, got ${await activeCount()}`,
  );

  await setActiveTx(id2);
  const after = await activeCount();
  assert(
    after === 1,
    `D-11 VIOLATED: after two setActiveTx calls, expected count(is_active)=1, got ${after}`,
  );

  const active = await getActivePeriodRow();
  assert(
    active?.id === id2,
    `last-write-wins violated: expected active id=${id2}, got ${active?.id}`,
  );

  // eslint-disable-next-line no-console
  console.log(
    `D-11 PROVEN: exactly one active period (id=${id2}) after two distinct setActiveTx calls. Tx invariant holds against live PGlite.`,
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("SMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
