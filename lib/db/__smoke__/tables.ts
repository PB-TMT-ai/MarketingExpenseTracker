/**
 * Live-DB proof for Plan 01-02.
 *
 * Run with: `npm run db:migrate:local && npx tsx lib/db/__smoke__/tables.ts`
 *
 * Build/type checks pass from the schema definition ALONE, so they cannot prove the tables
 * physically exist. This script migrates, then selects from each of the five tables against
 * the RUNNING PGlite DB — a missing table throws "relation does not exist". Exits 0 only if
 * all five succeed.
 */
import { sql } from "drizzle-orm";
import { ensureMigrated } from "../migrate";
import { db } from "../index";

const TABLES = [
  "periods",
  "plan_rows",
  "executions",
  "execution_items",
  "item_master",
] as const;

async function main() {
  await ensureMigrated();
  for (const table of TABLES) {
    // `sql.raw` is safe here: TABLES is a fixed const list, never user input.
    await db.execute(sql.raw(`select 1 from ${table} limit 1`));
    // eslint-disable-next-line no-console
    console.log(`  ✓ ${table}`);
  }
  // eslint-disable-next-line no-console
  console.log("ALL FIVE TABLES EXIST in the live PGlite DB.");
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("SMOKE FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
