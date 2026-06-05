import Link from "next/link";
import { getActivePeriod } from "@/lib/periods/active";
import {
  countByPeriodActivity,
  type PlanRowCount,
} from "@/lib/db/plan-rows";
import { ACTIVITIES, ACTIVITY_KEYS } from "@/lib/activities/registry";
import type { ActivityKey } from "@/lib/activities/types";

export const dynamic = "force-dynamic";

/**
 * /plans — the active-period plan overview.
 *
 * Server Component. Scopes to the SINGLE active period (D-11), then renders one cell
 * per activity (6 cells). Each cell links to
 * `/plans/upload?activity={key}&periodId={activeId}` so the user can either upload
 * (count=0) or re-upload (count>0) in one click. The header carries a prominent
 * "Upload a plan" button with no querystring — the form picks defaults (active period
 * + first activity).
 *
 * Historical periods are intentionally not shown here. The app is single-active-period
 * scoped per Phase 1's D-11; users switch the active period from the nav switcher to
 * see plans for another period.
 *
 * No DB writes happen here; mutation lives in /plans/upload via commitPlanUploadForm.
 *
 * Data-slot contract (e2e selectors): `plan-grid` on the grid container,
 * `plan-cell` on every cell so Playwright can locate cells by activity.
 */
export default async function PlansPage() {
  const activePeriod = await getActivePeriod();

  // Counts are cheap (6 rows × small period count) and the query has no per-period
  // variant yet; filter client-side. If we ever need per-period counts elsewhere we
  // can add `countByActivityForPeriod(periodId)` then.
  const allCounts: PlanRowCount[] = activePeriod
    ? (await countByPeriodActivity()).filter(
        (c) => c.periodId === activePeriod.id,
      )
    : [];
  const countMap = new Map<string, number>();
  for (const c of allCounts) {
    countMap.set(c.activity, c.count);
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <header>
        <h1 className="text-xl font-semibold">Plans</h1>
        <p className="mt-1 text-sm text-neutral-600">
          The approved plan for each activity in the active period. Re-uploading is
          non-destructive — existing actuals stay attached, and removing a dealer with
          recorded actuals is blocked at the database.
        </p>
      </header>

      <section className="rounded-xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-neutral-200 p-4">
          <h2 className="text-base font-semibold">
            {activePeriod ? (
              <>
                Plan rows for{" "}
                <span className="font-mono text-sm">{activePeriod.label}</span>
              </>
            ) : (
              "Plan rows"
            )}
          </h2>
          <Link
            href="/plans/upload"
            data-slot="upload-cta"
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-800 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={!activePeriod}
          >
            Upload a plan
          </Link>
        </div>

        {!activePeriod ? (
          <p className="p-6 text-sm text-neutral-500">
            No active period —{" "}
            <Link href="/periods" className="underline">
              create one or mark one active in /periods
            </Link>{" "}
            before uploading a plan.
          </p>
        ) : (
          <div
            data-slot="plan-grid"
            className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3"
          >
            {ACTIVITY_KEYS.map((activityKey: ActivityKey) => {
              const count = countMap.get(activityKey) ?? 0;
              const href = `/plans/upload?activity=${activityKey}&periodId=${activePeriod.id}`;
              return (
                <Link
                  key={activityKey}
                  href={href}
                  data-slot="plan-cell"
                  data-activity={activityKey}
                  data-period-id={activePeriod.id}
                  className="block rounded-lg border border-neutral-200 p-3 hover:border-neutral-400 hover:bg-neutral-50"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                    {ACTIVITIES[activityKey].label}
                  </div>
                  <div className="mt-1 text-sm font-medium">
                    {activePeriod.label}
                    <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      active
                    </span>
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
            })}
          </div>
        )}
      </section>
    </div>
  );
}
