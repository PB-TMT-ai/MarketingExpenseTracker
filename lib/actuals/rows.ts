/**
 * Flat row model for the actuals grid.
 *
 * PURE module — imports types only from ../activities/types and ../db/plan-rows.
 * No React, no Drizzle runtime, no Next.js — unit-testable without any DB.
 *
 * Responsibilities:
 *   - UnitRow: the single row type the AG Grid sees (one row per execution unit)
 *   - ExecutionRecord: the shape the page/server passes in after querying executions
 *   - buildRowModel: merges plan rows + executions into a flat list with placeholder rule (D3-02)
 *   - cloneUnitForAdd: clone a row's plan context for a new "+ add unit" row (D3-03)
 *
 * Placeholder rule (D3-02 / Pitfall 5):
 *   - A plan_row with zero executions → exactly ONE placeholder (isPlaceholder:true, executionId:null)
 *   - A plan_row with N executions → exactly N real rows (isPlaceholder:false), NO extra placeholder
 *   - Placeholders are NEVER persisted as empty executions; the save action skips them when pristine
 */

import type { PlanRowRecord } from "../db/plan-rows";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One row in the flat actuals grid. Represents one execution unit.
 *
 * AG Grid binds:
 *   - read-only plan columns via `plan.*` dotted paths (A1 confirmed in 03-01 spike)
 *   - editable actual columns via `fields.*` dotted paths
 *   - getRowId returns rowKey for stable identity
 */
export type UnitRow = {
  /** Stable client ID for AG Grid getRowId: `e:{executionId}` or `new:{n}` */
  rowKey: string;
  /** FK target — always set (structural off-plan guard) */
  planRowId: number;
  /** null = placeholder / new unit (INSERT path, version 0) */
  executionId: number | null;
  /** 0 for new; server-provided value for existing (D3-11 optimistic concurrency) */
  version: number;
  /** Read-only plan context repeated on each unit row (AG Grid binds via plan.*) */
  plan: Record<string, unknown>;
  /** Editable actuals + derived values + per-field override flags (AG Grid binds via fields.*) */
  fields: Record<string, unknown>;
  /** true until first edit; never persisted while empty (D3-02) */
  isPlaceholder: boolean;
  /** true when any field has been edited since last save */
  dirty: boolean;
  /**
   * POP/Dealer-Kit line items (item-list activities ONLY; undefined otherwise).
   * Populated from execution_items on load (so re-opening a saved kit shows its lines)
   * and rewritten by the POP modal. Sent in the save patch so the server's savePopKit
   * persists one execution + N execution_items (D3-13/14).
   */
  popLines?: PopLineInput[];
};

/** One POP/Dealer-Kit line item carried on a kit UnitRow (numbers, not Drizzle strings). */
export type PopLineInput = {
  itemName: string;
  qty: number;
  rate: number;
  lineTotal: number;
};

/**
 * The execution row shape the page passes into buildRowModel after querying the DB.
 * Mirrors the columns in lib/db/schema.ts `executions` table.
 * Numeric columns arrive as string | null (Drizzle numeric-as-string discipline).
 */
export type ExecutionRecord = {
  id: number;
  planRowId: number;
  status: string | null;
  unitNo: string | null;
  perUnitCost: string | null;
  totalCost: string | null;
  totalSqft: string | null;
  /** Activity-specific measurement fields (jsonb) */
  fields: Record<string, unknown>;
  version: number;
};

// ---------------------------------------------------------------------------
// Internal counter for generating unique new: rowKeys
// ---------------------------------------------------------------------------

let _newCounter = 0;

function nextNewKey(): string {
  _newCounter += 1;
  return `new:${_newCounter}`;
}

// ---------------------------------------------------------------------------
// buildRowModel
// ---------------------------------------------------------------------------

