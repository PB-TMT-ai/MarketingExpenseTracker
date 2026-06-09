"use client";

import { useState } from "react";
import type {
  ByActivityRow,
  ByDistributorRow,
  ByRegionRow,
  ByStateRow,
} from "@/lib/db/dashboard";

type TabKey = "state" | "distributor" | "activity" | "region";
type ActivityRow = ByActivityRow & { label: string };

/**
 * BreakdownTabs — Client tablist + table. All four datasets arrive pre-aggregated;
 * switching tabs is a state flip, no fetch. Small N: states ≤ 30, distributors ≤ a few hundred,
 * activities ≤ 6, regions ≤ 5.
 */
export default function BreakdownTabs({
  byState,
  byDistributor,
  byActivity,
  byRegion,
}: {
  byState: ByStateRow[];
  byDistributor: ByDistributorRow[];
  byActivity: ActivityRow[];
  byRegion: ByRegionRow[];
}) {
  const [tab, setTab] = useState<TabKey>("state");

  const tabs: { key: TabKey; label: string }[] = [
    { key: "state", label: "State" },
    { key: "distributor", label: "Distributor" },
    { key: "activity", label: "Activity" },
    { key: "region", label: "Region" },
  ];

  return (
    <div>
      <div role="tablist" className="flex gap-1 border-b border-neutral-200 px-4">
        {tabs.map((t) => {
          const isActive = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={isActive}
              data-tab={t.key}
              onClick={() => setTab(t.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? "border-neutral-900 text-neutral-900"
                  : "border-transparent text-neutral-500 hover:text-neutral-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto p-4">
        {tab === "state" && (
          <BreakdownTable
            rows={byState.map((r) => ({ ...r, key: r.state }))}
            keyHeader="State"
          />
        )}
        {tab === "distributor" && (
          <BreakdownTable
            rows={byDistributor.map((r) => ({ ...r, key: r.distributor }))}
            keyHeader="Distributor"
          />
        )}
        {tab === "activity" && (
          <BreakdownTable
            rows={byActivity.map((r) => ({ ...r, key: r.label }))}
            keyHeader="Activity"
          />
        )}
        {tab === "region" && (
          <BreakdownTable
            rows={byRegion.map((r) => ({ ...r, key: r.region }))}
            keyHeader="Region"
          />
        )}
      </div>
    </div>
  );
}

type Row = {
  key: string;
  plannedCost: number;
  actualCost: number;
  plannedCounters: number;
  actualCounters: number;
  plannedSqft: number;
  actualSqft: number;
};

function BreakdownTable({ rows, keyHeader }: { rows: Row[]; keyHeader: string }) {
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">No rows in scope.</p>;
  }

  const totals = rows.reduce(
    (acc, r) => ({
      plannedCost: acc.plannedCost + r.plannedCost,
      actualCost: acc.actualCost + r.actualCost,
      plannedCounters: acc.plannedCounters + r.plannedCounters,
      actualCounters: acc.actualCounters + r.actualCounters,
      plannedSqft: acc.plannedSqft + r.plannedSqft,
      actualSqft: acc.actualSqft + r.actualSqft,
    }),
    {
      plannedCost: 0,
      actualCost: 0,
      plannedCounters: 0,
      actualCounters: 0,
      plannedSqft: 0,
      actualSqft: 0,
    },
  );

  const fmtINR = (n: number) =>
    `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  const pct = (num: number, den: number) =>
    den === 0 ? "—" : `${Math.round((num / den) * 100)}%`;

  return (
    <table className="w-full text-sm">
      <thead className="text-left text-xs uppercase text-neutral-500">
        <tr>
          <th className="px-2 py-1">{keyHeader}</th>
          <th className="px-2 py-1 text-right">Planned ₹</th>
          <th className="px-2 py-1 text-right">Actual ₹</th>
          <th className="px-2 py-1 text-right">% Spent</th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop only">
            Planned Counters
          </th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop only">
            Actual Counters
          </th>
          <th className="px-2 py-1 text-right">% Executed</th>
          <th
            className="px-2 py-1 text-right"
            title="Counter Wall only (In-shop plan doesn't carry sqft)"
          >
            Planned Sq Ft
          </th>
          <th className="px-2 py-1 text-right" title="Counter Wall + In-shop, Done only">
            Actual Sq Ft
          </th>
          <th className="px-2 py-1 text-right">% Sq Ft</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-neutral-100">
            <td className="px-2 py-1">{r.key}</td>
            <td className="px-2 py-1 text-right">{fmtINR(r.plannedCost)}</td>
            <td className="px-2 py-1 text-right">{fmtINR(r.actualCost)}</td>
            <td className="px-2 py-1 text-right">{pct(r.actualCost, r.plannedCost)}</td>
            <td className="px-2 py-1 text-right">{r.plannedCounters || "—"}</td>
            <td className="px-2 py-1 text-right">{r.actualCounters || "—"}</td>
            <td className="px-2 py-1 text-right">{pct(r.actualCounters, r.plannedCounters)}</td>
            <td className="px-2 py-1 text-right">
              {r.plannedSqft ? r.plannedSqft.toLocaleString("en-IN") : "—"}
            </td>
            <td className="px-2 py-1 text-right">
              {r.actualSqft ? r.actualSqft.toLocaleString("en-IN") : "—"}
            </td>
            <td className="px-2 py-1 text-right">{pct(r.actualSqft, r.plannedSqft)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-neutral-300 font-semibold">
          <td className="px-2 py-1">Total</td>
          <td className="px-2 py-1 text-right">{fmtINR(totals.plannedCost)}</td>
          <td className="px-2 py-1 text-right">{fmtINR(totals.actualCost)}</td>
          <td className="px-2 py-1 text-right">{pct(totals.actualCost, totals.plannedCost)}</td>
          <td className="px-2 py-1 text-right">{totals.plannedCounters || "—"}</td>
          <td className="px-2 py-1 text-right">{totals.actualCounters || "—"}</td>
          <td className="px-2 py-1 text-right">
            {pct(totals.actualCounters, totals.plannedCounters)}
          </td>
          <td className="px-2 py-1 text-right">
            {totals.plannedSqft ? totals.plannedSqft.toLocaleString("en-IN") : "—"}
          </td>
          <td className="px-2 py-1 text-right">
            {totals.actualSqft ? totals.actualSqft.toLocaleString("en-IN") : "—"}
          </td>
          <td className="px-2 py-1 text-right">{pct(totals.actualSqft, totals.plannedSqft)}</td>
        </tr>
      </tbody>
    </table>
  );
}
