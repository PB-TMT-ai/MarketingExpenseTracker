import { sql } from "drizzle-orm";
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
  uniqueIndex,
  index,
  check,
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

export const periods = pgTable(
  "periods",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    type: periodType("type").notNull(),
    label: text("label").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    // D-11: EXACTLY one row may have is_active=true. Enforced structurally by the
    // partial unique index below — concurrent setActiveTx calls cannot both win.
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // Partial unique index on a constant expression, filtered to active rows.
    // Postgres allows at most one row to satisfy `is_active = true` per this index,
    // so the "two active periods" race becomes a DB-level uniqueness violation rather
    // than a silently-wrong row count.
    uniqueIndex("periods_single_active_idx")
      .on(sql`((1))`)
      .where(sql`${t.isActive} = true`),
  ],
);

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
    // COMP-04 (Phase 3.1): off-plan-exception provenance + audit. `source` distinguishes a
    // normally plan-uploaded row from one created via the actuals off-plan-exception affordance.
    // The app (Server Action) is the only writer of 'exception'; plan upload never sets it.
    // No `createdBy` — v1 uses a single shared password, so there is no per-user identity (D3.1-08).
    source: text("source").notNull().default("plan-upload"),
    exceptionReason: text("exception_reason"), // free-text reason on exception rows (NULL for plan-upload)
    createdVia: text("created_via"), // e.g. 'plan-upload' | 'actuals-exception' | 'manual'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
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
    // text + CHECK (NOT pgEnum) — mirrors the `status` precedent (registry enum is the editor
    // source of truth) and keeps adding a future `source` value a one-line CHECK edit, not a
    // Postgres enum migration. COMP-04.
    check("plan_rows_source_check", sql`${t.source} in ('plan-upload', 'exception')`),
  ],
);

/**
 * One entry in `executions.overrides_log` (P1-1 — override audit).
 * Captured server-side at save time whenever a derived field is overridden;
 * the reviewer can later justify a number with `executions.notes`.
 */
export type OverrideLogEntry = {
  field: string;
  fromValue: unknown;
  toValue: unknown;
  at: string; // ISO timestamp from `new Date().toISOString()`
};

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
    // P1-1: free-text justification a reviewer can attach to an execution.
    // Surfaced when any derived field is overridden so the audit trail can
    // answer "why ₹50k → ₹75k?". Nullable; no length cap at the DB.
    notes: text("notes"),
    // P1-1: append-only log of derived-field overrides applied at save time.
    // Each entry: { field, fromValue, toValue, at }. Nullable so unaffected
    // rows stay tidy. The action builds this server-side; the client never
    // writes here directly.
    overridesLog: jsonb("overrides_log").$type<OverrideLogEntry[]>(),
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

/**
 * Adhoc expenses — period-scoped spend NOT tied to a plan-row SFID.
 *
 * Off-plan-guard preservation: there is NO FK to `plan_rows` and NO `sfid` column.
 * The structural off-plan guard on `executions → plan_rows` is untouched; this is a
 * parallel surface for one-off expenses (local events, ad-hoc vendor work).
 *
 * Period scoping is enforced by the periodId FK (mirrors planRows.periodId). Optimistic
 * concurrency via `version` mirrors `executions.version`. `activityDate` is the canonical
 * date — "month of activity" is derived at render time (`format(activityDate, 'MMM yyyy')`),
 * never stored.
 */
export const adhocExpenses = pgTable(
  "adhoc_expenses",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    periodId: bigint("period_id", { mode: "number" })
      .notNull()
      .references(() => periods.id),
    region: text("region"),
    state: text("state"),
    district: text("district"),
    taluka: text("taluka"),
    activity: text("activity"),           // free text with typeahead from the activity registry
    activityDate: date("activity_date"),
    budgetHeader: text("budget_header"),  // free text in v1
    expenseAmount: numeric("expense_amount", { precision: 14, scale: 2 }),  // ex-GST
    vendorName: text("vendor_name"),
    remarks: text("remarks"),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("adhoc_expenses_period_idx").on(t.periodId)],
);
