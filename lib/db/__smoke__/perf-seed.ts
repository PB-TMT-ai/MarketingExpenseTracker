/**
 * GRID-09 / D3.1-06 — dev-only performance seed.
 *
 * Inserts ONE period + ~500 plan_rows spread across the six registry activities so the
 * actuals grid can be profiled (Chrome DevTools Performance) on a realistic dataset for the
 * GRID-09 hot-path baseline/after measurement.
 *
 * DEV-ONLY. Mirrors the other lib/db/__smoke__/*.ts scripts: tsx-run, console.log +
 * process.exit(0|1), NEVER imported by app code or the production bundle (threat T-03_1-04).
 *
 * Run with: `npm run perf:seed`
 *   - Seeds against whatever DATABASE_URL resolves to (local PGlite `.pglite/` by default, or
 *     a real Neon/Supabase branch if DATABASE_URL points there — DO NOT run against prod).
 *   - Re-runnable: wipes prior seed rows for the same seed-label period first (FK-safe order).
 *
 * After seeding, set that period active (or open it directly) and visit
 * `/actuals?activity=counter-wall` to profile the edit hot path.
 */
import { sql } from "drizzle-orm";
import { db } from "../index";
import { ensureMigrated } from "../migrate";
import { ACTIVITY_KEYS } from "../../activities/registry";

const SEED_LABEL = "PERF-SEED ~500 rows";
const TARGET_ROWS = 500;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    // eslint-disable-next-line no-console
    console.error(`PERF-SEED FAILED: ${msg}`);
    process.exit(1);
  }
}

function rowsOf<T = Record<string, unknown>>(raw: unknown): T[] {
  return (
    Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] }).rows ?? [])
  ) as T[];
}

async function main() {
  await ensureMigrated();

  // ------------------------------------------------------------------
  // FK-safe teardown of any prior perf-seed: delete executions whose plan_row
  // belongs to a prior perf-seed period, then plan_rows, then the period(s).
  // ------------------------------------------------------------------
  await db.execute(sql`
    delete from executions
     where plan_row_id in (
       select pr.id from plan_rows pr
        join periods p on p.id = pr.period_id
       where p.label = ${SEED_LABEL}
     )`);
  await db.execute(sql`
    delete from plan_rows
     where period_id in (select id from periods where label = ${SEED_LABEL})`);
  await db.execute(sql`delete from periods where label = ${SEED_LABEL}`);

  // ------------------------------------------------------------------
  // One period to hold the seed rows.
  // ------------------------------------------------------------------
  const periodRaw = await db.execute(sql`
    insert into periods (type, label, start_date, end_date)
    values ('month', ${SEED_LABEL}, '2026-06-01', '2026-06-30')
    returning id`);
  const periodId = Number(rowsOf<{ id: number | string }>(periodRaw)[0]?.id);
  assert(periodId > 0, `insert period returned non-positive id: ${periodId}`);

  // ------------------------------------------------------------------
  // ~500 plan_rows spread round-robin across the six activities. Each row carries a
  // realistic who/where context so the filter facets and SFID search have data to chew on.
  // Indian-context filler (region/state/district) so the grid mirrors production shape.
  // ------------------------------------------------------------------
  const regions = ["North", "South", "East", "West", "Central"];
  const states = ["Maharashtra", "Karnataka", "Tamil Nadu", "Gujarat", "Punjab"];
  const districts = ["Pune", "Bengaluru", "Chennai", "Surat", "Ludhiana"];

  for (let i = 0; i < TARGET_ROWS; i++) {
    const activity = ACTIVITY_KEYS[i % ACTIVITY_KEYS.length];
    const sfid = `PERF-${String(i).padStart(4, "0")}`;
    const region = regions[i % regions.length];
    const state = states[i % states.length];
    const district = districts[i % districts.length];
    const dealer = `Dealer ${i}`;
    const distributor = `Distributor ${i % 50}`;
    // perUnitCost lives in plan-side jsonb fields so the derived totalCost has an input to use.
    const fields = JSON.stringify({ perUnitCost: 25 + (i % 10) });

    await db.execute(sql`
      insert into plan_rows
        (period_id, activity, sfid, region, state, district, distributor, dealer, planned_cost, fields, source)
      values
        (${periodId}, ${activity}, ${sfid}, ${region}, ${state}, ${district},
         ${distributor}, ${dealer}, ${(1000 + i).toFixed(2)}, ${fields}::jsonb, 'plan-upload')`);
  }

  // Verify the count landed.
  const countRaw = await db.execute(sql`
    select count(*)::int as n from plan_rows where period_id = ${periodId}`);
  const n = Number(rowsOf<{ n: number }>(countRaw)[0]?.n ?? -1);
  assert(n === TARGET_ROWS, `expected ${TARGET_ROWS} plan_rows, got ${n}`);

  // eslint-disable-next-line no-console
  console.log(
    `PERF-SEED OK: period id=${periodId} ("${SEED_LABEL}") with ${n} plan_rows ` +
      `across ${ACTIVITY_KEYS.length} activities (${ACTIVITY_KEYS.join(", ")}).`,
  );
  // eslint-disable-next-line no-console
  console.log(
    "Next: mark this period active (or open it) and profile /actuals?activity=counter-wall.",
  );
  process.exit(0);
}

void main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    "PERF-SEED FAILED:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
