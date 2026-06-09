import type { ScopeTotals } from "@/lib/db/dashboard";
import type { Completeness } from "@/lib/compliance";

/**
 * StatStrip (RSC) — the headline compliance + spend numbers (DASH-01 / DASH-03 / DASH-05).
 *
 * Renders a semantic <dl> mirroring the existing actuals stat strip
 * (app/(app)/actuals/page.tsx:175-192). NO database access — receives pre-aggregated
 * ScopeTotals + computed Completeness as typed props.
 *
 * The D-04 asymmetry is visible here: `% Executed` uses the cancelled-EXCLUDED
 * denominator (completeness.pctExecuted) while `% Cancelled` reports against the
 * ORIGINAL planned total (completeness.pctCancelled).
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

type StatStripProps = {
  totals: ScopeTotals;
  completeness: Completeness;
};

type Stat = {
  slug: string;
  label: string;
  value: string;
  emphasis?: boolean;
};

export default function StatStrip({ totals, completeness }: StatStripProps) {
  const stats: Stat[] = [
    {
      slug: "pct-executed",
      label: "% Executed",
      value: pct(completeness.pctExecuted),
      emphasis: true,
    },
    {
      slug: "pct-cancelled",
      label: "% Cancelled",
      value: pct(completeness.pctCancelled),
      emphasis: true,
    },
    { slug: "planned-units", label: "Planned units", value: String(totals.plannedUnits) },
    { slug: "done", label: "Done", value: String(totals.executedUnits) },
    { slug: "cancelled", label: "Cancelled", value: String(totals.cancelledUnits) },
    {
      slug: "pending-wip",
      label: "Pending + WIP",
      value: String(totals.pendingUnits + totals.inProgressUnits),
    },
    { slug: "planned-rupees", label: "Planned ₹", value: inr.format(totals.plannedCost) },
    { slug: "actual-rupees", label: "Actual ₹", value: inr.format(totals.actualCost) },
  ];

  return (
    <section
      data-slot="stat-strip"
      className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:p-6"
    >
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.slug}>
            <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              {s.label}
            </dt>
            <dd
              data-slot={`stat-${s.slug}`}
              className={
                s.emphasis
                  ? "mt-1 text-2xl font-semibold tracking-tight text-neutral-900"
                  : "mt-1 text-lg font-semibold text-neutral-900"
              }
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