/**
 * Build the flat row model from plan rows and their executions.
 *
 * For each plan row:
 *   - If it has executions → one UnitRow per execution (isPlaceholder:false)
 *   - If it has no executions → exactly one placeholder UnitRow (isPlaceholder:true)
 *
 * Each row's `plan` object contains the repeated read-only plan context:
 *   region, state, district, taluka, distributor, dealer, sfid, plannedCost,
 *   plus any jsonb fields from PlanRowRecord.fields.
 *
 * Each execution row's `fields` is the merged execution: jsonb fields + stored numeric totals
 *   (totalSqft, totalCost, perUnitCost) so the grid sees a single flat field map.
 */
export function buildRowModel(
  planRows: PlanRowRecord[],
  executions: ExecutionRecord[],
): UnitRow[] {
  // Group executions by planRowId for O(n) lookup
  const execsByPlanRow = new Map<number, ExecutionRecord[]>();
  for (const exec of executions) {
    const list = execsByPlanRow.get(exec.planRowId) ?? [];
    list.push(exec);
    execsByPlanRow.set(exec.planRowId, list);
  }

  const rows: UnitRow[] = [];

  for (const pr of planRows) {
    // Build the shared read-only plan context for this plan row
    const planContext: Record<string, unknown> = {
      sfid: pr.sfid,
      region: pr.region,
      state: pr.state,
      district: pr.district,
      taluka: pr.taluka,
      distributor: pr.distributor,
      dealer: pr.dealer,
      plannedCost: pr.plannedCost,
      // Spread jsonb plan fields (activity-specific plan columns like pinCode, planSqft, etc.)
      ...pr.fields,
    };

    const prExecs = execsByPlanRow.get(pr.id) ?? [];

    if (prExecs.length === 0) {
      // No executions → one placeholder row (D3-02)
      rows.push({
        rowKey: nextNewKey(),
        planRowId: pr.id,
        executionId: null,
        version: 0,
        plan: planContext,
        fields: {},
        isPlaceholder: true,
        dirty: false,
      });
    } else {
      // N executions → N real rows, no placeholder (Pitfall 5)
      for (const exec of prExecs) {
        // Merge execution fields: jsonb fields + stored numeric totals
        const mergedFields: Record<string, unknown> = {
          ...exec.fields,
        };
        // Stored numeric columns from the executions table (as strings per Drizzle discipline)
        if (exec.totalSqft != null) mergedFields["totalSqft"] = exec.totalSqft;
        if (exec.totalCost != null) mergedFields["totalCost"] = exec.totalCost;
        if (exec.perUnitCost != null) mergedFields["perUnitCost"] = exec.perUnitCost;
        if (exec.status != null) mergedFields["status"] = exec.status;
        if (exec.unitNo != null) mergedFields["unitNo"] = exec.unitNo;

        rows.push({
          rowKey: `e:${exec.id}`,
          planRowId: pr.id,
          executionId: exec.id,
          version: exec.version,
          plan: planContext,
          fields: mergedFields,
          isPlaceholder: false,
          dirty: false,
        });
      }
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// cloneUnitForAdd
// ---------------------------------------------------------------------------

/**
 * Clone a row's plan context into a new "+ add unit" row (D3-03).
 *
 * The clone:
 *   - carries the SAME planRowId and plan context (dealer, region, sfid, etc.)
 *   - has executionId:null and version:0 (new INSERT path)
 *   - has EMPTY fields (user starts fresh for the new unit)
 *   - has isPlaceholder:false (it's an intentional new unit, not an auto-filler)
 *   - has a fresh unique rowKey (new:N) so AG Grid tracks it independently
 */
export function cloneUnitForAdd(row: UnitRow): UnitRow {
  return {
    rowKey: nextNewKey(),
    planRowId: row.planRowId,
    executionId: null,
    version: 0,
    plan: row.plan, // same plan context (read-only reference is fine — plan is never mutated)
    fields: {},
    isPlaceholder: false,
    dirty: false,
  };
}
