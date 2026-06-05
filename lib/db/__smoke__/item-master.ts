/**
 * Live-DB proof of D-09 — retire is a SOFT toggle; the row survives.
 *
 * The build/type checks can confirm the function signatures don't expose a delete; this
 * proves at runtime that retiring an item leaves the row IN the DB with `active=false`,
 * and that restore flips it back. Critical because POP / dealer-kit line items snapshot
 * item names (D-08) — orphaning a row by a future DELETE would silently break history.
 *
 * Run with: `npm run items:smoke`
 */
import { sql } from "drizzle-orm";
import { db } from "../index";
import { ensureMigrated } from "../migrate";
import {
  _resetItemsForTest,
  insertItem,
  setItemActive,
} from "../items";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`SMOKE FAILED: ${msg}`);
    process.exit(1);
  }
}

async function rowCount(): Promise<number> {
  const raw = await db.execute(sql`select count(*)::int as n from item_master`);
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ n: number }>;
  return Number(rows[0]?.n ?? -1);
}

async function activeOf(id: number): Promise<boolean | null> {
  const raw = await db.execute(
    sql`select active from item_master where id = ${id} limit 1`,
  );
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ active: boolean }>;
  return rows[0]?.active ?? null;
}

async function main() {
  await ensureMigrated();
  await _resetItemsForTest();

  const before = await rowCount();
  const id = await insertItem({ name: "Smoke item (POP)", category: "Smoke" });
  const afterInsert = await rowCount();
  assert(
    afterInsert === before + 1,
    `insertItem should add exactly one row (before=${before}, after=${afterInsert})`,
  );
  assert(
    (await activeOf(id)) === true,
    "newly inserted item must default to active=true",
  );

  // Retire — soft toggle.
  await setItemActive(id, false);
  const afterRetire = await rowCount();
  assert(
    afterRetire === afterInsert,
    `D-09 VIOLATED: row count changed on retire (before=${afterInsert}, after=${afterRetire})`,
  );
  assert(
    (await activeOf(id)) === false,
    "after retire, active must be false",
  );

  // Restore round-trip.
  await setItemActive(id, true);
  assert(
    (await activeOf(id)) === true,
    "after restore, active must be true",
  );
  assert(
    (await rowCount()) === afterInsert,
    "row count must remain unchanged across retire/restore",
  );

  // eslint-disable-next-line no-console
  console.log(
    `D-09 PROVEN: retire is a soft toggle (active=false), restore flips it back (active=true), row count UNCHANGED. No DELETE path against item_master.`,
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("SMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
