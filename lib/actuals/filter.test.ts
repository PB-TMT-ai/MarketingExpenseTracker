/**
 * Tests for pure cascading filter derivation (lib/actuals/filter.ts).
 *
 * Covers:
 *   - optionsFor: cascading option derivation (Region→State→District); excludes empty/blank values
 *   - matchesFacets: multi-facet predicate (empty selection = no constraint)
 *   - matchesSfid: case-insensitive prefix/substring match on plan.sfid ONLY (A6 fix)
 * No DB, no mocks — pure unit tests over UnitRow fixtures.
 */
import { describe, it, expect } from "vitest";
import { optionsFor, matchesFacets, matchesSfid } from "./filter";
import type { UnitRow } from "./rows";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(
  id: number,
  plan: Partial<{
    region: string;
    state: string;
    district: string;
    distributor: string;
    sfid: string;
  }>,
  fields: Partial<{ status: string }> = {},
): UnitRow {
  return {
    rowKey: `e:${id}`,
    planRowId: id,
    executionId: id,
    version: 1,
    plan: {
      sfid: `SF-${id}`,
      region: null,
      state: null,
      district: null,
      distributor: null,
      dealer: `Dealer-${id}`,
      ...plan,
    },
    fields: { ...fields },
    isPlaceholder: false,
    dirty: false,
  };
}

// Representative dataset: West/East regions, two states in West
const ROWS: UnitRow[] = [
  makeRow(1, { region: "West", state: "MH", district: "Pune" }, { status: "Done" }),
  makeRow(2, { region: "West", state: "MH", district: "Mumbai" }, { status: "Pending" }),
  makeRow(3, { region: "West", state: "GJ", district: "Ahmedabad" }, { status: "In Progress" }),
  makeRow(4, { region: "East", state: "WB", district: "Kolkata" }, { status: "Pending" }),
  makeRow(5, { region: "East", state: "OR", district: "Bhubaneswar" }, { status: "Done" }),
  // Row with blank/null district to test empty exclusion
  makeRow(6, { region: "West", state: "MH", district: "" }, { status: "Pending" }),
  makeRow(7, { region: "West", state: "MH", district: null as unknown as string }, { status: "Pending" }),
];

// ---------------------------------------------------------------------------
// optionsFor — cascading option derivation
// ---------------------------------------------------------------------------

describe("optionsFor — region options (no upstream)", () => {
  it("returns sorted unique non-empty regions", () => {
    const opts = optionsFor(ROWS, "region", {});
    expect(opts).toEqual(["East", "West"]);
  });

  it("excludes rows with blank or null region", () => {
    const rows = [
      makeRow(10, { region: "West" }),
      makeRow(11, { region: "" }),
      makeRow(12, { region: null as unknown as string }),
    ];
    const opts = optionsFor(rows, "region", {});
    expect(opts).toEqual(["West"]);
  });
});

describe("optionsFor — state options (cascade narrows by region)", () => {
  it("all states when no upstream filter", () => {
    const opts = optionsFor(ROWS, "state", {});
    expect(opts).toEqual(["GJ", "MH", "OR", "WB"]);
  });

  it("only states under West when upstream region=[West]", () => {
    const opts = optionsFor(ROWS, "state", { region: ["West"] });
    expect(opts).toEqual(["GJ", "MH"]);
  });

  it("only states under East when upstream region=[East]", () => {
    const opts = optionsFor(ROWS, "state", { region: ["East"] });
    expect(opts).toEqual(["OR", "WB"]);
  });

  it("empty upstream selection = no constraint (all states)", () => {
    const opts = optionsFor(ROWS, "state", { region: [] });
    expect(opts).toEqual(["GJ", "MH", "OR", "WB"]);
  });
});

