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
        <div className="flex flex-col gap-3 border-b border-neutral-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-base font-semibold">
            {activePeriod ? (
              <>Plan rows for {activePeriod.label}</>
            ) : (
              "Plan rows"
            )}
          </h2>
          <Link
            href="/plans/upload"
            data-slot="upload-cta"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800 aria-disabled:pointer-events-none aria-disabled:opacity-50"
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
          <ul
            data-slot="plan-grid"
            className="divide-y divide-neutral-200"
          >
            {[...ACTIVITY_KEYS]
              .sort((a, b) => {
                const ca = countMap.get(a) ?? 0;
                const cb = countMap.get(b) ?? 0;
                if ((ca === 0) !== (cb === 0)) return ca === 0 ? -1 : 1;
                return ACTIVITIES[a].label.localeCompare(ACTIVITIES[b].label);
              })
              .map((activityKey: ActivityKey) => {
                const count = countMap.get(activityKey) ?? 0;
                const isEmpty = count === 0;
                const href = `/plans/upload?activity=${activityKey}&periodId=${activePeriod.id}`;
                return (
                  <li
                    key={activityKey}
                    data-slot="plan-cell"
                    data-activity={activityKey}
                    data-period-id={activePeriod.id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {ACTIVITIES[activityKey].label}
                      </div>
                      <div className="mt-0.5 text-xs text-neutral-600">
                        {isEmpty ? (
                          <span className="text-amber-700">No plan uploaded yet</span>
                        ) : (
                          <span>
                            <span className="font-semibold text-neutral-900">{count}</span>{" "}
                            {count === 1 ? "row" : "rows"} uploaded
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={href}
                      className={
                        isEmpty
                          ? "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-800"
                          : "inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-neutral-300 px-4 text-sm font-medium hover:bg-neutral-50"
                      }
                    >
                      {isEmpty ? "Upload" : "Re-upload"}
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
