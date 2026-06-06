/**
 * Tests for the flat row model (lib/actuals/rows.ts).
 *
 * Covers:
 *   - buildRowModel: placeholder rule (D3-02), execution merging, plan context propagation
 *   - cloneUnitForAdd: plan ctx preserved, empty fields, new rowKey (D3-03)
 * No DB, no mocks — pure unit tests.
 */
import { describe, it, expect } from "vitest";
import { buildRowModel, cloneUnitForAdd } from "./rows";
import type { PlanRowRecord } from "../db/plan-rows";
import type { ExecutionRecord } from "./rows";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePlanRow(id: number, sfid: string): PlanRowRecord {
  return {
    id,
    periodId: 1,
    activity: "in-shop",
    sfid,
    region: "West",
    state: "MH",
    district: "Pune",
    taluka: "Haveli",
    distributor: "Dist-1",
    dealer: "Dealer-A",
    plannedCost: "50000",
    fields: { pinCode: "411001" },
  };
}

function makeExecution(
  id: number,
  planRowId: number,
  overrides: Partial<ExecutionRecord> = {},
): ExecutionRecord {
  return {
    id,
    planRowId,
    status: "Pending",
    unitNo: `unit-${id}`,
    perUnitCost: "100",
    totalCost: "1200",
    totalSqft: "12",
    fields: { length: "4", breadth: "3" },
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildRowModel
// ---------------------------------------------------------------------------

describe("buildRowModel — zero executions → placeholder rows", () => {
  it("3 plan rows, 0 executions → 3 placeholder rows", () => {
    const planRows = [makePlanRow(1, "SF-1"), makePlanRow(2, "SF-2"), makePlanRow(3, "SF-3")];
    const rows = buildRowModel(planRows, []);
    expect(rows).toHaveLength(3);
    rows.forEach((r) => {
      expect(r.isPlaceholder).toBe(true);
      expect(r.executionId).toBeNull();
      expect(r.version).toBe(0);
      expect(r.dirty).toBe(false);
    });
  });

  it("placeholder row carries planRowId from its plan row", () => {
    const rows = buildRowModel([makePlanRow(42, "SF-42")], []);
    expect(rows[0].planRowId).toBe(42);
  });

  it("placeholder row has empty fields", () => {
    const rows = buildRowModel([makePlanRow(1, "SF-1")], []);
    const { __overrides, ...fieldsWithoutOverrides } = rows[0].fields as Record<string, unknown>;
    void __overrides; // may or may not be present
    // Only non-execution fields should be present; execution numeric fields absent
    expect(rows[0].fields["length"]).toBeUndefined();
  });
});

describe("buildRowModel — executions present → real rows, no extra placeholder", () => {
  it("1 plan row with 2 executions → 2 rows, isPlaceholder:false", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1), makeExecution(11, 1)];
    const rows = buildRowModel([planRow], execs);
    expect(rows).toHaveLength(2);
    rows.forEach((r) => expect(r.isPlaceholder).toBe(false));
  });

  it("each execution row carries executionId and version from the execution", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1, { version: 3 }), makeExecution(11, 1, { version: 7 })];
    const rows = buildRowModel([planRow], execs);
    const ids = rows.map((r) => r.executionId).sort();
    expect(ids).toEqual([10, 11]);
    const versions = rows.map((r) => r.version).sort((a, b) => a - b);
    expect(versions).toEqual([3, 7]);
  });

  it("execution fields (length, breadth) are merged into the row's fields", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1, { fields: { length: "5", breadth: "2" } })];
    const rows = buildRowModel([planRow], execs);
    expect(rows[0].fields["length"]).toBe("5");
    expect(rows[0].fields["breadth"]).toBe("2");
  });

  it("execution stored numeric totals (totalSqft, totalCost, perUnitCost) are merged into fields", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1, { totalSqft: "25", totalCost: "2500", perUnitCost: "100" })];
    const rows = buildRowModel([planRow], execs);
    expect(rows[0].fields["totalSqft"]).toBe("25");
    expect(rows[0].fields["totalCost"]).toBe("2500");
    expect(rows[0].fields["perUnitCost"]).toBe("100");
  });
});

