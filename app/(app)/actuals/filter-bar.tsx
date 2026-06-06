"use client";

/**
 * FilterBar — cascading multi-select dropdowns + SFID search for the actuals grid.
 *
 * D3-06/07/08 implementation:
 *   - Region → State → District (cascading geographic hierarchy).
 *   - Distributor and Status are independent facets.
 *   - SFID search is a dedicated input (matchesSfid — plan.sfid only, not quickFilter).
 *
 * The parent (ActualsGrid) owns the AG Grid external-filter callbacks; this component
 * only reports selection changes upward. Pure UI with no direct AG Grid dependency.
 */

import { useMemo, useState } from "react";
import {
  optionsFor,
  type FacetKey,
  type FacetSelections,
} from "@/lib/actuals/filter";
import { type UnitRow } from "@/lib/actuals/rows";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FilterBarProps = {
  allRows: UnitRow[];
  onFacetChange: (selections: FacetSelections) => void;
  onSfidChange: (search: string) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Multi-value selection stored as Set<string> per facet for O(1) toggle. */
type MultiState = Partial<Record<FacetKey, string[]>>;

// The cascade order: region narrows state narrows district.
// Distributor and status are independent.
const GEO_CASCADE: FacetKey[] = ["region", "state", "district"];
const INDEPENDENT: FacetKey[] = ["distributor", "status"];
const ALL_FACETS: FacetKey[] = [...GEO_CASCADE, ...INDEPENDENT];

const LABELS: Record<FacetKey, string> = {
  region: "Region",
  state: "State",
  district: "District",
  distributor: "Distributor",
  status: "Status",
};

export default function FilterBar({
  allRows,
  onFacetChange,
  onSfidChange,
}: FilterBarProps) {
  const [selected, setSelected] = useState<MultiState>({});
  const [sfid, setSfid] = useState("");

  // Derive option lists with cascade narrowing.
  // Region options: no upstream.
  // State options: narrowed by region selection.
  // District options: narrowed by region + state.
  // Distributor / Status: not narrowed (independent).
  const options = useMemo<Partial<Record<FacetKey, string[]>>>(() => {
    const regionOpts = optionsFor(allRows, "region", {});
    const stateOpts = optionsFor(allRows, "state", { region: selected.region ?? [] });
    const districtOpts = optionsFor(allRows, "district", {
      region: selected.region ?? [],
      state: selected.state ?? [],
    });
    const distributorOpts = optionsFor(allRows, "distributor", {});
    const statusOpts = optionsFor(allRows, "status", {});
    return {
      region: regionOpts,
      state: stateOpts,
      district: districtOpts,
      distributor: distributorOpts,
      status: statusOpts,
    };
  }, [allRows, selected.region, selected.state]);

  function toggleValue(facet: FacetKey, value: string) {
    setSelected((prev) => {
      const current = prev[facet] ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];

      // When a geographic upstream changes, clear its downstream facets.
      const nextState: MultiState = { ...prev, [facet]: next };
      if (facet === "region") {
        nextState.state = [];
        nextState.district = [];
      } else if (facet === "state") {
        nextState.district = [];
      }

      onFacetChange(nextState as FacetSelections);
      return nextState;
    });
  }

  function clearAll() {
    setSelected({});
    setSfid("");
    onFacetChange({});
    onSfidChange("");
  }

  const hasAnyFilter =
    Object.values(selected).some((v) => v && v.length > 0) || sfid.trim() !== "";

  return (
    <div
      data-slot="filter-bar"
      className="flex flex-col gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3 lg:flex-row lg:items-start"
    >
      {/* SFID search — top-of-mind, primary lookup */}
      <div className="flex flex-col gap-1 lg:max-w-[220px]">
        <label
          htmlFor="actuals-sfid-search"
          className="text-xs font-medium text-neutral-700"
        >
          Find by SFID
        </label>
        <input
          id="actuals-sfid-search"
          type="text"
          data-slot="sfid-search"
          value={sfid}
          onChange={(e) => {
            setSfid(e.target.value);
            onSfidChange(e.target.value);
          }}
          placeholder="Search SFID…"
          className="h-10 min-w-[180px] rounded-md border border-neutral-300 bg-white px-3 text-sm"
        />
      </div>

      <div
        aria-hidden
        className="hidden self-stretch border-l border-neutral-200 lg:block"
      />

      <fieldset className="flex flex-1 flex-col gap-2">
        <legend className="text-xs font-medium text-neutral-700">
          Filter rows
        </legend>
        <div className="flex flex-wrap items-end gap-3">
          {ALL_FACETS.map((facet) => {
            const opts = options[facet] ?? [];
            const sel = selected[facet] ?? [];
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
                  data-slot={`filter-${facet}`}
                  value={sel}
                  onChange={(e) => {
                    // HTML multiple <select> — read all selected options.
                    const newVals = Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    );
                    setSelected((prev) => {
                      const nextState: MultiState = { ...prev, [facet]: newVals };
                      if (facet === "region") {
                        nextState.state = [];
                        nextState.district = [];
                      } else if (facet === "state") {
                        nextState.district = [];
                      }
                      onFacetChange(nextState as FacetSelections);
                      return nextState;
                    });
                  }}
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
                    onClick={() => {
                      setSelected((prev) => {
                        const nextState: MultiState = { ...prev, [facet]: [] };
                        if (facet === "region") {
                          nextState.state = [];
                          nextState.district = [];
                        } else if (facet === "state") {
                          nextState.district = [];
                        }
                        onFacetChange(nextState as FacetSelections);
                        return nextState;
                      });
                    }}
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

      {/* Clear all */}
      {hasAnyFilter && (
        <button
          onClick={clearAll}
          className="inline-flex h-10 shrink-0 items-center self-end rounded-md border border-neutral-300 bg-white px-3 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
        >
          Clear all
        </button>
      )}
    </div>
  );
}
