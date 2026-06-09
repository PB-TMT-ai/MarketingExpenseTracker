import type { ExceptionTotals } from "@/lib/db/dashboard";

/**
 * ExceptionCard (RSC) — D-07 parallel "Exception spend" card.
 *
 * Off-plan exception rows (plan_rows.source = 'exception') are EXCLUDED from every
 * headline metric (D-06). This card is the ONLY surface where exception spend appears,
 * so leakage is never hidden. When count > 0 an amber pill flags it (parallel to the
 * existing actuals "X to record" amber pill). When count === 0 a quiet note still
 * renders, so the user always sees the bucket. NO DB access.
 */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function ExceptionCard({ totals }: { totals: ExceptionTotals }) {
  const hasExceptions = totals.exceptionCount > 0;

  return (
    <section
      data-slot="exception-card"
      className="rounded-xl border border-neutral-200 bg-white shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-200 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-base font-semibold">Exception spend</h2>
          {hasExceptions ? (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
              {totals.exceptionCount} off-plan
            </span>
          ) : null}
        </div>
      </div>
      <div className="p-4">
        {hasExceptions ? (
          <dl className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Off-plan executions
              </dt>
              <dd
                data-slot="exception-count"
                className="mt-1 text-2xl font-semibold tracking-tight text-amber-900"
              >
                {totals.exceptionCount}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Exception ₹
              </dt>
              <dd
                data-slot="exception-cost"
                className="mt-1 text-2xl font-semibold tracking-tight text-amber-900"
              >
                {inr.format(totals.exceptionCost)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-neutral-500">No off-plan exceptions in scope.</p>
        )}
      </div>
    </section>
  );
}
