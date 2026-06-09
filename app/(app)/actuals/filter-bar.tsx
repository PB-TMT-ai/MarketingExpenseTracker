"use client";

/**
 * FilterBar — cascading multi-select dropdowns + SFID search for the actuals grid.
 *
 * D3-06/07/08 implementation:
 *   - Region → State → District (cascading geographic hierarchy).
 *   - Distributor and Status are independent facets.
 *   - SFID search is a dedicated input (matchesSfid — plan.sfid only, not quickFilter).
 *
 * CONTROLLED component (P3 refactor): the parent (ActualsGrid) owns the single
 * source of truth for facet selections + SFID search. FilterBar renders that
 * state and reports changes upward via onFacetChange/onSfidChange. This removes
 * the duplicate copy that used to live here and lets OTHER affordances (e.g. the
 * clickable "Pending" stat) drive the same filter state without desyncing the
 * dropdowns. URL persistence (P2-5) is handled centrally by the parent.
 */

import { useMemo } from "react";
import {
  optionsFor,
  type FacetKey,
  type FacetSelections,
} from "@/lib/actuals/filter";
import { type UnitRow } from "@/lib/actuals/rows";
import MultiSelectPopover from "@/app/(app)/multi-select-popover";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export type FilterBarProps = {
  allRows: UnitRow[];
  /** Controlled facet selections (owned by the parent). */
  selected: FacetSelections;
  /** Controlled SFID search string (owned by the parent). */
  sfid: string;
  onFacetChange: (selections: FacetSelections) => void;
  onSfidChange: (search: string) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

/**
 * Apply a facet change with cascade-clear: changing a geographic upstream
 * (region/state) clears its now-invalid downstream selections. Returns the
 * next full selection object (pure — the caller reports it upward).
 */
function applyFacetChange(
  prev: FacetSelections,
  facet: FacetKey,
  vals: string[],
): FacetSelections {
  const next: FacetSelections = { ...prev, [facet]: vals };
  if (facet === "region") {
    next.state = [];
    next.district = [];
  } else if (facet === "state") {
    next.district = [];
  }
  return next;
}

export default function FilterBar({
  allRows,
  selected,
  sfid,
  onFacetChange,
  onSfidChange,
}: FilterBarProps) {
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

  function clearAll() {
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
          onChange={(e) => onSfidChange(e.target.value)}
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
            return (
              <MultiSelectPopover
                key={facet}
                label={LABELS[facet]}
                options={opts}
                selected={sel}
                testIdSuffix={facet}
                onChange={(newVals) => {
                  onFacetChange(applyFacetChange(selected, facet, newVals));
                }}
              />
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
