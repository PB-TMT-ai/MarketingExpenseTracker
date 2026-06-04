import {
  pgTable,
  pgEnum,
  bigserial,
  bigint,
  text,
  date,
  boolean,
  timestamp,
  numeric,
  integer,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

/**
 * Period-scoped schema with the OFF-PLAN GUARD baked in as a database invariant (COMP-01).
 *
 * The guard is structural, not app logic:
 *   - `executions` has NO `sfid` column — the only way to record spend is via a NOT NULL
 *     FK to a real `plan_rows` row, so an actual can never attach to an SFID that has no
 *     plan row for that activity + period.
 *   - `plan_rows` has a composite UNIQUE (period_id, activity, sfid) match key.
 *   - The FK is `ON DELETE RESTRICT` (never CASCADE) so a plan row with actuals cannot be
 *     silently deleted (sets up Phase 2 non-destructive re-upload).
 * Money/measure columns are numeric(14,2) — never float, never Postgres generated columns
 * (totals are computed app-side and persisted as plain numerics; D-05).
 */

export const periodType = pgEnum("period_type", ["month", "quarter", "fy"]);

export const periods = pgTable("periods", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  type: periodType("type").notNull(),
  label: text("label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  // Exactly one active period is enforced app-side (D-11).
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planRows = pgTable(
  "plan_rows",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    periodId: bigint("period_id", { mode: "number" })
      .notNull()
      .references(() => periods.id), // PRD-02 period scoping
    activity: text("activity").notNull(), // registry discriminator
    sfid: text("sfid").notNull(), // ALWAYS text (PITFALLS: never coerce IDs to number)
    // Shared who/where columns kept as real, indexed columns for fast filter dropdowns.
    region: text("region"),
    state: text("state"),
    district: text("district"),
    taluka: text("taluka"),
    distributor: text("distributor"),
    dealer: text("dealer"),
    plannedCost: numeric("planned_cost", { precision: 14, scale: 2 }), // budget (D-05)
    fields: jsonb("fields").notNull().default({}), // plan-side activity extras
  },
  (t) => [
    unique("plan_rows_match_key").on(t.periodId, t.activity, t.sfid), // D-02 match key
    index("plan_rows_filter_idx").on(
      t.periodId,
      t.activity,
      t.region,
      t.state,
      t.district,
    ),
  ],
);

export const executions = pgTable(
  "executions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    // THE GUARD (D-01/D-03): NOT NULL FK, ON DELETE RESTRICT. No sfid column by design —
    // an sfid here would reopen the off-plan bypass.
    planRowId: bigint("plan_row_id", { mode: "number" })
      .notNull()
      .references(() => planRows.id, { onDelete: "restrict" }),
    status: text("status"),
    unitNo: text("unit_no"), // per-unit identity, e.g. Wall/Shop No (D-03)
    perUnitCost: numeric("per_unit_cost", { precision: 14, scale: 2 }),
    totalCost: numeric("total_cost", { precision: 14, scale: 2 }),
    totalSqft: numeric("total_sqft", { precision: 14, scale: 2 }),
    fields: jsonb("fields").notNull().default({}), // measurements / lat-long
    version: integer("version").notNull().default(0), // D-04 per-unit optimistic concurrency
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("executions_plan_row_idx").on(t.planRowId)],
);

export const executionItems = pgTable("execution_items", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  executionId: bigint("execution_id", { mode: "number" })
    .notNull()
    .references(() => executions.id, { onDelete: "restrict" }),
  itemName: text("item_name").notNull(), // SNAPSHOT at entry (D-08), NOT an FK to item_master
  qty: numeric("qty", { precision: 14, scale: 2 }).notNull(),
  rate: numeric("rate", { precision: 14, scale: 2 }).notNull(), // rate fresh per line (D-07)
  lineTotal: numeric("line_total", { precision: 14, scale: 2 }).notNull(), // computed app-side
});

export const itemMaster = pgTable("item_master", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  name: text("name").notNull(),
  category: text("category"), // optional grouping (D-06)
  active: boolean("active").notNull().default(true), // retire without hard delete (D-09)
});
