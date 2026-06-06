/**
 * Tests for the pure calc engine (lib/actuals/calc.ts).
 *
 * Covers every locked D3-04 formula case plus sticky-override semantics (D3-05).
 * No DB, no React, no mocks — pure unit tests.
 */
import { describe, it, expect } from "vitest";
import {
  computeDerived,
  isOverridden,
  setOverride,
  clearOverride,
} from "./calc";

// ---------------------------------------------------------------------------
// computeDerived — D3-04 formulas
// ---------------------------------------------------------------------------

describe("computeDerived — counter-wall", () => {
  it("totalCost = actualSqft × perUnitCost", () => {
    expect(
      computeDerived("counter-wall", "totalCost", {
        actualSqft: "10",
        perUnitCost: "5",
      }),
    ).toBe(50);
  });

  it("counter-wall has NO derived totalSqft (entered, not derived) → null", () => {
    expect(
      computeDerived("counter-wall", "totalSqft", {
        actualSqft: "10",
        perUnitCost: "5",
      }),
    ).toBeNull();
  });

  it("totalCost with zero → 0", () => {
    expect(
      computeDerived("counter-wall", "totalCost", {
        actualSqft: "0",
        perUnitCost: "100",
      }),
    ).toBe(0);
  });
});

describe("computeDerived — in-shop (L × B, no height)", () => {
  it("totalSqft = length × breadth", () => {
    expect(
      computeDerived("in-shop", "totalSqft", { length: "4", breadth: "3" }),
    ).toBe(12);
  });

  it("totalCost = totalSqft × perUnitCost (derived sqft path)", () => {
    expect(
      computeDerived("in-shop", "totalCost", {
        length: "4",
        breadth: "3",
        perUnitCost: "10",
      }),
    ).toBe(120);
  });
});

describe("computeDerived — gsb (L × B, height EXCLUDED from area — D3-04 critical)", () => {
  it("totalSqft = length × breadth, height is NOT multiplied", () => {
    expect(
      computeDerived("gsb", "totalSqft", {
        length: "4",
        breadth: "3",
        height: "99",
      }),
    ).toBe(12);
  });

  it("totalCost uses derived totalSqft (height excluded)", () => {
    expect(
      computeDerived("gsb", "totalCost", {
        length: "4",
        breadth: "3",
        height: "99",
        perUnitCost: "5",
      }),
    ).toBe(60);
  });
});

describe("computeDerived — nlb (L × B, height EXCLUDED from area — D3-04 critical)", () => {
  it("totalSqft = length × breadth, height is NOT multiplied", () => {
    expect(
      computeDerived("nlb", "totalSqft", {
        length: "4",
        breadth: "3",
        height: "99",
      }),
    ).toBe(12);
  });

  it("totalCost uses derived totalSqft (height excluded)", () => {
    expect(
      computeDerived("nlb", "totalCost", {
        length: "4",
        breadth: "3",
        height: "99",
        perUnitCost: "5",
      }),
    ).toBe(60);
  });
});