describe("buildRowModel — mixed: dealer A has executions, dealer B has none", () => {
  it("A contributes 1 real row, B contributes 1 placeholder; total 2", () => {
    const planRowA = makePlanRow(1, "SF-A");
    const planRowB = makePlanRow(2, "SF-B");
    const execs = [makeExecution(10, 1)]; // only for A
    const rows = buildRowModel([planRowA, planRowB], execs);
    expect(rows).toHaveLength(2);

    const rowA = rows.find((r) => r.planRowId === 1)!;
    const rowB = rows.find((r) => r.planRowId === 2)!;
    expect(rowA.isPlaceholder).toBe(false);
    expect(rowA.executionId).toBe(10);
    expect(rowB.isPlaceholder).toBe(true);
    expect(rowB.executionId).toBeNull();
  });
});

describe("buildRowModel — plan context (read-only plan cols) on each row", () => {
  it("each row.plan carries region/state/district/distributor/sfid/dealer from PlanRowRecord", () => {
    const planRow = makePlanRow(1, "SF-1");
    const rows = buildRowModel([planRow], []);
    const plan = rows[0].plan;
    expect(plan["region"]).toBe("West");
    expect(plan["state"]).toBe("MH");
    expect(plan["district"]).toBe("Pune");
    expect(plan["distributor"]).toBe("Dist-1");
    expect(plan["sfid"]).toBe("SF-1");
    expect(plan["dealer"]).toBe("Dealer-A");
  });

  it("plan context also includes jsonb fields from the plan row", () => {
    const planRow = makePlanRow(1, "SF-1");
    const rows = buildRowModel([planRow], []);
    // The pinCode from planRow.fields should be surfaced in plan
    expect(rows[0].plan["pinCode"]).toBe("411001");
  });
});

describe("buildRowModel — rowKey stability", () => {
  it("execution rows have rowKey in e:{id} form", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(99, 1)];
    const rows = buildRowModel([planRow], execs);
    expect(rows[0].rowKey).toBe("e:99");
  });

  it("placeholder rows have rowKey starting with 'new:'", () => {
    const rows = buildRowModel([makePlanRow(1, "SF-1")], []);
    expect(rows[0].rowKey).toMatch(/^new:/);
  });

  it("multiple placeholder rowKeys are unique", () => {
    const planRows = [makePlanRow(1, "SF-1"), makePlanRow(2, "SF-2")];
    const rows = buildRowModel(planRows, []);
    const keys = rows.map((r) => r.rowKey);
    expect(new Set(keys).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// cloneUnitForAdd
// ---------------------------------------------------------------------------

describe("cloneUnitForAdd — D3-03 add-unit clone", () => {
  it("cloned row has same planRowId as the source row", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1)];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(clone.planRowId).toBe(1);
  });

  it("cloned row has same plan context as the source row", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1)];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(clone.plan).toEqual(sourceRow.plan);
  });

  it("cloned row has executionId:null and version:0 (new unit)", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1)];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(clone.executionId).toBeNull();
    expect(clone.version).toBe(0);
  });

  it("cloned row has empty fields (not copying existing execution data)", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1, { fields: { length: "5" } })];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(Object.keys(clone.fields).filter((k) => k !== "__overrides")).toHaveLength(0);
  });

  it("cloned row has isPlaceholder:false (ready to be filled)", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1)];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(clone.isPlaceholder).toBe(false);
  });

  it("cloned row has a fresh unique rowKey different from source", () => {
    const planRow = makePlanRow(1, "SF-1");
    const execs = [makeExecution(10, 1)];
    const [sourceRow] = buildRowModel([planRow], execs);
    const clone = cloneUnitForAdd(sourceRow);
    expect(clone.rowKey).not.toBe(sourceRow.rowKey);
    expect(clone.rowKey).toMatch(/^new:/);
  });

  it("clone from a placeholder works too (same plan context, new rowKey)", () => {
    const planRow = makePlanRow(1, "SF-1");
    const [placeholder] = buildRowModel([planRow], []);
    const clone = cloneUnitForAdd(placeholder);
    expect(clone.planRowId).toBe(1);
    expect(clone.plan).toEqual(placeholder.plan);
    expect(clone.rowKey).not.toBe(placeholder.rowKey);
  });
});
