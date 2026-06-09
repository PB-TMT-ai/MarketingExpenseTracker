import type { ByActivityRow } from "@/lib/db/dashboard";
import { ACTIVITIES } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

/**
 * ByActivityCard (RSC) — DASH-02 by-activity breakdown.
 *
 * One row per activity that has plan rows in scope. Activity label resolves via
 * ACTIVITIES[key].label, falling back to the raw key if the registry has no entry
 * (defensive — a stale plan row could reference a removed activity). NO DB access.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function activityLabel(key: string): string {
  return ACTIVITIES[key as ActivityKey]?.label ?? key;
}

export default function ByActivityCard({ rows }: { rows: ByActivityRow[] }) {
  return (
    <section
      data-slot="by-activity-card"
      className="rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <div className="border-b border-neutral-200 p-4">
        <h2 className="text-base font-semibold">By activity</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">No activity data for this scope.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2 font-medium">Activity</th>
                <th className="px-4 py-2 text-right font-medium">Planned</th>
                <th className="px-4 py-2 text-right font-medium">Done</th>
                <th className="px-4 py-2 text-right font-medium">Cancelled</th>
                <th className="px-4 py-2 text-right font-medium">Planned ₹</th>
                <th className="px-4 py-2 text-right font-medium">Actual ₹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.activity} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-neutral-900">
                    {activityLabel(r.activity)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.plannedUnits}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.executedUnits}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.cancelledUnits}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr.format(r.plannedCost)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{inr.format(r.actualCost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