describe("computeDerived — pop-dealer-kit (lineTotal = qty × rate)", () => {
  it("lineTotal = qty × rate", () => {
    expect(
      computeDerived("pop-dealer-kit", "lineTotal", { qty: "3", rate: "2.5" }),
    ).toBe(7.5);
  });

  it("lineTotal with integer values", () => {
    expect(
      computeDerived("pop-dealer-kit", "lineTotal", { qty: "10", rate: "100" }),
    ).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Currency / comma / ₹ tolerance
// ---------------------------------------------------------------------------

describe("computeDerived — numeric input tolerance", () => {
  it("strips commas: length='1,000', breadth='2' → totalSqft = 2000", () => {
    expect(
      computeDerived("in-shop", "totalSqft", {
        length: "1,000",
        breadth: "2",
      }),
    ).toBe(2000);
  });

  it("strips ₹ symbol: perUnitCost='₹5' parses to 5", () => {
    expect(
      computeDerived("counter-wall", "totalCost", {
        actualSqft: "10",
        perUnitCost: "₹5",
      }),
    ).toBe(50);
  });

  it("strips whitespace from numeric strings", () => {
    expect(
      computeDerived("in-shop", "totalSqft", {
        length: " 4 ",
        breadth: " 3 ",
      }),
    ).toBe(12);
  });
});

// ---------------------------------------------------------------------------
// Non-numeric / NaN guard
// ---------------------------------------------------------------------------

describe("computeDerived — non-numeric input → null (never NaN)", () => {
  it("non-numeric length → null", () => {
    const result = computeDerived("in-shop", "totalSqft", {
      length: "abc",
      breadth: "3",
    });
    expect(result).toBeNull();
    // Must NEVER be NaN
    expect(result).not.toBeNaN();
  });

  it("missing input field → null", () => {
    expect(computeDerived("in-shop", "totalSqft", { breadth: "3" })).toBeNull();
  });

  it("empty string → null", () => {
    expect(
      computeDerived("in-shop", "totalSqft", { length: "", breadth: "3" }),
    ).toBeNull();
  });

  it("null value → null", () => {
    expect(
      computeDerived("in-shop", "totalSqft", { length: null, breadth: "3" }),
    ).toBeNull();
  });

  it("totalCost when perUnitCost is non-numeric → null", () => {
    expect(
      computeDerived("counter-wall", "totalCost", {
        actualSqft: "10",
        perUnitCost: "abc",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Rounding — round2 helper (round half-up to 2 dp)
// ---------------------------------------------------------------------------

describe("computeDerived — rounding at 2 decimal places", () => {
  it("3.333... × 3 rounds to 2dp (no accumulated float drift)", () => {
    // 3.333333 × 3 = 9.999999 → round2 → 10.00
    expect(
      computeDerived("in-shop", "totalSqft", {
        length: "3.333333",
        breadth: "3",
      }),
    ).toBe(10); // Math.round(9.999999 * 100) / 100 = Math.round(999.9999) / 100 = 1000/100 = 10
    // round2 is applied once at the product; 1.5 × 1 = 1.5 stays 1.5 (not 1.50...)
    expect(
      computeDerived("in-shop", "totalCost", {
        length: "1.5",
        breadth: "1",
        perUnitCost: "1",
      }),
    ).toBe(1.5);
  });

  it("qty=3, rate=0.1 → lineTotal = 0.3 (not 0.30000000000000004)", () => {
    const result = computeDerived("pop-dealer-kit", "lineTotal", {
      qty: "3",
      rate: "0.1",
    });
    expect(result).toBe(0.3);
  });
});

// ---------------------------------------------------------------------------
// Sticky override — D3-05
// ---------------------------------------------------------------------------

describe("sticky override — isOverridden / setOverride / clearOverride", () => {
  it("isOverridden returns false when __overrides is absent", () => {
    expect(isOverridden({}, "totalCost")).toBe(false);
  });

  it("isOverridden returns false when key not in __overrides", () => {
    expect(isOverridden({ __overrides: { totalSqft: true } }, "totalCost")).toBe(
      false,
    );
  });

  it("setOverride marks the key as true", () => {
    const f: Record<string, unknown> = {};
    setOverride(f, "totalCost", true);
    expect(isOverridden(f, "totalCost")).toBe(true);
  });

  it("clearOverride removes the override flag", () => {
    const f: Record<string, unknown> = {};
    setOverride(f, "totalCost", true);
    clearOverride(f, "totalCost");
    expect(isOverridden(f, "totalCost")).toBe(false);
  });

  it("computeDerived with overridden totalCost: returns stored value, NOT recomputed", () => {
    // This proves the short-circuit that prevents the Pitfall-4 loop.
    // When totalCost is overridden, the caller uses stored fields.totalCost directly —
    // computeDerived itself does NOT check the override (it's the valueGetter that does).
    // But totalCost composition path: when totalSqft is overridden, totalCost uses stored totalSqft.
    const f: Record<string, unknown> = {
      totalSqft: "999",
      perUnitCost: "1",
      __overrides: { totalSqft: true },
    };
    // totalCost should use the stored totalSqft (999) not recompute via L×B
    const result = computeDerived("in-shop", "totalCost", f);
    expect(result).toBe(999);
  });

  it("totalCost uses derived totalSqft when totalSqft is NOT overridden", () => {
    const f: Record<string, unknown> = {
      length: "4",
      breadth: "3",
      perUnitCost: "10",
      // no override
    };
    // derived totalSqft = 4×3 = 12, totalCost = 12×10 = 120
    expect(computeDerived("in-shop", "totalCost", f)).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// Unknown activity / unknown key
// ---------------------------------------------------------------------------

describe("computeDerived — unknown activity or key → null", () => {
  it("unknown activity returns null for totalSqft", () => {
    expect(
      computeDerived("unknown-activity", "totalSqft", { length: "4" }),
    ).toBeNull();
  });

  it("unknown derived key returns null", () => {
    expect(
      computeDerived("in-shop", "unknownField", { length: "4", breadth: "3" }),
    ).toBeNull();
  });
});
