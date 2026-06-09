import {
  aggregateByActivity,
  aggregateByRegion,
  breakdownByState,
  breakdownByDistributor,
  type DashboardFilters,
  type ByActivityRow,
} from "@/lib/db/dashboard";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";
import BreakdownTabs from "./breakdown-tabs";

/**
 * BreakdownCard — single card with four group-by views: State, Distributor, Activity, Region.
 *
 * Replaces the previous standalone by-activity-card and by-region-card.
 * Server Component: aggregates server-side, hands ALL four datasets to the Client tab
 * navigator so the user can flip between views without a network round-trip.
 *
 * Counters and sq ft columns reflect only Counter Wall Painting + In-shop Branding —
 * the two activities for which those metrics are meaningful. Other activities contribute
 * 0 via the SQL FILTER clauses in the DAL.
 */
export default async function BreakdownCard({
  filters,
}: {
  filters: DashboardFilters;
}) {
  const [byState, byDistributor, byActivity, byRegion] = await Promise.all([
    breakdownByState(filters),
    breakdownByDistributor(filters),
    aggregateByActivity(filters),
    aggregateByRegion(filters),
  ]);

  // Activity rows: relabel the raw registry key to its human label.
  const activityRows: BreakdownActivityRow[] = byActivity.map((r) => ({
    ...r,
    label: ACTIVITIES[r.activity as ActivityKey]?.label ?? r.activity,
  }));

  return (
    <section
      data-slot="breakdown-card"
      className="rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <header className="border-b border-neutral-200 p-4">
        <h2 className="text-base font-semibold">Breakdown</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Planned ₹ aggregates all activities. Planned/Actual Counters and Sq Ft reflect
          Counter Wall Painting + In-shop Branding only (In-shop&apos;s plan template does not
          capture planned sq ft, so Planned Sq Ft is effectively Counter Wall&apos;s contribution).
        </p>
      </header>
      <BreakdownTabs
        byState={byState}
        byDistributor={byDistributor}
        byActivity={activityRows}
        byRegion={byRegion}
      />
    </section>
  );
}

export type BreakdownActivityRow = ByActivityRow & { label: string };
