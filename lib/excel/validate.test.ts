import { describe, it, expect } from "vitest";
import { validateHeaders, buildPreview } from "./validate";
import { coerceCell } from "./parse";
import { ACTIVITIES } from "../activities/registry";
import type { FieldDef } from "../activities/types";

/**
 * Pure-function spec for validate.ts (Plan 02-01 Task 3).
 *
 * validateHeaders proves D2-03's contract (case-insensitive + whitespace-trim,
 * ordered comparison) and the three HeaderError kinds. buildPreview proves the
 * three browser-local classifications (valid / duplicate / fieldError), the
 * shared-vs-jsonb routing, and the Excel-1-indexed rowNumber math.
 */

// A small synthetic activity used by the tests that don't need the real registry.
// (Real-registry coverage comes through the counter-wall test in this same file.)
const SYNTHETIC_COLS: readonly FieldDef[] = [
  { key: "sfid", label: "SFID", kind: "text", shared: true, required: true },
  { key: "region", label: "Region", kind: "text", shared: true },
  { key: "planSqft", label: "Plan Sq Ft", kind: "number" }, // jsonb-routed
];

describe("validateHeaders — D2-03 lenient match", () => {
  it("returns null when headers exactly match planColumns labels in order", () => {
    expect(validateHeaders(["SFID", "Region", "Plan Sq Ft"], SYNTHETIC_COLS)).toBeNull();
  });

  it("returns null when headers differ only by case", () => {
    expect(validateHeaders(["sfid", "REGION", "plan sq ft"], SYNTHETIC_COLS)).toBeNull();
  });

  it("returns null when headers differ only by whitespace", () => {
    expect(
      validateHeaders(["  SFID  ", "Region", "Plan Sq Ft "], SYNTHETIC_COLS),
    ).toBeNull();
  });

  it("returns a 'missing' HeaderError when an expected label is absent", () => {
    const err = validateHeaders(["SFID", "Region"], SYNTHETIC_COLS);
    expect(err).not.toBeNull();
    expect(err!.kind).toBe("missing");
    expect(err!.expected).toEqual(["SFID", "Region", "Plan Sq Ft"]);
    expect(err!.got).toEqual(["SFID", "Region"]);
  });

  it("returns an 'extra' HeaderError when an unexpected label is present", () => {
    const err = validateHeaders(
      ["SFID", "Region", "Plan Sq Ft", "Bogus"],
      SYNTHETIC_COLS,
    );
    expect(err).not.toBeNull();
    expect(err!.kind).toBe("extra");
  });

  it("returns a 'mismatch' HeaderError when order differs but the set matches", () => {
    const err = validateHeaders(["Region", "SFID", "Plan Sq Ft"], SYNTHETIC_COLS);
    expect(err).not.toBeNull();
    expect(err!.kind).toBe("mismatch");
  });

  it("matches the real counter-wall registry headers", () => {
    const cols = ACTIVITIES["counter-wall"].planColumns;
    const headers = cols.map((c) => c.label);
    expect(validateHeaders(headers, cols)).toBeNull();
    // shuffle to provoke mismatch
    const swapped = [...headers];
    [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
    const err = validateHeaders(swapped, cols);
    expect(err?.kind).toBe("mismatch");
  });
});

describe("buildPreview — classification + routing + rowNumber math", () => {
  it("emits valid rows in input order and sets rowNumber = excelRowIndex + 1", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"], // header (index 0)
      ["111", "West", "100"], // data row 0 → rowNumber 2
      ["222", "East", "50"], // data row 1 → rowNumber 3
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    expect(preview.length).toBe(2);
    expect(preview[0].rowNumber).toBe(2);
    expect(preview[1].rowNumber).toBe(3);
    expect(preview[0].classification).toBe("valid");
    expect(preview[1].classification).toBe("valid");
  });

  it("routes shared fields to sharedFields and non-shared to jsonbFields", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"],
      ["111", "West", "100"],
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    const p = preview[0].parsed!;
    expect(p.sfid).toBe("111");
    expect(p.sharedFields).toEqual({ sfid: "111", region: "West" });
    expect(p.jsonbFields).toEqual({ planSqft: 100 });
  });

  it("captures plannedCost when the activity has that column (counter-wall has none — verify null path)", () => {
    // counter-wall planColumns does NOT have a plannedCost field → ParsedRow.plannedCost === null
    const cols = ACTIVITIES["counter-wall"].planColumns;
    const headerRow = cols.map((c) => c.label);
    // Real counter-wall row (Region, SFID, Dealer/Area, State, District, Taluka, Plan Sq Ft, Distributor)
    const dataRow = ["West", "111", "Dealer A", "MH", "Pune", "Haveli", "100", "Distributor X"];
    const preview = buildPreview([headerRow, dataRow], cols, coerceCell);
    expect(preview[0].classification).toBe("valid");
    expect(preview[0].parsed?.plannedCost).toBeNull();
  });

  it("classifies a row as fieldError when a required field is missing", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"],
      ["", "West", "100"], // SFID is required (synthetic), blank → fieldError
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    expect(preview[0].classification).toBe("fieldError");
    expect(preview[0].parsed).toBeNull();
    expect(preview[0].errors.length).toBeGreaterThan(0);
    expect(preview[0].errors[0].col).toBe("SFID");
    expect(preview[0].errors[0].reason).toMatch(/required/i);
  });

  it("classifies a row as fieldError when a cell fails type coercion", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"],
      ["111", "West", "abc"], // Plan Sq Ft is a number → "abc" → fieldError
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    expect(preview[0].classification).toBe("fieldError");
    expect(preview[0].parsed).toBeNull();
    expect(preview[0].errors.some((e) => e.col === "Plan Sq Ft")).toBe(true);
  });

  it("flips BOTH occurrences of a duplicate SFID to classification=duplicate", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"],
      ["111", "West", "100"],
      ["222", "East", "50"],
      ["111", "South", "75"], // dupe SFID with the first row
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    expect(preview.map((p) => p.classification)).toEqual([
      "duplicate", // row 2 (the first 111)
      "valid",     // row 3 (222)
      "duplicate", // row 4 (the second 111)
    ]);
  });

  it("fieldError WINS over duplicate when a row has both problems", () => {
    const rows: unknown[][] = [
      ["SFID", "Region", "Plan Sq Ft"],
      ["111", "West", "100"], // valid → will become duplicate
      ["111", "East", "abc"], // dupe SFID AND bad number → fieldError takes priority
    ];
    const preview = buildPreview(rows, SYNTHETIC_COLS, coerceCell);
    // The first 111 row should be duplicate (clean), the second should stay fieldError
    expect(preview[0].classification).toBe("duplicate");
    expect(preview[1].classification).toBe("fieldError");
  });

  it("returns a single fieldError row when planColumns has no SFID column (defensive)", () => {
    const noSfid: readonly FieldDef[] = [
      { key: "region", label: "Region", kind: "text", shared: true },
    ];
    const rows: unknown[][] = [["Region"], ["West"]];
    const preview = buildPreview(rows, noSfid, coerceCell);
    expect(preview.length).toBe(1);
    expect(preview[0].classification).toBe("fieldError");
    expect(preview[0].errors[0].reason).toMatch(/sfid/i);
  });

  it("returns an empty array when input has only the header row", () => {
    const preview = buildPreview([["SFID", "Region", "Plan Sq Ft"]], SYNTHETIC_COLS, coerceCell);
    expect(preview).toEqual([]);
  });

  it("returns an empty array when input is completely empty", () => {
    const preview = buildPreview([], SYNTHETIC_COLS, coerceCell);
    expect(preview).toEqual([]);
  });
});
