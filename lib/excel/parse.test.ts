import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { readWorkbook, coerceCell } from "./parse";
import type { FieldDef } from "../activities/types";

/**
 * Pure-function spec for the SheetJS read surface (Plan 02-01 Task 2).
 *
 * The three hostile cell types from PITFALLS.md §6 are the spine of this spec:
 *   1. SFID-as-number  → text/status/enum/lat/long must preserve digits without
 *                        scientific-notation loss
 *   2. ₹ + comma money → number/currency must strip ₹ / $ / comma / whitespace
 *   3. DD/MM/YY date   → date kind must accept the canonical Indian input AND a
 *                        real JS Date (when cellDates:true returns one), and must
 *                        emit ISO via getUTC* (never local-TZ getFullYear)
 */

// Synthetic FieldDefs we can use without coupling to a specific activity.
const TEXT: FieldDef = { key: "f", label: "F", kind: "text" };
const NUMBER: FieldDef = { key: "f", label: "F", kind: "number" };
const CURRENCY: FieldDef = { key: "f", label: "F", kind: "currency" };
const DATE: FieldDef = { key: "f", label: "F", kind: "date" };
const STATUS: FieldDef = { key: "f", label: "F", kind: "status" };
const ENUM_AB: FieldDef = {
  key: "f",
  label: "F",
  kind: "enum",
  enumValues: ["A", "B"] as const,
};
const LAT: FieldDef = { key: "lat", label: "Lat", kind: "lat" };
const LONG: FieldDef = { key: "lng", label: "Lng", kind: "long" };

/** Build a real .xlsx ArrayBuffer in memory — no fixture files needed. */
function makeXlsx(aoa: unknown[][], sheetName = "Sheet1"): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, sheetName);
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("readWorkbook", () => {
  it("parses a single-sheet workbook into array-of-arrays with header at index 0", () => {
    const buf = makeXlsx([
      ["SFID", "Region", "Plan Sq Ft"],
      ["12345", "West", 100],
      ["67890", "East", 50],
    ]);
    const rows = readWorkbook(buf);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual(["SFID", "Region", "Plan Sq Ft"]);
    // raw:false + cellDates:true → numeric cells come back as formatted strings,
    // so "100" not 100. The key invariant is that column positions stay aligned.
    expect(rows[1]?.[0]).toBe("12345");
    expect(rows[1]?.[1]).toBe("West");
    expect(rows[2]?.[0]).toBe("67890");
  });

  it("returns the FIRST sheet when the workbook has multiple sheets", () => {
    const sheet1 = XLSX.utils.aoa_to_sheet([["A"], ["x"]]);
    const sheet2 = XLSX.utils.aoa_to_sheet([["B"], ["y"]]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet1, "First");
    XLSX.utils.book_append_sheet(wb, sheet2, "Second");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const rows = readWorkbook(buf);
    expect(rows[0]).toEqual(["A"]);
    expect(rows[1]).toEqual(["x"]);
  });

  it("skips blank rows in the middle of the data block", () => {
    const buf = makeXlsx([
      ["SFID"],
      ["111"],
      [],
      ["222"],
    ]);
    const rows = readWorkbook(buf);
    // blankrows:false → the empty row is gone
    expect(rows.map((r) => r[0])).toEqual(["SFID", "111", "222"]);
  });

  it("throws when the workbook has zero sheets", () => {
    const wb = XLSX.utils.book_new();
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    expect(() => readWorkbook(buf)).toThrow();
  });
});

describe("coerceCell — blank handling", () => {
  it("returns null for empty-string cells regardless of kind", () => {
    for (const fd of [TEXT, NUMBER, CURRENCY, DATE, STATUS, ENUM_AB, LAT, LONG]) {
      const r = coerceCell("", fd);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value).toBeNull();
    }
  });

  it("returns null for null/undefined cells regardless of kind", () => {
    expect(coerceCell(null, TEXT)).toEqual({ ok: true, value: null });
    expect(coerceCell(undefined, NUMBER)).toEqual({ ok: true, value: null });
    expect(coerceCell(null, DATE)).toEqual({ ok: true, value: null });
  });
});

