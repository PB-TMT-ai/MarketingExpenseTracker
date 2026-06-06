"use client";

import type { PeriodRow } from "@/lib/db/periods";

/**
 * Tiny client child of the Server `PeriodSwitcher`. Owns only the change handler that
 * auto-submits the parent form — keeping the data fetch (listPeriods + getActivePeriod)
 * server-side and the bundle slim.
 */
export default function PeriodSwitcherSelect({
  periods,
  activeId,
}: {
  periods: PeriodRow[];
  activeId: number | null;
}) {
  return (
    <>
      <label className="sr-only" htmlFor="period-switcher-select">
        Active period
      </label>
      <select
        id="period-switcher-select"
        name="id"
        defaultValue={activeId ?? ""}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-11 rounded-md border border-neutral-300 bg-white px-3 text-sm"
      >
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
            {p.isActive ? " (active)" : ""}
          </option>
        ))}
      </select>
    </>
  );
}
