import { listPeriods } from "@/lib/db/periods";
import { setActivePeriodForm } from "@/lib/actions/periods";
import PeriodForm from "./period-form";

export const dynamic = "force-dynamic";

/**
 * Period management — protected by the (app) group gate + the layout's per-render
 * re-verification. Server Component: lists periods and lets the user mark one active.
 */
export default async function PeriodsPage() {
  const rows = await listPeriods();

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Planning periods
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          Create planning periods (month, quarter, financial year). Exactly one period
          is active at a time — every plan and execution is scoped to it.
        </p>
      </header>

      <PeriodForm />

      <section data-slot="periods-section" aria-labelledby="periods-heading">
        <h2
          id="periods-heading"
          className="text-base font-semibold text-neutral-700"
        >
          {rows.length === 0
            ? "No periods yet"
            : `${rows.length} ${rows.length === 1 ? "period" : "periods"}`}
        </h2>
        {rows.length === 0 ? (
          <p className="mt-3 rounded-lg border border-dashed border-neutral-300 p-4 text-sm text-neutral-500">
            Add your first period above.
          </p>
        ) : (
          <ul
            data-slot="period-list"
            className="mt-3 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm"
          >
            {rows.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {p.label}{" "}
                    {p.isActive ? (
                      <span
                        data-slot="active-marker"
                        className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700"
                      >
                        active
                      </span>
                    ) : null}
                  </div>
                  <div className="text-xs text-neutral-500">
                    {p.type} · {p.startDate} → {p.endDate}
                  </div>
                </div>
                {p.isActive ? null : (
                  <form action={setActivePeriodForm}>
                    <input type="hidden" name="id" value={p.id} />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center rounded-md border border-neutral-300 px-3 text-xs font-medium hover:bg-neutral-50"
                    >
                      Make active
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
