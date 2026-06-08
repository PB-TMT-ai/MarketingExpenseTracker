/**
 * Tests for coerceForKind (lib/actuals/coerce.ts) — the per-column type coercion the
 * GRID-13 paste-block handler applies to each pasted cell before writing it into fields.*.
 *
 * Pure unit tests — no DB, no React, no AG Grid. The coercion rules are LOCKED:
 *   - number/currency → num() (strips ₹/commas → number|null)
 *   - date → DD/MM/YY string passthrough (NEVER ISO — Phase 2 D2)
 *   - lat/long → string as-is (NEVER numeric-coerce coordinates — existing PITFALL)
 *   - text → string as-is
 *   - status/enum → string as-is (paste stays forgiving; server validates membership on save)
 */
import { describe, it, expect } from "vitest";
import { coerceForKind } from "./coerce";

describe("coerceForKind — number / currency (reuse num)", () => {
  it("number: '1,234' → 1234 (commas stripped)", () => {
    expect(coerceForKind("1,234", "number")).toBe(1234);
  });

  it("currency: '₹500' → 500 (rupee + symbol stripped)", () => {
    expect(coerceForKind("₹500", "currency")).toBe(500);
  });

  it("number: plain '42' → 42", () => {
    expect(coerceForKind("42", "number")).toBe(42);
  });

  it("currency: '₹1,250.50' → 1250.5", () => {
    expect(coerceForKind("₹1,250.50", "currency")).toBe(1250.5);
  });

  it("number: empty string → null", () => {
    expect(coerceForKind("", "number")).toBeNull();
  });

  it("number: non-numeric → null (never NaN)", () => {
    expect(coerceForKind("abc", "number")).toBeNull();
  });
});

describe("coerceForKind — date (DD/MM/YY passthrough, NEVER ISO)", () => {
  it("'31/12/25' → '31/12/25' (as-is, not converted to ISO)", () => {
    expect(coerceForKind("31/12/25", "date")).toBe("31/12/25");
  });

  it("does not coerce a date to a number or ISO string", () => {
    const out = coerceForKind("01/06/26", "date");
    expect(out).toBe("01/06/26");
    expect(typeof out).toBe("string");
  });
});

describe("coerceForKind — lat / long (NEVER numeric-coerce coordinates)", () => {
  it("lat: '19.0760' → '19.0760' (string, precision preserved)", () => {
    expect(coerceForKind("19.0760", "lat")).toBe("19.0760");
  });

  it("long: '72.8777' → '72.8777' (string, precision preserved)", () => {
    expect(coerceForKind("72.8777", "long")).toBe("72.8777");
  });

  it("lat stays a string (never a number)", () => {
    expect(typeof coerceForKind("19.0760", "lat")).toBe("string");
  });
});

describe("coerceForKind — text", () => {
  it("'hello' → 'hello'", () => {
    expect(coerceForKind("hello", "text")).toBe("hello");
  });
});

describe("coerceForKind — status / enum (as-is string)", () => {
  it("status: 'In Progress' → 'In Progress'", () => {
    expect(coerceForKind("In Progress", "status")).toBe("In Progress");
  });

  it("enum: 'Some Option' → 'Some Option' (forgiving; server validates on save)", () => {
    expect(coerceForKind("Some Option", "enum")).toBe("Some Option");
  });
});
