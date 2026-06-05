import Link from "next/link";
import { listPeriods } from "@/lib/db/periods";
import {
  countByPeriodActivity,
  type PlanRowCount,
} from "@/lib/db/plan-rows";
import { ACTIVITIES, ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export const dynamic = "force-dynamic";

/**
 * /plans — the (activity × period) overview grid.
 *
 * Server Component. Reads `listPeriods()` + `countByPeriodActivity()` and renders a
 * dense grid of cells, one per (activity, period). Each cell links to
 * `/plans/upload?activity={key}&periodId={id}` so the user can either upload (count=0)
 * or re-upload (count>0) in one click. The header carries a prominent "Upload a plan"
 * button with no querystring — the form picks defaults (active period + first activity).
 *
 * No DB writes happen here; mutation lives in /plans/upload via commitPlanUploadForm.
 *
 * Data-slot contract (e2e selectors): `plan-grid` on the grid container,
 * `plan-cell` on every cell so Playwright can locate cells by activity+period.
 */
export default async function PlansPage() {
  const [periods, counts] = await Promise.all([
    listPeriods(),
    countByPeriodActivity(),
  ]);

  // Build a (periodId × activity) → count lookup so cell rendering is O(1).
  const countMap = new Map<string, number>();
  for (const c of counts as PlanRowCount[]) {
    countMap.set(`${c.periodId}:${c.activity}`, c.count);
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-xl font-semibold">Plans</h1>
        <p className="mt-1 text-sm text-neutral-600">
          The approved plan for each activity, per period. Re-uploading is non-destructive
          — existing actuals stay attached, and removing a dealer with recorded actuals is
          blocked at the database.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <h2 className="text-base font-semibold">Plan rows by activity and period</h2>
          <Link
            href="/plans/upload"
            data-slot="upload-cta"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800"
          >
            Upload a plan
          </Link>
        </div>

        {periods.length === 0 ? (
          <p className="p-6 text-sm text-neutral-500">
            No periods yet —{" "}
            <Link href="/periods" className="underline">
              create one in /periods
            </Link>{" "}
            before uploading a plan.
          </p>
        ) : (
          <div
            data-slot="plan-grid"
            className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {ACTIVITY_KEYS.flatMap((activityKey: ActivityKey) =>
              periods.map((period) => {
                const count = countMap.get(`${period.id}:${activityKey}`) ?? 0;
                const href = `/plans/upload?activity=${activityKey}&periodId=${period.id}`;
                return (
                  <Link
                    key={`${activityKey}:${period.id}`}
                    href={href}
                    data-slot="plan-cell"
                    data-activity={activityKey}
                    data-period-id={period.id}
                    className="block rounded-lg border border-neutral-200 p-3 hover:border-neutral-400 hover:bg-neutral-50"
                  >
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                      {ACTIVITIES[activityKey].label}
                    </div>
                    <div className="mt-1 text-sm font-medium">
                      {period.label}
                      {period.isActive ? (
                        <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          active
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 text-sm text-neutral-700">
                      {count === 0 ? (
                        <span className="text-neutral-500">Empty · Upload</span>
                      ) : (
                        <span>
                          <span className="font-semibold">{count}</span> rows · Re-upload
                        </span>
                      )}
                    </div>
                  </Link>
                );
              }),
            )}
          </div>
        )}
      </section>
    </div>
  );
}