describe("optionsFor — district options (cascade narrows by region + state)", () => {
  it("only districts under West+MH", () => {
    const opts = optionsFor(ROWS, "district", { region: ["West"], state: ["MH"] });
    // blank/null districts are excluded; Mumbai and Pune only
    expect(opts).toEqual(["Mumbai", "Pune"]);
  });

  it("only districts under West (all states in West)", () => {
    const opts = optionsFor(ROWS, "district", { region: ["West"] });
    // Ahmedabad (GJ), Mumbai (MH), Pune (MH) — blank districts excluded
    expect(opts).toEqual(["Ahmedabad", "Mumbai", "Pune"]);
  });

  it("only Kolkata under East+WB", () => {
    const opts = optionsFor(ROWS, "district", { region: ["East"], state: ["WB"] });
    expect(opts).toEqual(["Kolkata"]);
  });

  it("is alphabetically sorted", () => {
    const opts = optionsFor(ROWS, "district", {});
    expect(opts).toEqual([...opts].sort());
  });

  it("empty array options are excluded", () => {
    const opts = optionsFor(ROWS, "district", { region: ["West"], state: ["MH"] });
    // rows 6 and 7 have blank/null district; they must not appear
    expect(opts).not.toContain("");
    expect(opts).not.toContain(null);
  });
});

// ---------------------------------------------------------------------------
// matchesFacets
// ---------------------------------------------------------------------------

describe("matchesFacets — multi-facet predicate", () => {
  const row = makeRow(1, { region: "West", state: "MH", district: "Pune", distributor: "Dist-A" }, { status: "Done" });

  it("empty selection object → passes all rows (no constraint)", () => {
    expect(matchesFacets(row, {})).toBe(true);
  });

  it("empty array for a facet → no constraint for that facet", () => {
    expect(matchesFacets(row, { region: [] })).toBe(true);
  });

  it("region matches → true", () => {
    expect(matchesFacets(row, { region: ["West"] })).toBe(true);
  });

  it("region mismatch → false", () => {
    expect(matchesFacets(row, { region: ["East"] })).toBe(false);
  });

  it("status=Done matches the row's fields.status", () => {
    expect(matchesFacets(row, { status: ["Done"] })).toBe(true);
  });

  it("status=Pending does NOT match a Done row", () => {
    expect(matchesFacets(row, { status: ["Pending"] })).toBe(false);
  });

  it("multi-facet AND: region=West AND status=Done → true", () => {
    expect(matchesFacets(row, { region: ["West"], status: ["Done"] })).toBe(true);
  });

  it("multi-facet AND: region=West AND status=Pending → false (status mismatch)", () => {
    expect(matchesFacets(row, { region: ["West"], status: ["Pending"] })).toBe(false);
  });

  it("location facets read from row.plan, status reads from row.fields", () => {
    const rowWithStatus = makeRow(
      99,
      { region: "East", state: "WB" },
      { status: "In Progress" },
    );
    expect(matchesFacets(rowWithStatus, { region: ["East"], status: ["In Progress"] })).toBe(true);
    expect(matchesFacets(rowWithStatus, { region: ["East"], status: ["Done"] })).toBe(false);
  });

  it("distributor facet reads from row.plan", () => {
    expect(matchesFacets(row, { distributor: ["Dist-A"] })).toBe(true);
    expect(matchesFacets(row, { distributor: ["Dist-B"] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesSfid
// ---------------------------------------------------------------------------

describe("matchesSfid — scoped SFID predicate (A6 dedicated predicate)", () => {
  const row = makeRow(1, { sfid: "SFID-00007", region: "West" });

  it("empty search → passes all rows", () => {
    expect(matchesSfid(row, "")).toBe(true);
  });

  it("exact match → true (case-insensitive)", () => {
    expect(matchesSfid(row, "SFID-00007")).toBe(true);
    expect(matchesSfid(row, "sfid-00007")).toBe(true);
  });

  it("prefix match → true", () => {
    expect(matchesSfid(row, "SFID-0000")).toBe(true);
  });

  it("substring match → true", () => {
    expect(matchesSfid(row, "00007")).toBe(true);
  });

  it("non-matching string → false", () => {
    expect(matchesSfid(row, "SFID-99999")).toBe(false);
  });

  it("does NOT match region (other plan columns) — sfid-only scope", () => {
    // 'West' is the region; searching 'West' should return false
    // because this predicate only looks at plan.sfid, not other fields
    expect(matchesSfid(row, "West")).toBe(false);
  });

  it("does NOT match dealer name", () => {
    // dealer is 'Dealer-1'; searching that string must not match
    expect(matchesSfid(row, "Dealer")).toBe(false);
  });

  it("whitespace-only search passes all rows", () => {
    expect(matchesSfid(row, "   ")).toBe(true);
  });
});
