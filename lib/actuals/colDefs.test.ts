/**
 * Tests for the registry→ColDef mapper (lib/actuals/colDefs.ts).
 *
 * Covers:
 *   - plan columns → editable:false
 *   - actual columns → editable:true with correct cellEditor per FieldKind
 *   - status/enum FieldDef with enumValues → cellEditorParams.values
 *   - derived actual columns → editable:true (overridable) + valueGetter
 *   - ACTV-03: synthetic 7th activity maps through with no code change
 * No DB, no React — pure unit tests (ColDef is imported as type only).
 */
import { describe, it, expect } from "vitest";
import { buildColumnDefs } from "./colDefs";
import type { ActivityConfig, FieldDef } from "../activities/types";
import { getActivity } from "../activities/registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findColByKey(cols: ReturnType<typeof buildColumnDefs>, key: string) {
  return cols.find(
    (c) =>
      c.field === `plan.${key}` ||
      c.field === `fields.${key}` ||
      // derived cols may use colId instead of field
      (c as { colId?: string }).colId === key,
  );
}

// ---------------------------------------------------------------------------
// Plan columns
// ---------------------------------------------------------------------------

describe("buildColumnDefs — plan columns", () => {
  it("plan columns have editable:false", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const planCols = cols.filter((c) => c.field?.startsWith("plan."));
    expect(planCols.length).toBeGreaterThan(0);
    planCols.forEach((c) => {
      expect(c.editable).toBe(false);
    });
  });

  it("plan columns use dotted field path plan.<key>", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const sfidCol = cols.find((c) => c.field === "plan.sfid");
    expect(sfidCol).toBeDefined();
  });

  it("plan columns have a muted cellClass (ag-cell-plan)", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const planCols = cols.filter((c) => c.field?.startsWith("plan."));
    planCols.forEach((c) => {
      expect(c.cellClass).toBe("ag-cell-plan");
    });
  });
});

// ---------------------------------------------------------------------------
// Actual columns — cellEditor per FieldKind
// ---------------------------------------------------------------------------

describe("buildColumnDefs — actual columns cellEditor mapping", () => {
  it("text kind → agTextCellEditor", () => {
    // gsb has gsbType which is text kind
    const cfg = getActivity("gsb")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.gsbType");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agTextCellEditor");
    expect(col?.editable).toBe(true);
  });

  it("number kind → agNumberCellEditor", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.length");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agNumberCellEditor");
    expect(col?.editable).toBe(true);
  });

  it("currency kind → agNumberCellEditor (₹ via formatter, not special editor)", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.perUnitCost");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agNumberCellEditor");
  });

  it("date kind → agDateStringCellEditor", () => {
    const cfg = getActivity("counter-wall")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.executionDate");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agDateStringCellEditor");
  });

  it("lat kind → agTextCellEditor (never numeric-coerced)", () => {
    const cfg = getActivity("counter-wall")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.latitude");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agTextCellEditor");
  });

  it("long kind → agTextCellEditor (never numeric-coerced)", () => {
    const cfg = getActivity("counter-wall")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.longitude");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agTextCellEditor");
  });

  it("status kind → agSelectCellEditor", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.status");
    expect(col).toBeDefined();
    expect(col?.cellEditor).toBe("agSelectCellEditor");
  });

  it("status FieldDef with enumValues → cellEditorParams.values equals those enumValues", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const col = cols.find((c) => c.field === "fields.status");
    expect(col?.cellEditorParams).toEqual({ values: ["Pending", "In Progress", "Done"] });
  });
});

// ---------------------------------------------------------------------------
// Derived actual columns
// ---------------------------------------------------------------------------

describe("buildColumnDefs — derived actual columns (computeFrom present)", () => {
  it("derived column is editable:true (overridable, D3-05)", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    // totalSqft has computeFrom, so it's derived
    const totalSqftCol = cols.find(
      (c) => c.field === "fields.totalSqft" || (c as { colId?: string }).colId === "totalSqft",
    );
    expect(totalSqftCol).toBeDefined();
    expect(totalSqftCol?.editable).toBe(true);
  });

  it("derived column carries a valueGetter function", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const totalSqftCol = cols.find(
      (c) => c.field === "fields.totalSqft" || (c as { colId?: string }).colId === "totalSqft",
    );
    expect(typeof totalSqftCol?.valueGetter).toBe("function");
  });

  it("valueGetter returns computeDerived result when NOT overridden", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const totalSqftCol = cols.find(
      (c) => c.field === "fields.totalSqft" || (c as { colId?: string }).colId === "totalSqft",
    );
    const getter = totalSqftCol?.valueGetter as ((p: { data: unknown }) => unknown) | undefined;
    expect(getter).toBeDefined();
    const fakeRow = {
      plan: {},
      fields: { length: "4", breadth: "3" },
    };
    const result = getter!({ data: fakeRow });
    expect(result).toBe(12); // L × B, no override
  });

  it("valueGetter returns stored value when overridden (override short-circuit — D3-05)", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const totalSqftCol = cols.find(
      (c) => c.field === "fields.totalSqft" || (c as { colId?: string }).colId === "totalSqft",
    );
    const getter = totalSqftCol?.valueGetter as ((p: { data: unknown }) => unknown) | undefined;
    const fakeRow = {
      plan: {},
      fields: {
        length: "4",
        breadth: "3",
        totalSqft: "999", // manually overridden value
        __overrides: { totalSqft: true },
      },
    };
    const result = getter!({ data: fakeRow });
    expect(result).toBe("999"); // returns stored override, not 12
  });

  it("totalCost is also derived (computeFrom present)", () => {
    const cfg = getActivity("in-shop")!;
    const cols = buildColumnDefs(cfg);
    const totalCostCol = cols.find(
      (c) => c.field === "fields.totalCost" || (c as { colId?: string }).colId === "totalCost",
    );
    expect(totalCostCol).toBeDefined();
    expect(typeof totalCostCol?.valueGetter).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// ACTV-03: synthetic 7th activity maps through with no code change
// ---------------------------------------------------------------------------

describe("buildColumnDefs — ACTV-03 extensibility (synthetic 7th activity)", () => {
  const syntheticConfig: ActivityConfig = {
    key: "counter-wall", // reuse a valid key; type check only cares about structure
    label: "Test Activity",
    type: "measurement",
    planColumns: [
      { key: "region", label: "Region", kind: "text", shared: true },
      { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
    ] as const,
    actualColumns: [
      { key: "status", label: "Status", kind: "status", enumValues: ["Yes", "No"] },
      { key: "qty", label: "Qty", kind: "number" },
      {
        key: "rate",
        label: "Rate",
        kind: "currency",
      },
      {
        key: "lineTotal",
        label: "Total",
        kind: "currency",
        computeFrom: ["qty", "rate"],
      },
    ] as const,
  };

  it("maps 2 plan cols + 4 actual cols → 6 total ColDefs", () => {
    const cols = buildColumnDefs(syntheticConfig);
    expect(cols).toHaveLength(6);
  });

  it("status with custom enumValues → cellEditorParams.values = [Yes, No]", () => {
    const cols = buildColumnDefs(syntheticConfig);
    const statusCol = cols.find((c) => c.field === "fields.status");
    expect(statusCol?.cellEditorParams).toEqual({ values: ["Yes", "No"] });
  });

  it("derived lineTotal column has valueGetter", () => {
    const cols = buildColumnDefs(syntheticConfig);
    const lineTotalCol = cols.find(
      (c) => c.field === "fields.lineTotal" || (c as { colId?: string }).colId === "lineTotal",
    );
    expect(typeof lineTotalCol?.valueGetter).toBe("function");
  });
});
