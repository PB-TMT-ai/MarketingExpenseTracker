import type { ByRegionRow } from "@/lib/db/dashboard";

/**
 * ByRegionCard (RSC) — DASH-02 by-region breakdown.
 *
 * One row per region (Zone == plan_rows.region) in scope. The "(unassigned)" fallback
 * for a NULL region is already applied by aggregateByRegion at the DAL boundary, so this
 * component renders r.region verbatim. NO DB access.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function ByRegionCard({ rows }: { rows: ByRegionRow[] }) {
  return (
    <section
      data-slot="by-region-card"
      className="rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <div className="border-b border-neutral-200 p-4">
        <h2 className="text-base font-semibold">By region</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">No region data for this scope.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2 font-medium">Region</th>
                <th className="px-4 py-2 text-right font-medium">Planned</th>
                <th className="px-4 py-2 text-right font-medium">Done</th>
                <th className="px-4 py-2 text-right font-medium">Cancelled</th>
                <th className="px-4 py-2 text-right font-medium">Planned ₹</th>
                <th className="px-4 py-2 text-right font-medium">Actual ₹</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.region} className="border-b border-neutral-100 last:border-0">
                  <td className="px-4 py-2 font-medium text-neutral-900">{r.region}</td>
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
