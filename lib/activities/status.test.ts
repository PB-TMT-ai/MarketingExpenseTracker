/**
 * Tests for lib/activities/status.ts — the single source of truth for status
 * classification across grid (Phase 3.1), dashboard (Phase 4), and export (Phase 5).
 *
 * Locks the A4/R1 invariant: 'Cancelled' is a registered enum value so SQL clauses
 * like `filter (where status = 'Cancelled')` in Phase 4 can return non-zero results.
 */
import { describe, it, expect } from "vitest";
import { STATUS_VALUES, TERMINAL_STATUSES } from "./status";
import type { StatusValue } from "./status";
import { ACTIVITIES } from "./index";

describe("STATUS_VALUES — single source of truth", () => {
  it("contains exactly the four canonical status values in canonical order", () => {
    expect(STATUS_VALUES).toEqual(["Pending", "In Progress", "Done", "Cancelled"]);
  });

  it("includes 'Cancelled' (A4/R1 — Phase 4 SQL hardcodes this literal)", () => {
    expect(STATUS_VALUES).toContain("Cancelled");
  });

  it("Pending is first, Cancelled is last (order is significant for UI sort + TERMINAL derivation)", () => {
    expect(STATUS_VALUES[0]).toBe("Pending");
    expect(STATUS_VALUES[STATUS_VALUES.length - 1]).toBe("Cancelled");
  });
});

describe("TERMINAL_STATUSES", () => {
  it("contains exactly Done and Cancelled (the two end states)", () => {
    expect(TERMINAL_STATUSES).toEqual(["Done", "Cancelled"]);
  });

  it("every TERMINAL_STATUSES entry is also in STATUS_VALUES", () => {
    for (const t of TERMINAL_STATUSES) {
      expect(STATUS_VALUES as readonly string[]).toContain(t);
    }
  });
});

describe("StatusValue type", () => {
  it("is structurally usable as a literal union (compile-time check via assignment)", () => {
    const v: StatusValue = "Cancelled";
    expect(STATUS_VALUES as readonly string[]).toContain(v);
  });
});

describe("activity registry consumes STATUS_VALUES (no inline literals remain)", () => {
  const STATUS_BEARING_KEYS = [
    "counter-wall",
    "gsb",
    "nlb",
    "in-shop",
    "dealer-certificate",
  ] as const;

  for (const key of STATUS_BEARING_KEYS) {
    it(`${key} status field exposes the four canonical STATUS_VALUES`, () => {
      const cfg = ACTIVITIES[key];
      const statusField = cfg.actualColumns.find((c) => c.key === "status");
      expect(statusField, `${key} must have a status field`).toBeDefined();
      // Identity-equal (not just deep-equal) — proves the config imports the constant
      // rather than inlining its own array.
      expect(statusField?.enumValues).toBe(STATUS_VALUES);
    });
  }
});
