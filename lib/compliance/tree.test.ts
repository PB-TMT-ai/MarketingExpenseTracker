/**
 * Tests for the pure geo-tree builder (lib/compliance/tree.ts).
 *
 * Covers (DASH-07 — Zone → State → District → Taluka drill):
 *   - hierarchy: a 2×2×2×2 input materializes four nested levels; each parent's
 *     metrics equal the SUM of its children's (the "% executed aggregates upward"
 *     guarantee, DASH-07 success criterion #7).
 *   - sorting: siblings at every depth are alphabetical regardless of input order.
 *   - unassigned: null/empty who-where values surface as the "(unassigned)" label
 *     and group together at their level.
 *   - empty input → [].
 *
 * No DB, no mocks — pure unit tests over GeoRow fixtures (mirrors
 * lib/actuals/filter.test.ts style).
 */
import { describe, it, expect } from "vitest";
import { buildGeoTree, type GeoTreeNode } from "./tree";
import type { GeoRow } from "@/lib/db/dashboard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<GeoRow> = {}): GeoRow {
  return {
    region: "North",
    state: "State1",
    district: "District1",
    taluka: "Taluka1",
    plannedUnits: 1,
    executedUnits: 0,
    cancelledUnits: 0,
    plannedCost: 0,
    actualCost: 0,
    ...overrides,
  };
}

/** Recursively find a node by its label among a list of siblings. */
function byLabel(nodes: GeoTreeNode[], label: string): GeoTreeNode {
  const found = nodes.find((n) => n.label === label);
  if (!found) throw new Error(`node "${label}" not found among [${nodes.map((n) => n.label).join(", ")}]`);
  return found;
}

/** Build the full 2×2×2×2 = 16-row cartesian fixture, each leaf carrying distinct metrics. */
function cartesian16(): GeoRow[] {
  const rows: GeoRow[] = [];
  let i = 1;
  for (const region of ["North", "South"]) {
    for (const state of ["StateA", "StateB"]) {
      for (const district of ["Dist1", "Dist2"]) {
        for (const taluka of ["Tal1", "Tal2"]) {
          rows.push(
            makeRow({
              region,
              state,
              district,
              taluka,
              plannedUnits: i,
              executedUnits: i * 2,
              cancelledUnits: i * 3,
              plannedCost: i * 100,
              actualCost: i * 10,
            }),
          );
          i += 1;
        }
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------
// hierarchy
// ---------------------------------------------------------------------------

describe("buildGeoTree — hierarchy", () => {
  it("renders four nested levels from a 2×2×2×2 input", () => {
    const tree = buildGeoTree(cartesian16());
    expect(tree).toHaveLength(2); // two regions
    const north = byLabel(tree, "North");
    expect(north.children).toHaveLength(2); // two states
    const stateA = byLabel(north.children, "StateA");
    expect(stateA.children).toHaveLength(2); // two districts
    const dist1 = byLabel(stateA.children, "Dist1");
    expect(dist1.children).toHaveLength(2); // two talukas
    const tal1 = byLabel(dist1.children, "Tal1");
    expect(tal1.children).toHaveLength(0); // leaves have no children
  });

  it("each parent's metrics equal the SUM of its children's (recursively)", () => {
    const tree = buildGeoTree(cartesian16());

    const sumChildren = (node: GeoTreeNode, key: keyof GeoTreeNode) =>
      node.children.reduce((acc, c) => acc + (c[key] as number), 0);

    const checkNode = (node: GeoTreeNode) => {
      if (node.children.length === 0) return;
      for (const key of ["planned", "executed", "cancelled", "plannedCost", "actualCost"] as const) {
        expect(node[key]).toBe(sumChildren(node, key));
      }
      node.children.forEach(checkNode);
    };
    tree.forEach(checkNode);
  });

  it("a leaf carries the exact metrics of its source row", () => {
    const tree = buildGeoTree([
      makeRow({
        region: "North",
        state: "StateA",
        district: "Dist1",
        taluka: "Tal1",
        plannedUnits: 5,
        executedUnits: 3,
        cancelledUnits: 1,
        plannedCost: 500,
        actualCost: 300,
      }),
    ]);
    const leaf = tree[0].children[0].children[0].children[0];
    expect(leaf.label).toBe("Tal1");
    expect(leaf.planned).toBe(5);
    expect(leaf.executed).toBe(3);
    expect(leaf.cancelled).toBe(1);
    expect(leaf.plannedCost).toBe(500);
    expect(leaf.actualCost).toBe(300);
  });

  it("merges multiple leaf rows sharing the same full path into one summed leaf", () => {
    const tree = buildGeoTree([
      makeRow({ plannedUnits: 2, executedUnits: 1 }),
      makeRow({ plannedUnits: 3, executedUnits: 4 }),
    ]);
    expect(tree).toHaveLength(1);
    const leaf = tree[0].children[0].children[0].children[0];
    expect(leaf.planned).toBe(5);
    expect(leaf.executed).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// sorting
// ---------------------------------------------------------------------------

describe("buildGeoTree — sorting", () => {
  it("siblings are alphabetical at every depth regardless of input order", () => {
    // Insert rows in deliberately scrambled order.
    const rows = [
      makeRow({ region: "South", state: "StateZ", district: "DistB", taluka: "TalY" }),
      makeRow({ region: "North", state: "StateA", district: "DistA", taluka: "TalA" }),
      makeRow({ region: "South", state: "StateA", district: "DistA", taluka: "TalB" }),
      makeRow({ region: "North", state: "StateA", district: "DistA", taluka: "TalZ" }),
    ];
    const tree = buildGeoTree(rows);

    expect(tree.map((n) => n.label)).toEqual(["North", "South"]);

    const north = byLabel(tree, "North");
    const dist = north.children[0].children[0];
    // North/StateA/DistA has TalA and TalZ — must be sorted.
    expect(dist.children.map((n) => n.label)).toEqual(["TalA", "TalZ"]);

    const south = byLabel(tree, "South");
    expect(south.children.map((n) => n.label)).toEqual(["StateA", "StateZ"]);
  });
});

// ---------------------------------------------------------------------------
// unassigned
// ---------------------------------------------------------------------------

describe("buildGeoTree — unassigned", () => {
  it("null/empty who-where values surface as the (unassigned) label", () => {
    const tree = buildGeoTree([
      makeRow({
        region: "",
        state: null as unknown as string,
        district: undefined as unknown as string,
        taluka: "",
      }),
    ]);
    expect(tree[0].label).toBe("(unassigned)");
    expect(tree[0].children[0].label).toBe("(unassigned)");
    expect(tree[0].children[0].children[0].label).toBe("(unassigned)");
    expect(tree[0].children[0].children[0].children[0].label).toBe("(unassigned)");
  });

  it("groups all unassigned-region rows under one (unassigned) node", () => {
    const tree = buildGeoTree([
      makeRow({ region: "", state: "StateA", plannedUnits: 1 }),
      makeRow({ region: null as unknown as string, state: "StateB", plannedUnits: 2 }),
    ]);
    // Both empty/null regions collapse to a single "(unassigned)" zone.
    const unassigned = tree.filter((n) => n.label === "(unassigned)");
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].planned).toBe(3);
    expect(unassigned[0].children).toHaveLength(2); // StateA + StateB
  });
});

// ---------------------------------------------------------------------------
// empty input
// ---------------------------------------------------------------------------

describe("buildGeoTree — empty input", () => {
  it("returns [] for an empty input array", () => {
    expect(buildGeoTree([])).toEqual([]);
  });
});
