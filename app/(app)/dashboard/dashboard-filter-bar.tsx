"use client";

/**
 * DashboardFilterBar (client island) — Region → State → District → Distributor cascade
 * for the compliance dashboard (DASH-04 / D-17).
 *
 * KEY DIVERGENCES from the actuals FilterBar (app/(app)/actuals/filter-bar.tsx):
 *   1. URL is the single source of truth — NO useState for filter selections. Every
 *      facet change rewrites `searchParams` via useRouter().replace, and the RSC
 *      re-aggregates server-side. (RESEARCH §Architectural Map — dashboard filters server-side.)
 *   2. NO Status facet (D-17 — the dashboard SHOWS status breakdowns, so filtering by
 *      status would be circular). The facet list deliberately omits it.
 *   3. Options are PRE-COMPUTED server-side from aggregateByGeo and passed as props —
 *      the bar does not pull rows client-side.
 *
 * D-11: the cascade contract (Region narrows State narrows District) reuses the same
 * facet vocabulary as `@/lib/actuals/filter` (FacetKey) — single cascade source.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { type FacetKey } from "@/lib/actuals/filter";
import type { DashboardFilters } from "@/lib/db/dashboard";

// The dashboard facets: the geographic cascade + distributor. The Status facet from
// FacetKey is intentionally OMITTED here (D-17 — the dashboard SHOWS status breakdowns, so
// filtering by it would be circular). DashboardFacet is a strict subset of FacetKey —
// `writeFacet` below types its key as FacetKey, so any member that drifts away from the
// FacetKey union would fail to type-check there.
type DashboardFacet = "region" | "state" | "district" | "distributor";

// Cascade order: region narrows state narrows district. Distributor is independent.
const GEO_CASCADE: DashboardFacet[] = ["region", "state", "district"];
const DASHBOARD_FACETS: DashboardFacet[] = [...GEO_CASCADE, "distributor"];

const LABELS: Record<DashboardFacet, string> = {
  region: "Region",
  state: "State",
  district: "District",
  distributor: "Distributor",
};

export type DashboardFilterOptions = {
  regions: string[];
  states: string[];
  districts: string[];
  distributors: string[];
};

export type DashboardFilterBarProps = {
  initialFilters: DashboardFilters;
  options: DashboardFilterOptions;
};

const OPTION_KEY: Record<DashboardFacet, keyof DashboardFilterOptions> = {
  region: "regions",
  state: "states",
  district: "districts",
  distributor: "distributors",
};

const FILTER_TO_PARAM: Record<DashboardFacet, keyof DashboardFilters> = {
  region: "regions",
  state: "states",
  district: "districts",
  distributor: "distributors",
};

export default function DashboardFilterBar({
  initialFilters,
  options,
}: DashboardFilterBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedFor = (facet: DashboardFacet): string[] =>
    initialFilters[FILTER_TO_PARAM[facet]] as string[];

  /**
   * Rewrite the URL for a facet change. Cascade-clear matches the actuals FilterBar
   * (app/(app)/actuals/filter-bar.tsx:70-76): changing Region clears State + District;
   * changing State clears District. Preserves all non-facet params (activity, weeks, mode).
   */
  function setFacet(facet: DashboardFacet, vals: string[]) {
    const params = new URLSearchParams(searchParams.toString());

    const writeFacet = (key: FacetKey, values: string[]) => {
      params.delete(key);
      for (const v of values) params.append(key, v);
    };

    writeFacet(facet, vals);
    if (facet === "region") {
      writeFacet("state", []);
      writeFacet("district", []);
    } else if (facet === "state") {
      writeFacet("district", []);
    }

    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const facet of DASHBOARD_FACETS) params.delete(facet);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  const hasAnyFilter = DASHBOARD_FACETS.some((f) => selectedFor(f).length > 0);

  return (
    <div
      data-slot="dashboard-filter-bar"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 lg:flex-row lg:items-end"
    >
      <fieldset className="flex flex-1 flex-col gap-2">
        <legend className="text-xs font-medium text-neutral-700">Filter dashboard</legend>
        <div className="flex flex-wrap items-end gap-3">
          {DASHBOARD_FACETS.map((facet) => {
            const opts = options[OPTION_KEY[facet]] ?? [];
            const sel = selectedFor(facet);
            if (opts.length === 0) return null;

            return (
              <div key={facet} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-neutral-600">
                  {LABELS[facet]}
                  {sel.length > 0 && (
                    <span className="ml-1 inline-flex items-center rounded-full bg-neutral-900 px-1.5 text-[10px] font-semibold text-white">
                      {sel.length}
                    </span>
                  )}
                </label>
                <select
                  multiple
                  size={Math.min(opts.length + 1, 5)}
                  data-slot={`dashboard-filter-${facet}`}
                  value={sel}
                  onChange={(e) =>
                    setFacet(
                      facet,
                      Array.from(e.target.selectedOptions, (o) => o.value),
                    )
                  }
                  className="min-w-[120px] rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm"
                >
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                {sel.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setFacet(facet, [])}
                    className="text-left text-[11px] text-neutral-500 hover:text-neutral-900"
                  >
                    Clear ({sel.length})
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </fieldset>

      {hasAnyFilter && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex h-10 shrink-0 items-center self-end rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
