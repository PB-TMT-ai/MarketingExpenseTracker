"use client";

import { useEffect, useState } from "react";
import type { PeriodRow } from "@/lib/db/periods";

/**
 * Tiny client child of the Server `PeriodSwitcher`. Owns only the change handler that
 * auto-submits the parent form — keeping the data fetch (listPeriods + getActivePeriod)
 * server-side and the bundle slim.
 *
 * NOTE: this is a CONTROLLED select. Previously it used `defaultValue={activeId}` which
 * is React-uncontrolled — it's read once at mount and ignored on re-render. The Server
 * Action's `revalidatePath` correctly re-rendered the parent Server Component with the
 * new `activeId` prop, but the DOM `<select>` kept its initial value, so the dropdown
 * displayed a stale period (e.g. "Jun 2026") even after the user activated Q1 from the
 * /periods page. We now mirror `activeId` into state and re-sync via `useEffect` whenever
 * the server pushes a new value down.
 */
export default function PeriodSwitcherSelect({
  periods,
  activeId,
}: {
  periods: PeriodRow[];
  activeId: number | null;
}) {
  const [value, setValue] = useState<string>(
    activeId == null ? "" : String(activeId),
  );

  // Sync when the server-resolved active period changes (e.g. user toggled active on
  // the /periods page, then navigated back; or the server Action revalidated this layout).
  useEffect(() => {
    setValue(activeId == null ? "" : String(activeId));
  }, [activeId]);

  return (
    <>
      <label className="sr-only" htmlFor="period-switcher-select">
        Active period
      </label>
      <select
        id="period-switcher-select"
        name="id"
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          e.currentTarget.form?.requestSubmit();
        }}
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
