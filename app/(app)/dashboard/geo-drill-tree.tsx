"use client";

/**
 * GeoDrillTree (client island) — DASH-07 Zone → State → District → Taluka drill-down.
 *
 * Renders a pre-built GeoTreeNode[] (from lib/compliance/tree.ts buildGeoTree) as
 * nested native <details>/<summary> collapsibles. Native <details> gives free keyboard
 * toggle + screen-reader semantics (RESEARCH Open Question #5). This stays a client
 * island to preserve the upgrade path for future inline-edit / aria hooks, even though
 * native <details> would toggle without JS.
 *
 * Each summary shows label + planned / executed / cancelled counts + planned ₹ / actual
 * ₹ + a % executed figure (executed / (planned − cancelled), the D-03 denominator).
 *
 * D-08: exception rows never reach this tree — aggregateByGeo (Plan 04-02) filters
 * PLAN_UPLOAD_ONLY upstream, so the tree builder only ever sees plan-uploaded rows.
 *
 * className convention copied from app/(app)/actuals/page.tsx:194-208.
 */

import type { GeoTreeNode } from "@/lib/compliance/tree";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** D-03 denominator: executed / (planned − cancelled). 0 when the denominator is 0. */
function pctExecuted(node: GeoTreeNode): string {
  const denom = node.planned - node.cancelled;
  const ratio = denom <= 0 ? 0 : node.executed / denom;
  return `${(ratio * 100).toFixed(1)}%`;
}

const LEVELS = ["zone", "state", "district", "taluka"] as const;
type Level = (typeof LEVELS)[number];

function Metrics({ node }: { node: GeoTreeNode }) {
  return (
    <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
      <span data-slot="metric-executed-pct" className="font-semibold text-neutral-900">
        {pctExecuted(node)}
      </span>
      <span>
        plan <span data-slot="metric-planned" className="font-medium text-neutral-900">{node.planned}</span>
      </span>
      <span>
        exec <span data-slot="metric-executed" className="font-medium text-neutral-900">{node.executed}</span>
      </span>
      <span>
        canc <span data-slot="metric-cancelled" className="font-medium text-neutral-900">{node.cancelled}</span>
      </span>
      <span className="text-neutral-500">
        {inr.format(node.plannedCost)} → {inr.format(node.actualCost)}
      </span>
    </span>
  );
}

function TreeNode({ node, level }: { node: GeoTreeNode; level: Level }) {
  const childLevel = LEVELS[LEVELS.indexOf(level) + 1] as Level | undefined;
  const isLeaf = node.children.length === 0 || childLevel === undefined;

  const summaryRow = (
    <span className="flex w-full flex-wrap items-center gap-2">
      <span className="font-medium text-neutral-800">{node.label}</span>
      <Metrics node={node} />
    </span>
  );

  // Leaf (taluka, or any node with no children): render a static row, not a disclosure.
  if (isLeaf) {
    return (
      <div
        data-level={level}
        data-label={node.label}
        data-planned={node.planned}
        data-executed={node.executed}
        data-cancelled={node.cancelled}
        className="border-b border-neutral-100 px-4 py-2 text-sm"
        style={{ paddingLeft: `${1 + LEVELS.indexOf(level) * 1.25}rem` }}
      >
        {summaryRow}
      </div>
    );
  }

  return (
    <details
      data-level={level}
      data-label={node.label}
      data-planned={node.planned}
      data-executed={node.executed}
      data-cancelled={node.cancelled}
      className="border-b border-neutral-100 text-sm"
    >
      <summary
        className="cursor-pointer px-4 py-2 hover:bg-neutral-50"
        style={{ paddingLeft: `${1 + LEVELS.indexOf(level) * 1.25}rem` }}
      >
        {summaryRow}
      </summary>
      <div>
        {node.children.map((c) => (
          <TreeNode key={`${level}:${c.label}`} node={c} level={childLevel} />
        ))}
      </div>
    </details>
  );
}

export default function GeoDrillTree({ tree }: { tree: GeoTreeNode[] }) {
  return (
    <section
      data-slot="geo-drill-tree"
      className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-base font-semibold text-neutral-900">
          Geographic drill-down
        </h2>
        <span className="text-xs text-neutral-500">
          Zone → State → District → Taluka
        </span>
      </div>
      {tree.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-neutral-500">
          No plan rows in scope.
        </p>
      ) : (
        tree.map((zone) => (
          <TreeNode key={`zone:${zone.label}`} node={zone} level="zone" />
        ))
      )}
    </section>
  );
}
