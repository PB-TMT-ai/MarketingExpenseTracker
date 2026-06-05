import { describe, it, expect } from "vitest";
import { buildPlanTemplate, TEMPLATE_FILE_NAME } from "./template";
import { readWorkbook } from "./parse";
import { ACTIVITY_KEYS, ACTIVITIES } from "../activities/registry";

/**
 * Pure-function spec for the SheetJS write surface (Plan 02-01 Task 2).
 *
 * The single load-bearing claim: for EVERY one of the six activities, the headers
 * the template emits round-trip back to `planColumns[i].label` in order. That
 * proves D2-03 (template is the canonical contract) and D2-05 (headers-only).
 */

describe("buildPlanTemplate — per-activity headers round-trip via readWorkbook", () => {
  for (const key of ACTIVITY_KEYS) {
    it(`emits headers equal to planColumns labels (in order) for ${key}`, () => {
      const buf = buildPlanTemplate(key);
      const rows = readWorkbook(buf);
      const expected = ACTIVITIES[key].planColumns.map((c) => c.label);
      expect(rows[0]).toEqual(expected);
      // headers-only template (D2-05): exactly one row in the sheet
      expect(rows.length).toBe(1);
    });
  }

  it("throws on an unknown activity key", () => {
    // Cast through unknown — the runtime check guards even when callers misuse the type.
    expect(() => buildPlanTemplate("nope" as unknown as never)).toThrow(/Unknown activity/);
  });
});

describe("TEMPLATE_FILE_NAME", () => {
  it("returns the D2-05 file-name pattern", () => {
    expect(TEMPLATE_FILE_NAME("counter-wall")).toBe(
      "marketing-plan-template-counter-wall.xlsx",
    );
    expect(TEMPLATE_FILE_NAME("pop-dealer-kit")).toBe(
      "marketing-plan-template-pop-dealer-kit.xlsx",
    );
  });

  it("covers every activity key without throwing", () => {
    for (const k of ACTIVITY_KEYS) {
      expect(TEMPLATE_FILE_NAME(k)).toMatch(/^marketing-plan-template-.+\.xlsx$/);
    }
  });
});