describe("coerceCell — text/status/enum/lat/long (no scientific-notation loss)", () => {
  it("preserves a 10-digit SFID when input arrives as a number", () => {
    // The pitfall: a 10-digit numeric cell would become "1.23456789e9" via plain
    // String(n) in some engines. Math.trunc + String must keep it as "1234567890".
    const r = coerceCell(1234567890, TEXT);
    expect(r).toEqual({ ok: true, value: "1234567890" });
  });

  it("trims whitespace from string inputs", () => {
    const r = coerceCell("  SFID01  ", TEXT);
    expect(r).toEqual({ ok: true, value: "SFID01" });
  });

  it("treats status / lat / long the same way as text for numeric inputs", () => {
    expect(coerceCell(7, STATUS)).toEqual({ ok: true, value: "7" });
    expect(coerceCell(22.5, LAT)).toEqual({ ok: true, value: "22.5" });
    expect(coerceCell(77.5, LONG)).toEqual({ ok: true, value: "77.5" });
  });

  it("accepts an enum value when present in enumValues", () => {
    expect(coerceCell("A", ENUM_AB)).toEqual({ ok: true, value: "A" });
    expect(coerceCell("B", ENUM_AB)).toEqual({ ok: true, value: "B" });
  });

  it("rejects an enum value outside enumValues with a helpful error", () => {
    const r = coerceCell("Z", ENUM_AB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Expected one of/);
  });
});

describe("coerceCell — number / currency (₹ + comma + whitespace strip)", () => {
  it("strips ₹ and commas from a currency-formatted string", () => {
    expect(coerceCell("₹1,250.00", CURRENCY)).toEqual({ ok: true, value: 1250 });
    expect(coerceCell("₹ 1,250.00", CURRENCY)).toEqual({ ok: true, value: 1250 });
  });

  it("strips commas from a plain number-formatted string", () => {
    expect(coerceCell("1,250.00", NUMBER)).toEqual({ ok: true, value: 1250 });
  });

  it("parses an integer numeric input directly", () => {
    expect(coerceCell(100, NUMBER)).toEqual({ ok: true, value: 100 });
  });

  it("rejects non-numeric strings with a deterministic error", () => {
    const r = coerceCell("abc", NUMBER);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Not a number/);
  });

  it("treats $ as a strip char too (defensive — vendor templates vary)", () => {
    expect(coerceCell("$1,000", CURRENCY)).toEqual({ ok: true, value: 1000 });
  });
});

describe("coerceCell — date (DD/MM canonical input, UTC formatting)", () => {
  it("formats a JS Date input to ISO YYYY-MM-DD using getUTC* (no TZ shift)", () => {
    // 1 Aug 2026, UTC. getUTC* avoids the off-by-one that getFullYear would cause
    // on a non-UTC server.
    const d = new Date(Date.UTC(2026, 7, 1));
    expect(coerceCell(d, DATE)).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("parses DD/MM/YYYY string input to ISO", () => {
    expect(coerceCell("01/08/2026", DATE)).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("parses DD/MM/YY string input to ISO (assumes 20XX)", () => {
    expect(coerceCell("01/08/26", DATE)).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("accepts D/M/YY (single-digit components) and zero-pads", () => {
    expect(coerceCell("1/8/26", DATE)).toEqual({ ok: true, value: "2026-08-01" });
  });

  it("rejects ISO-formatted date strings (DD/MM is the canonical input shape)", () => {
    const r = coerceCell("2026-08-01", DATE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/DD\/MM/);
  });

  it("rejects garbage date strings", () => {
    const r = coerceCell("not-a-date", DATE);
    expect(r.ok).toBe(false);
  });
});
